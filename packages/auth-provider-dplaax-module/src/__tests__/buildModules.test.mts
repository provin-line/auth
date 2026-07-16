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
import { createSymmetricKeyStore, type GrantContext } from "@o3co/auth-provider-core";
import { makeValidAppConfig } from "@o3co/auth-provider-core/testing";
import type { DidDocument, DidDocumentResolver, NonceStore, ResolutionResult } from "@provin-line/auth-provider-did";
import { describe, expect, it, vi } from "vitest";
import { buildModules, type DplaaxAppConfig } from "../buildModules.mjs";

const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";

function makeConfig(): DplaaxAppConfig {
	return {
		...makeValidAppConfig(),
		dplaax: {
			registry: { baseUrl: "https://registry.example.com", allowedRegistries: [] },
		},
	};
}

function makeMockResolution(document: DidDocument, did: string): ResolutionResult {
	const digest = `sha256:${"0".repeat(64)}`;
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

function buildResolver(did: string, publicKeyBytes: Uint8Array): DidDocumentResolver {
	const x = Buffer.from(publicKeyBytes).toString("base64url");
	const didDoc: DidDocument = {
		id: did,
		verificationMethod: [
			{
				id: `${did}#key-1`,
				type: "JsonWebKey2020",
				controller: did,
				publicKeyJwk: { kty: "OKP", crv: "Ed25519", x },
			},
		],
	};
	return {
		async resolve(d: string): Promise<ResolutionResult> {
			if (d === did) return makeMockResolution(didDoc, did);
			throw new Error(`DID not found: ${d}`);
		},
	};
}

async function makeSignedCtx(did: string): Promise<{ ctx: GrantContext; resolver: DidDocumentResolver }> {
	const privateKey = ed.utils.randomSecretKey();
	const publicKey = await ed.getPublicKeyAsync(privateKey);

	const message = JSON.stringify({
		did,
		timestamp: new Date().toISOString(),
		nonce: `nonce-${Date.now()}-${Math.random()}`,
	});
	const messageBytes = new TextEncoder().encode(message);
	const signature = await ed.signAsync(messageBytes, privateKey);

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
		resolver: buildResolver(did, publicKey),
	};
}

describe("buildModules – nonceStore override", () => {
	it("threads DplaaxBuildModulesOverrides.nonceStore through to the DID grant handler", async () => {
		const { ctx, resolver } = await makeSignedCtx("did:key:z6MkBuildModulesNonce");
		const consume = vi.fn(async () => true);
		const fakeNonceStore: NonceStore = { consume };

		const modules = buildModules(makeConfig(), { didResolver: resolver, nonceStore: fakeNonceStore });
		const didModule = modules.find((m) => m.name === "oauth-did");
		expect(didModule).toBeDefined();

		// biome-ignore lint/suspicious/noExplicitAny: same escape hatch module.mts uses at the contribute boundary
		const grantFactory = (didModule?.contributes?.grants as Record<string, any> | undefined)?.[
			DID_GRANT_TYPE
		];
		expect(typeof grantFactory).toBe("function");

		const handler = grantFactory({
			config: makeConfig(),
			keyStore: createSymmetricKeyStore("test-secret"),
			pathResolver: (s: string) => s,
		});

		const { result } = await handler.handle(ctx);

		expect(result.status).toBe(200);
		expect(consume).toHaveBeenCalledTimes(1);
	});

	it("falls back to the default in-memory nonce store when no override is supplied", async () => {
		const { ctx, resolver } = await makeSignedCtx("did:key:z6MkBuildModulesDefault");

		const modules = buildModules(makeConfig(), { didResolver: resolver });
		const didModule = modules.find((m) => m.name === "oauth-did");
		// biome-ignore lint/suspicious/noExplicitAny: same escape hatch module.mts uses at the contribute boundary
		const grantFactory = (didModule?.contributes?.grants as Record<string, any> | undefined)?.[
			DID_GRANT_TYPE
		];

		const handler = grantFactory({
			config: makeConfig(),
			keyStore: createSymmetricKeyStore("test-secret"),
			pathResolver: (s: string) => s,
		});

		const { result } = await handler.handle(ctx);
		expect(result.status).toBe(200);
		handler.cleanup?.();
	});
});
