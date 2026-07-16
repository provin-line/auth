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

/**
 * Integration test: DID auth → JWT → policy verification flow
 *
 * Tests the full pipeline programmatically (in-process, no Docker):
 *   mock DID registry → auth-provider → policy-verifier
 *
 * Test cases:
 *   1. DID auth → JWT issuance succeeds
 *   2. JWT introspection returns active=true
 *   3. Policy verification with DID-issued token: 3a pins upstream 0.3.x
 *      default-allow on empty rules (declared surface); 3b scope-mismatch
 *      deny; 3c undeclared (resource, action) → DefaultDenyRuleCollector
 *      fail-closed deny
 *   4. Policy verification with manually crafted JWT with scope → 200 allow
 */

import crypto, { createSecretKey } from "node:crypto";
import type http from "node:http";
import * as ed from "@noble/ed25519";
import { builtinCollectorsModule } from "@o3co/auth.policy-verifier.builtins";
import { createApp as createPolicyVerifierApp } from "@o3co/auth.policy-verifier.server";
import {
	type AppConfig,
	createApp,
	defineModule,
} from "@o3co/auth-provider-core";
import type {
	DidDocument,
	DidDocumentResolver,
} from "@provin-line/auth-provider-did";
import {
	buildModules,
	type DplaaxAppConfig,
} from "@provin-line/auth-provider-dplaax-module";
import { dplaaxModule } from "@provin-line/policy-verifier-dplaax-module";
import express from "express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ─── Configuration ───────────────────────────────────────────────────────────

const JWT_SECRET = "integration-test-secret-32chars-long";
const JWT_ISSUER = "test-issuer";
const JWT_KID = "test-key";
const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";
const TEST_CLIENT_ID = "dplaax-test-public-client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listenOnFreePort(
	app: express.Express,
): Promise<{ server: http.Server; port: number }> {
	return new Promise((resolve, reject) => {
		const server = app.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("failed to get port"));
				return;
			}
			resolve({ server, port: addr.port });
		});
		server.on("error", reject);
	});
}

