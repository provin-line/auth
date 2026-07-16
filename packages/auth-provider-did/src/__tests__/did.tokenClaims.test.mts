/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as ed from "@noble/ed25519";
import {
	createSymmetricKeyStore,
	type GrantContext,
	type GrantDependencies,
} from "@o3co/auth-provider-core";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

import { AUTHZ_SCOPE_AT_ISSUANCE, createDidGrant } from "../did.mjs";
import {
	ResolutionRejectedError,
	ResolutionUnavailableError,
} from "../resolver/errors.mjs";
import type {
	DidDocument,
	DidDocumentResolver,
	JsonWebKey,
	ResolutionResult,
} from "../resolver/types.mjs";

const mockConfig = {
	oauth: {
		jwt: { secret: "test-secret" },
		accessToken: { expiresIn: 3600 },
		refreshToken: { expiresIn: 86400 },
		grants: {
			session: { enabled: true },
			authorization_code: { enabled: true },
			refresh_token: { enabled: true },
			did: {
				allowedAudiences: ["https://api.example.com"],
				revocationLatencyBoundSec: 3600,
				legacyMaxTtlSec: 3600,
				enabled: true,
				algorithm: "ed25519_raw",
				messageMaxAgeSec: 300,
			},
		},
	},
} as unknown as GrantDependencies["config"];

const mockDeps: GrantDependencies = {
	config: mockConfig,
	keyStore: createSymmetricKeyStore("test-secret"),
};

/**
 * Wrap a `DidDocument` fixture into the minimal `ResolutionResult` shape
 * `resolve()` returns. Mirrors the identically-named helper in
 * `did.test.mts` — kept local here (rather than exported/shared) since
 * these two test files intentionally have no runtime dependency on each
 * other's fixtures.
 */
function makeMockResolution(
	document: DidDocument,
	did: string,
): ResolutionResult {
	const digest = `sha256:${"1".repeat(64)}`;
	return {
		document,
		canonicalBytes: new TextEncoder().encode(JSON.stringify(document)),
		digest,
		requestedDid: did,
		finalOrigin: "mock://registry",
		snapshotRef: `registry:mock://registry#${digest}`,
		retrievedAt: new Date().toISOString(),
	};
}

const methodId = "did:key:z6MkClaims#key-1";

/**
 * Build a mock DidDocumentResolver that returns a DID Document containing
 * the given Ed25519 public key encoded as a JWK, and a signed GrantContext
 * for that DID. Mirrors `did.test.mts`'s `buildResolver` + `makeSignedCtx`
 * combined into a single helper since this file only needs one shape.
 */
async function buildSignedRequest(
	did: string,
): Promise<{ ctx: GrantContext; resolver: DidDocumentResolver }> {
	const privateKey = ed.utils.randomSecretKey();
	const publicKey = await ed.getPublicKeyAsync(privateKey);
	const x = Buffer.from(publicKey).toString("base64url");
	const jwk: JsonWebKey = { kty: "OKP", crv: "Ed25519", x };
	const didDoc: DidDocument = {
		id: did,
		verificationMethod: [
			{
				id: methodId,
				type: "JsonWebKey2020",
				controller: did,
				publicKeyJwk: jwk,
			},
		],
	};

	const message = JSON.stringify({
		did,
		timestamp: new Date().toISOString(),
		nonce: `nonce-${Date.now()}-${Math.random()}`,
	});
	const messageBytes = new TextEncoder().encode(message);
	const signature = await ed.signAsync(messageBytes, privateKey);

	const resolver: DidDocumentResolver = {
		async resolve(d: string): Promise<ResolutionResult> {
			if (d === did) return makeMockResolution(didDoc, did);
			throw new ResolutionRejectedError("did-not-found", `DID not found: ${d}`);
		},
	};

	return {
		ctx: {
			body: {
				did,
				message,
				signature: Buffer.from(signature).toString("base64"),
			},
			session: {},
			issuer: "localhost",
			metadata: { ip: "127.0.0.1" },
			authenticatedClient: null,
		} as GrantContext,
		resolver,
	};
}

