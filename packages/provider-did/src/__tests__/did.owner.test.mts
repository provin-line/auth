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
import {
	createSymmetricKeyStore,
	type GrantContext,
	type GrantDependencies,
} from "@o3co/auth-provider-core";
import { CompactSign, decodeJwt, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import { createDidGrant } from "../did.mjs";
import {
	DOMAIN_SEPARATION_TAG,
	TRANSCRIPT_VERSION,
} from "../transcript.mjs";
import type {
	DidDocument,
	DidDocumentResolver,
	JsonWebKey,
	ResolutionResult,
} from "../resolver/types.mjs";

/**
 * Wrap a `DidDocument` fixture into the minimal `ResolutionResult` shape
 * `resolve()` returns — mirrors the identically-named helper in
 * `did.test.mts` / `did.tokenClaims.test.mts`.
 */
function makeMockResolution(document: DidDocument, did: string): ResolutionResult {
	const digest = `sha256:${"2".repeat(64)}`;
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

const ISSUER = "https://issuer.example";
const TOKEN_ENDPOINT = "https://issuer.example/token";
const AUDIENCE = "https://relying-party.example";

function makeOwnerConfig(overrides: Record<string, unknown> = {}): GrantDependencies["config"] {
	return {
		oauth: {
			jwt: { secret: "test-secret" },
			accessToken: { expiresIn: 900 },
			grants: {
				did: {
					allowedAudiences: [AUDIENCE],
					revocationLatencyBoundSec: 900,
					authContract: "OWNER_AUTHENTICATION_LOGIN@1",
					ownerMigrationRatified: true,
					tokenEndpoint: TOKEN_ENDPOINT,
					supportedAlgorithms: ["ed25519_jws"],
					...overrides,
				},
			},
		},
	} as unknown as GrantDependencies["config"];
}

/**
 * Build a DID document with exactly one verification method, controller-
 * matched to `did`, optionally listed as a *string* reference under
 * `authentication` / `assertionMethod`.
 */
function makeOwnerDidDoc(
	did: string,
	methodId: string,
	jwk: JsonWebKey,
	relationships: { authentication?: string[]; assertionMethod?: string[] } = {},
): DidDocument {
	return {
		id: did,
		verificationMethod: [
			{
				id: methodId,
				type: "JsonWebKey2020",
				controller: did,
				publicKeyJwk: jwk,
			},
		],
		...(relationships.authentication ? { authentication: relationships.authentication } : {}),
		...(relationships.assertionMethod ? { assertionMethod: relationships.assertionMethod } : {}),
	};
}

function validTranscriptPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		did: "did:dplaax:u:alice",
		transcript_version: TRANSCRIPT_VERSION,
		domain_separation_tag: DOMAIN_SEPARATION_TAG,
		auth_contract_id: "OWNER_AUTHENTICATION_LOGIN@1",
		issuer: ISSUER,
		token_endpoint: TOKEN_ENDPOINT,
		audience: AUDIENCE,
		subject_did: "did:dplaax:u:alice",
		verification_method: "did:dplaax:u:alice#key-1",
		nonce: `nonce-${Date.now()}-${Math.random()}`,
		timestamp: new Date().toISOString(),
		...overrides,
	};
}

/**
 * Sign an arbitrary JSON payload as a compact JWS (EdDSA), optionally with
 * an explicit `kid` in the protected header.
 */
async function signJws(
	payload: Record<string, unknown>,
	privateKey: CryptoKey,
	headerKid?: string,
): Promise<string> {
	const header: { alg: "EdDSA"; kid?: string } = { alg: "EdDSA" };
	if (headerKid !== undefined) header.kid = headerKid;
	return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
		.setProtectedHeader(header)
		.sign(privateKey);
}

async function buildOwnerFixture(): Promise<{
	did: string;
	methodId: string;
	jwk: JsonWebKey;
	privateKey: CryptoKey;
}> {
	const did = "did:dplaax:u:alice";
	const methodId = `${did}#key-1`;
	const { privateKey, publicKey } = await generateKeyPair("EdDSA");
	const jwk = (await exportJWK(publicKey)) as JsonWebKey;
	return { did, methodId, jwk, privateKey };
}

function ctxFor(did: string, jws: string): GrantContext {
	return {
		body: { did, jws },
		session: {},
		issuer: ISSUER,
		metadata: { ip: "127.0.0.1" },
		authenticatedClient: null,
	} as GrantContext;
}