function closeServer(server: http.Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

// ─── Test state ───────────────────────────────────────────────────────────────

let mockRegistryServer: http.Server;
let authProviderServer: http.Server;
let policyVerifierServer: http.Server;

let mockRegistryPort: number;
let authProviderPort: number;
let policyVerifierPort: number;

let authProviderDispose: (() => Promise<void>) | undefined;

// DID key material
let privateKeyBytes: Uint8Array;
let publicKeyBytes: Uint8Array;
const testDid = "did:dplaax:registry.test.local:org:test-integration-001";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
	// 1. Generate Ed25519 key pair (noble-ed25519 v3 API)
	const keypair = await ed.keygenAsync();
	privateKeyBytes = keypair.secretKey;
	publicKeyBytes = keypair.publicKey;

	// 2. Build DID Document for the test DID
	const publicKeyBase64url = Buffer.from(publicKeyBytes).toString("base64url");
	const didDocument: DidDocument = {
		id: testDid,
		verificationMethod: [
			{
				id: `${testDid}#key-1`,
				type: "JsonWebKey2020",
				controller: testDid,
				publicKeyJwk: {
					kty: "OKP",
					crv: "Ed25519",
					x: publicKeyBase64url,
				},
			},
		],
	};

	// 3. Start mock DID registry (serves DID Documents over HTTP)
	const registryApp = express();
	registryApp.get("/did/org/:id/did.json", (req, res) => {
		if (req.params.id === "test-integration-001") {
			res.json(didDocument);
		} else {
			res.status(404).json({ error: "not found" });
		}
	});
	const registryResult = await listenOnFreePort(registryApp);
	mockRegistryServer = registryResult.server;
	mockRegistryPort = registryResult.port;

	// 4. Build the dPLaaX auth-provider config (CoreConfig + dplaax extensions).
	//    The `registry.test.local` segment in `testDid` is added to
	//    `allowedRegistries` so the DplaaxDidResolver accepts it even though
	//    the actual registry baseUrl points at 127.0.0.1:<mockPort>.
	const registryBaseUrl = `http://127.0.0.1:${mockRegistryPort}`;
	const config: DplaaxAppConfig = {
		http: { port: 0, trustProxy: false },
		oauth: {
			jwt: {
				issuer: JWT_ISSUER,
				legacyTypAccept: false,
				signingKey: {
					provider: "local",
					local: {
						algorithm: "HS256",
						kid: JWT_KID,
						secret: JWT_SECRET,
						previousSecrets: [],
					},
				},
			},
			accessToken: { expiresIn: 3600 },
			refreshToken: {
				expiresIn: 86400,
				unknownFamilyPolicy: "reject",
				legacyRtPolicy: "reject",
			},
			oidcMode: "oidc-required",
			grants: {
				did: {
					supportedAlgorithms: ["ed25519_raw"],
					messageMaxAgeSec: 300,
					allowedAudiences: [],
				},
			},
		},
		endpoints: {
			login: { url: "/login" },
		},
		repositories: {
			client: { type: "memory" },
			user: { type: "memory" },
			code: { type: "memory" },
		},
		dplaax: {
			registry: {
				baseUrl: registryBaseUrl,
				allowedRegistries: ["registry.test.local"],
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: minimal AppConfig stub for token-only deployment
	} as any;

	// 5. Inject a DidDocumentResolver that talks to the mock registry directly.
	//    Bypasses DplaaxDidResolver's owner-only / registry-allow-list checks
	//    so the test focuses on the OAuth-token issuance path.
	const mockResolver: DidDocumentResolver = {
		async resolve(did: string): Promise<DidDocument> {
			const match = did.match(/^did:dplaax:[^:]+:org:([^:]+)$/);
			if (!match) throw new Error(`Unsupported DID: ${did}`);
			const res = await fetch(
				`${registryBaseUrl}/did/org/${match[1]}/did.json`,
			);
			if (!res.ok)
				throw new Error(
					`DID resolution failed for "${did}": HTTP ${res.status}`,
				);
			return res.json() as Promise<DidDocument>;
		},
	};

	// 6. Override the clientRepository module so the /oauth/token endpoint's
	//    `clientAuthMw` middleware accepts our DID-grant request. v0.5.x
	//    requires every /token call to authenticate the client; a public
	//    client (`tokenEndpointAuthMethod = "none"`) is the minimum form for
	//    the DID grant.
	const memoryClientRepositoryModule = defineModule({
		name: "test:memory-client-repository",
		provides: {
			clientRepository: () => ({
				async findById(clientId: string) {
					if (clientId === TEST_CLIENT_ID) {
						return {
							clientId: TEST_CLIENT_ID,
							tokenEndpointAuthMethod: "none" as const,
							allowedRedirectUris: [],
							allowedScopes: [],
						};
					}
					return null;
				},
				// The only registered client is public (`tokenEndpointAuthMethod:
				// "none"`); per the ClientRepository contract authenticate MUST
				// return null for such clients instead of accepting any secret.
				async authenticate(_clientId: string, _secret: string) {
					return null;
				},
			}),
		},
	});

	const authExpressApp = express();
	authExpressApp.set("trust proxy", false);

	const handle = await createApp({
		modules: buildModules(config, {
			didResolver: mockResolver,
			clientRepositoryModule: memoryClientRepositoryModule,
		}),
		bootstrapComponents: {
			// DplaaxAppConfig deliberately omits the session / rateLimit /
			// federations / cors sections; the upstream router gates every read
			// of those on optional ComponentMap slots, so the cast is safe at
			// this boundary (same localized-cast pattern as buildModules.mts).
			config: config as unknown as AppConfig,
			pathResolver: import.meta.resolve,
		},
	});
	authProviderDispose = () => handle.dispose();
	authExpressApp.use(handle.router);

	const authResult = await listenOnFreePort(authExpressApp);
	authProviderServer = authResult.server;
	authProviderPort = authResult.port;

	// 7. Start policy-verifier (in-process)
	const pvConfig = {
		http: { hostname: "127.0.0.1", port: 0, pathPrefix: "" },
		oauth: {
			jwt: {
				algorithm: "HS256" as const,
				secret: JWT_SECRET,
				validate: true,
			},
		},
		attribute: {
			collectors: [{ collector: "PayloadScopeCollector" }],
		},
		rule: {
			collectors: [
				{ collector: "ResourceActionScopeRuleCollector" },
				{
					// Fail-closed default (mirrors the scaffold config): only the
					// pairs the tests below exercise are declared; everything else
					// is denied regardless of token contents (Test 3c).
					collector: "DefaultDenyRuleCollector",
					surface: [
						{ resource: "registry.project", action: "read" },
						{ resource: "registry", action: "read" },
					],
				},
			],
		},
		resource: { parser: "DotNotationResourceParser" },
	};

	const pvApp = await createPolicyVerifierApp({
		pathResolver: import.meta.resolve,
		config: pvConfig,
		modules: [builtinCollectorsModule, dplaaxModule],
	});

	const pvResult = await listenOnFreePort(pvApp);
	policyVerifierServer = pvResult.server;
	policyVerifierPort = pvResult.port;
}, 30000);

afterAll(async () => {
	await authProviderDispose?.();
	await Promise.all([
		closeServer(mockRegistryServer).catch(() => {}),
		closeServer(authProviderServer).catch(() => {}),
		closeServer(policyVerifierServer).catch(() => {}),
	]);
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function authProviderUrl(path: string): string {
	return `http://127.0.0.1:${authProviderPort}${path}`;
}

function policyVerifierUrl(path: string): string {
	return `http://127.0.0.1:${policyVerifierPort}${path}`;
}

async function buildDidTokenRequest(): Promise<{
	did: string;
	message: string;
	signature: string;
}> {
	const message = JSON.stringify({
		did: testDid,
		timestamp: new Date().toISOString(),
		nonce: crypto.randomBytes(16).toString("hex"),
	});
	const messageBytes = new TextEncoder().encode(message);
	const sig = await ed.signAsync(messageBytes, privateKeyBytes);
	const signature = Buffer.from(sig).toString("base64");
	return { did: testDid, message, signature };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DID auth → JWT → policy verification", () => {
	let issuedToken: string;

	it("Test 1: DID auth → JWT issuance succeeds", async () => {
		const { did, message, signature } = await buildDidTokenRequest();

		const res = await fetch(authProviderUrl("/oauth/token"), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: DID_GRANT_TYPE,
				client_id: TEST_CLIENT_ID,
				did,
				message,
				signature,
			}),
		});

		expect(
			res.status,
			`token response status (body: ${await res.clone().text()})`,
		).toBe(200);
		const body = (await res.json()) as {
			access_token: string;
			token_type: string;
		};
		expect(body).toHaveProperty("access_token");
		expect(body.token_type).toBe("Bearer");

		issuedToken = body.access_token;
	});

	it("Test 2: JWT introspection returns active=true for DID-issued token", async () => {
		// Self-introspect using the Bearer token trick
		const res = await fetch(authProviderUrl("/oauth/introspect"), {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Bearer ${issuedToken}`,
			},
			body: new URLSearchParams({ token: issuedToken }),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { active: boolean; sub?: string };
		expect(body.active).toBe(true);
		expect(body.sub).toBe(testDid);
	});

	it("Test 3a: DID-issued no-scope token → policy-verifier ALLOWS (pins policy-verifier 0.3.x default-allow on empty rules)", async () => {
		// With `auth.policy-verifier` >= 0.3, `ResourceActionScopeRuleCollector`
		// produces ZERO rules when the token has no `scope` claim, and
		// `evaluate()` returns `{ decision: "allow" }` for the empty-rules
		// case. The pre-0.3 build denied this case. Pin the new behaviour
		// explicitly so a future flip back to deny-by-default is caught.
		//
		// SECURITY NOTE: callers MUST NOT rely on the DID grant to gate
		// scope-protected actions. Either inject a non-empty `scope` at
		// DID-token issue time, or keep the requested (resource, action)
		// OUT of DefaultDenyRuleCollector's declared surface so it fails
		// closed (Test 3c). This request stays allowed only because
		// registry.project/read is declared in the surface configured in
		// beforeAll — the pin covers the upstream 0.3.x empty-rules default,
		// not a recommended deployment posture.
		const res = await fetch(policyVerifierUrl("/verify"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${issuedToken}`,
			},
			body: JSON.stringify({
				resource: "registry.project",
				action: "read",
			}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { decision: string };
		expect(body.decision).toBe("allow");
	});

	it("Test 3b: Mismatched-scope token → 403 deny", async () => {
		// Forge a JWT carrying a `scope` claim that does NOT match the
		// requested resource/action. With a populated scope claim,
		// `ResourceActionScopeRuleCollector` emits rules that fail to match,
		// so `evaluate()` returns deny.
		const secretKey = createSecretKey(Buffer.from(JWT_SECRET));
		const mismatchedToken = await new SignJWT({ scope: "write:other-resource" })
			.setProtectedHeader({ alg: "HS256", kid: JWT_KID })
			.setIssuedAt()
			.setExpirationTime("1h")
			.setIssuer(JWT_ISSUER)
			.setSubject(testDid)
			.sign(secretKey);

		const res = await fetch(policyVerifierUrl("/verify"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${mismatchedToken}`,
			},
			body: JSON.stringify({
				resource: "registry.project",
				action: "read",
			}),
		});

		expect(res.status).toBe(403);
		const body = (await res.json()) as { decision: string };
		expect(body.decision).toBe("deny");
	});

	it("Test 3c: undeclared (resource, action) → 403 deny (DefaultDenyRuleCollector fail-closed)", async () => {
		// The scope collector abstains for a no-scope token and evaluate()
		// allows on zero rules (pinned by Test 3a), so without a fail-closed
		// default a request surface nobody configured would pass silently.
		// DefaultDenyRuleCollector is wired into this verifier with a surface
		// declaring only the pairs the other tests exercise — anything else
		// must come back 403 regardless of token contents.
		const res = await fetch(policyVerifierUrl("/verify"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${issuedToken}`,
			},
			body: JSON.stringify({
				resource: "unconfigured.surface",
				action: "read",
			}),
		});

		expect(res.status).toBe(403);
		const body = (await res.json()) as { decision: string; code?: string };
		expect(body.decision).toBe("deny");
		expect(body.code).toBe("undeclared_resource_action");
	});

	it("Test 4: Manually crafted JWT with scope → policy verification 200 allow", async () => {
		// Craft a JWT with scope="read:registry" to prove the verification pipeline works
		const secretKey = createSecretKey(Buffer.from(JWT_SECRET));
		const scopedToken = await new SignJWT({ scope: "read:registry" })
			.setProtectedHeader({ alg: "HS256", kid: JWT_KID })
			.setIssuedAt()
			.setExpirationTime("1h")
			.setIssuer(JWT_ISSUER)
			.setSubject(testDid)
			.sign(secretKey);

		const res = await fetch(policyVerifierUrl("/verify"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${scopedToken}`,
			},
			body: JSON.stringify({
				resource: "registry",
				action: "read",
			}),
		});

		expect(
			res.status,
			`verify response status (body: ${await res.clone().text()})`,
		).toBe(200);
		const body = (await res.json()) as { decision: string };
		expect(body.decision).toBe("allow");
	});
});