describe("createDidGrant — token claims (Task 9)", () => {
	it("mints a JWT carrying all six required claims", async () => {
		const did = "did:key:z6MkClaims";
		const { ctx, resolver } = await buildSignedRequest(did);
		const handler = createDidGrant(mockDeps, { resolver });

		const { result } = await handler.handle(ctx);

		expect(result.status).toBe(200);
		if (!("tokens" in result)) throw new Error("expected a token response");
		const payload = decodeJwt(result.tokens.access_token);

		expect(payload.auth_contract_id).toBe("LEGACY_DID_LOGIN@1");
		expect(payload.verification_method).toBe(methodId);
		expect(payload.did_document_snapshot).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(typeof payload.lifecycle_state_ref).toBe("string");
		expect((payload.lifecycle_state_ref as string).length).toBeGreaterThan(0);
		expect(typeof payload.lifecycle_freshness_ref).toBe("string");
		expect((payload.lifecycle_freshness_ref as string).length).toBeGreaterThan(
			0,
		);
		expect(payload.authorization_scope).toBe(
			"AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1",
		);
		expect(payload.authorization_scope).toBe(AUTHZ_SCOPE_AT_ISSUANCE);
	});

	it("threads resolution.snapshotRef / retrievedAt through to the lifecycle claims", async () => {
		const did = "did:key:z6MkLifecycle";
		const { ctx, resolver } = await buildSignedRequest(did);
		const handler = createDidGrant(mockDeps, { resolver });

		// The resolver above always returns the same fixed snapshotRef/retrievedAt
		// shape (see makeMockResolution) — assert the minted claims are exactly
		// those values, not just "present", to pin the resolution -> claim wiring.
		const resolved = await resolver.resolve(did);

		const { result } = await handler.handle(ctx);
		expect(result.status).toBe(200);
		if (!("tokens" in result)) throw new Error("expected a token response");
		const payload = decodeJwt(result.tokens.access_token);

		expect(payload.lifecycle_state_ref).toBe(resolved.snapshotRef);
		expect(payload.did_document_snapshot).toBe(resolved.digest);
	});
});

describe("createDidGrant — resolver failure mapping (Task 9)", () => {
	it("maps ResolutionUnavailableError to 503 temporarily_unavailable and mints no token", async () => {
		const resolver: DidDocumentResolver = {
			async resolve(): Promise<ResolutionResult> {
				throw new ResolutionUnavailableError(
					"registry-5xx",
					"registry returned HTTP 503",
				);
			},
		};
		const handler = createDidGrant(mockDeps, { resolver });
		const { ctx } = await buildSignedRequest("did:key:z6MkUnavailable");

		const { result } = await handler.handle(ctx);

		expect(result.status).toBe(503);
		expect("error" in result && result.error).toBe("temporarily_unavailable");
		expect("tokens" in result).toBe(false);
	});

	it("maps ResolutionRejectedError to 400 invalid_grant and mints no token", async () => {
		const resolver: DidDocumentResolver = {
			async resolve(): Promise<ResolutionResult> {
				throw new ResolutionRejectedError(
					"did-not-found",
					"DID not found in registry",
				);
			},
		};
		const handler = createDidGrant(mockDeps, { resolver });
		const { ctx } = await buildSignedRequest("did:key:z6MkRejected");

		const { result } = await handler.handle(ctx);

		expect(result.status).toBe(400);
		expect("error" in result && result.error).toBe("invalid_grant");
		expect("tokens" in result).toBe(false);
	});

	it("Unavailable and Rejected produce DISTINCT status AND error codes (the whole point of the split)", async () => {
		const unavailableResolver: DidDocumentResolver = {
			async resolve(): Promise<ResolutionResult> {
				throw new ResolutionUnavailableError("network", "fetch failed");
			},
		};
		const rejectedResolver: DidDocumentResolver = {
			async resolve(): Promise<ResolutionResult> {
				throw new ResolutionRejectedError(
					"did-not-found",
					"DID not found in registry",
				);
			},
		};

		const { ctx: ctx1 } = await buildSignedRequest("did:key:z6MkDistinct1");
		const { ctx: ctx2 } = await buildSignedRequest("did:key:z6MkDistinct2");

		const unavailableResult = await createDidGrant(mockDeps, {
			resolver: unavailableResolver,
		}).handle(ctx1);
		const rejectedResult = await createDidGrant(mockDeps, {
			resolver: rejectedResolver,
		}).handle(ctx2);

		expect(unavailableResult.result.status).not.toBe(
			rejectedResult.result.status,
		);
		expect(
			"error" in unavailableResult.result && unavailableResult.result.error,
		).not.toBe("error" in rejectedResult.result && rejectedResult.result.error);
		expect("tokens" in unavailableResult.result).toBe(false);
		expect("tokens" in rejectedResult.result).toBe(false);
	});
});