describe("createDidGrant — OWNER contract wiring", () => {
	it("OWNER_AUTHENTICATION_LOGIN@1 happy path: mints a token with aud and the OWNER auth_contract_id", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, { authentication: [methodId] });
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const payload = validTranscriptPayload({ did, subject_did: did, verification_method: methodId });
		const jws = await signJws(payload, privateKey, methodId);
		const config = makeOwnerConfig();
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(200);
		if (!("tokens" in result)) throw new Error("expected a token response");
		const claims = decodeJwt(result.tokens.access_token);
		expect(claims.auth_contract_id).toBe("OWNER_AUTHENTICATION_LOGIN@1");
		expect(claims.aud).toBe(AUDIENCE);
		expect(claims.verification_method).toBe(methodId);
	});

	it("OWNER_ASSERTION_CONTROL_LOGIN@1 happy path: mints a token using the assertionMethod relationship", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, { assertionMethod: [methodId] });
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const payload = validTranscriptPayload({
			did,
			subject_did: did,
			verification_method: methodId,
			auth_contract_id: "OWNER_ASSERTION_CONTROL_LOGIN@1",
		});
		const jws = await signJws(payload, privateKey, methodId);
		const config = makeOwnerConfig({ authContract: "OWNER_ASSERTION_CONTROL_LOGIN@1" });
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(200);
		if (!("tokens" in result)) throw new Error("expected a token response");
		const claims = decodeJwt(result.tokens.access_token);
		expect(claims.auth_contract_id).toBe("OWNER_ASSERTION_CONTROL_LOGIN@1");
		expect(claims.aud).toBe(AUDIENCE);
	});

	it("rejects a three-way kid mismatch (JWS header kid differs from transcript.verification_method)", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, { authentication: [methodId] });
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const payload = validTranscriptPayload({ did, subject_did: did, verification_method: methodId });
		// Header kid deliberately does not match the transcript's verification_method.
		const jws = await signJws(payload, privateKey, `${methodId}-WRONG`);
		const config = makeOwnerConfig();
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(400);
		expect("error" in result && result.error).toBe("invalid_grant");
		expect("tokens" in result).toBe(false);
	});

	it("rejects when the verification method is not listed in the required relationship array", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		// No `authentication` array at all — methodId is never string-referenced.
		const doc = makeOwnerDidDoc(did, methodId, jwk, {});
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const payload = validTranscriptPayload({ did, subject_did: did, verification_method: methodId });
		const jws = await signJws(payload, privateKey, methodId);
		const config = makeOwnerConfig();
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(400);
		expect("error" in result && result.error).toBe("invalid_grant");
		expect("tokens" in result).toBe(false);
	});

	it("rejects an OWNER request with no audience claim (fail closed)", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, { authentication: [methodId] });
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const payload = validTranscriptPayload({ did, subject_did: did, verification_method: methodId });
		delete payload.audience;
		const jws = await signJws(payload, privateKey, methodId);
		const config = makeOwnerConfig();
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(400);
		expect("tokens" in result).toBe(false);
	});

	it("rejects a request whose signed payload is not a valid login transcript (missing/invalid transcript)", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, { authentication: [methodId] });
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		// LEGACY-shaped payload (no transcript fields at all) signed against an
		// OWNER-configured grant.
		const legacyShapedPayload = {
			did,
			timestamp: new Date().toISOString(),
			nonce: `nonce-${Date.now()}-${Math.random()}`,
		};
		const jws = await signJws(legacyShapedPayload, privateKey, methodId);
		const config = makeOwnerConfig();
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(400);
		expect("error" in result && result.error).toBe("invalid_grant");
		expect("tokens" in result).toBe(false);
	});

	it("rejects when the transcript's subject_did does not match the authenticating did", async () => {
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, { authentication: [methodId] });
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const payload = validTranscriptPayload({
			did,
			subject_did: "did:dplaax:u:mallory",
			verification_method: methodId,
		});
		const jws = await signJws(payload, privateKey, methodId);
		const config = makeOwnerConfig();
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(400);
		expect("tokens" in result).toBe(false);
	});

	it("LEGACY_DID_LOGIN@1 regression: EvaluationInput.relationship stays 'legacy' and auth_contract_id stays LEGACY", async () => {
		// Sanity check that OWNER wiring did not disturb the default LEGACY path.
		const { did, methodId, jwk, privateKey } = await buildOwnerFixture();
		const doc = makeOwnerDidDoc(did, methodId, jwk, {});
		const resolver: DidDocumentResolver = {
			async resolve(d) {
				if (d === did) return makeMockResolution(doc, did);
				throw new Error(`unexpected did: ${d}`);
			},
		};
		const message = JSON.stringify({
			did,
			timestamp: new Date().toISOString(),
			nonce: `nonce-${Date.now()}-${Math.random()}`,
		});
		const jws = await signJws(JSON.parse(message), privateKey);
		const config = {
			oauth: {
				jwt: { secret: "test-secret" },
				accessToken: { expiresIn: 900 },
				grants: {
					did: {
						allowedAudiences: [AUDIENCE],
						revocationLatencyBoundSec: 900,
						legacyMaxTtlSec: 900,
						supportedAlgorithms: ["ed25519_jws"],
					},
				},
			},
		} as unknown as GrantDependencies["config"];
		const handler = createDidGrant(
			{ config, keyStore: createSymmetricKeyStore("test-secret") },
			{ resolver },
		);

		const { result } = await handler.handle(ctxFor(did, jws));

		expect(result.status).toBe(200);
		if (!("tokens" in result)) throw new Error("expected a token response");
		const claims = decodeJwt(result.tokens.access_token);
		expect(claims.auth_contract_id).toBe("LEGACY_DID_LOGIN@1");
	});
});

// Construction-time behavior for OWNER `authContract`s (no longer refuses;
// `tokenEndpoint` is the one remaining fail-closed boot requirement) is
// covered in module.config.test.mts's "OWNER authContract no longer
// refuses at construction" describe block, alongside the rest of this
// grant's boot-time config asserts.
