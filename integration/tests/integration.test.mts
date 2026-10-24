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
 * Integration test: DID grant → JWT → policy verification
 *
 * The whole pipeline in one process, over real HTTP:
 *   loopback DID registry → provider (token endpoint) → policy-verifier
 *
 * The provider is the composition a generated app runs (provider.mts); the
 * verifier is the real policy-verifier server with the dPLaaX module,
 * configured with the secret the provider signs with.
 *
 * Test cases:
 *   1. DID grant → JWT issuance succeeds, with the six signed claims and
 *      `client_id` (no `azp`)
 *   2. introspection returns active=true
 *   3. Policy verification with the DID-issued token: 3a no-scope token passes
 *      only through an explicit owner-identity rule; 3b scope-mismatch
 *      deny; 3c undeclared (resource, action) → DefaultDenyRuleCollector
 *      fail-closed deny
 *   4. Policy verification with a manually crafted JWT with scope → 200 allow
 *   5. The grant refuses a tampered signature, a replayed message, a
 *      resource the client may not be issued, and an unknown DID
 *   6. Revocation takes effect at introspection; issuance is audited
 */

import crypto, { createSecretKey, type KeyObject } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { builtinCollectorsModule } from "@o3co/auth.policy-verifier.builtins";
import {
	AppConfigSchema,
	builtinKeyResolversModule,
	createApp as createPolicyVerifierApp,
} from "@o3co/auth.policy-verifier.server";
import { clientSecret } from "@o3co/auth-provider-identity/clients/testing";
import { didGrantType } from "@provin-line/auth-did-grant";
import { dplaaxModule } from "@provin-line/auth-policy-verifier-dplaax-module";
import { decodeJwt, decodeProtectedHeader, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DID_CLIENT_ID,
	INTROSPECTION_CLIENT_ID,
	JWT_AUDIENCE,
	JWT_ISSUER,
	JWT_KID,
	JWT_SECRET,
	REGISTRY_NAME,
	startProvider,
} from "./provider.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listenOnFreePort(server: http.Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
	});
}

function closeServer(server: http.Server | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (!server) return resolve();
		server.close(() => resolve());
		server.closeAllConnections();
	});
}

// ─── Test state ───────────────────────────────────────────────────────────────

let registryServer: http.Server;
let verifierServer: http.Server;
let verifierPort: number;
let provider: Awaited<ReturnType<typeof startProvider>>;

let privateKey: KeyObject;
const testDid = `did:dplaax:${REGISTRY_NAME}:org:test-integration-001`;
/** `did-grant.access-token-lifetime` of the provider (1h). */
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
/** The account the registry answers 503 for. */
const OUTAGE_ACCOUNT = "outage";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
	// 1. An Ed25519 key pair and the DID document listing its public key.
	const keypair = crypto.generateKeyPairSync("ed25519");
	privateKey = keypair.privateKey;
	const jwk = keypair.publicKey.export({ format: "jwk" });
	const documents = new Map([
		[
			"test-integration-001",
			{
				id: testDid,
				verificationMethod: [
					{ id: `${testDid}#key-1`, type: "JsonWebKey2020", controller: testDid, publicKeyJwk: jwk },
				],
			},
		],
	]);

	// 2. The registry, served on loopback; the provider reaches it through its
	//    real outbound.
	registryServer = http.createServer((req, res) => {
		const id = /^\/did\/org\/([^/]+)\/did\.json$/.exec(req.url ?? "")?.[1];
		const document = id === undefined ? undefined : documents.get(id);
		res.statusCode = id === OUTAGE_ACCOUNT ? 503 : document ? 200 : 404;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(document ?? { error: "not found" }));
	});
	const registryPort = await listenOnFreePort(registryServer);

	// 3. The provider.
	provider = await startProvider({ registryPort });

	// 4. The policy-verifier, with the secret the provider signs with.
	const pvConfig = AppConfigSchema.parse({
		http: { hostname: "127.0.0.1", port: 3001, pathPrefix: "" },
		oauth: {
			jwt: {
				algorithm: "HS256" as const,
				secret: JWT_SECRET,
				mode: "verify",
				issuer: JWT_ISSUER,
				audience: JWT_AUDIENCE,
			},
		},
		attribute: {
			collectors: [
				{ collector: "PayloadScopeCollector" },
				{ collector: "SubjectDidCollector" },
				{ collector: "SubjectDidTypeCollector" },
			],
		},
		rule: {
			collectors: [
				{ collector: "ResourceActionScopeRuleCollector", scopeless: "skip" },
				{
					collector: "SubjectDidTypeRuleCollector",
					rules: [
						{ resource: "registry.project", action: "read", allowedTypes: ["owner"] },
						{ resource: "registry", action: "read", allowedTypes: ["owner"] },
					],
				},
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
	});

	const pvApp = await createPolicyVerifierApp({
		pathResolver: import.meta.resolve,
		config: pvConfig,
		modules: [builtinCollectorsModule, builtinKeyResolversModule, dplaaxModule],
	});
	verifierServer = http.createServer(pvApp);
	verifierPort = await listenOnFreePort(verifierServer);
}, 30000);

afterAll(async () => {
	await provider?.stop();
	await Promise.all([closeServer(registryServer), closeServer(verifierServer)]);
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function policyVerifierUrl(path: string): string {
	return `http://127.0.0.1:${verifierPort}${path}`;
}

function signedRequest(overrides: { did?: string; audience?: string } = {}) {
	const did = overrides.did ?? testDid;
	const message = JSON.stringify({
		did,
		audience: overrides.audience ?? JWT_AUDIENCE,
		timestamp: new Date().toISOString(),
		nonce: crypto.randomBytes(16).toString("hex"),
	});
	const signature = crypto.sign(null, Buffer.from(message), privateKey).toString("base64");
	return { did, message, signature };
}

async function requestToken(params: Record<string, string> = signedRequest()): Promise<Response> {
	return fetch(provider.url("/oauth/token"), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: didGrantType, client_id: DID_CLIENT_ID, ...params }),
	});
}

async function issueDidToken(): Promise<string> {
	const res = await requestToken();
	expect(res.status, `token response (body: ${await res.clone().text()})`).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

async function introspect(token: string): Promise<{ active: boolean; sub?: string }> {
	const res = await fetch(provider.url("/oauth/introspect"), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			token,
			client_id: INTROSPECTION_CLIENT_ID,
			client_secret: clientSecret(INTROSPECTION_CLIENT_ID),
		}),
	});
	expect(res.status, `introspect response (body: ${await res.clone().text()})`).toBe(200);
	return (await res.json()) as { active: boolean; sub?: string };
}

async function verify(token: string, resource: string, action: string): Promise<Response> {
	return fetch(policyVerifierUrl("/verify"), {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify({ resource, action }),
	});
}

function forgedToken(claims: {
	scope?: string;
	issuer?: string;
	audience?: string;
	subject?: string;
}): Promise<string> {
	return new SignJWT(claims.scope === undefined ? {} : { scope: claims.scope })
		.setProtectedHeader({ alg: "HS256", kid: JWT_KID, typ: "at+jwt" })
		.setIssuedAt()
		.setExpirationTime("1h")
		.setIssuer(claims.issuer ?? JWT_ISSUER)
		.setAudience(claims.audience ?? JWT_AUDIENCE)
		.setSubject(claims.subject ?? testDid)
		.sign(createSecretKey(Buffer.from(JWT_SECRET)));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DID grant → JWT → policy verification", () => {
	let issuedToken: string;

	it("Test 1: DID grant → JWT issuance succeeds", async () => {
		const res = await requestToken();

		expect(res.status, `token response status (body: ${await res.clone().text()})`).toBe(200);
		const body = (await res.json()) as { access_token: string; token_type: string };
		expect(body.token_type).toBe("Bearer");
		issuedToken = body.access_token;

		expect(decodeProtectedHeader(issuedToken)).toMatchObject({ alg: "HS256", kid: JWT_KID, typ: "at+jwt" });
	});

	it("Test 1b: the token carries the six signed claims and client_id, and no azp", () => {
		const claims = decodeJwt(issuedToken);
		expect(claims).toMatchObject({
			iss: JWT_ISSUER,
			sub: testDid,
			aud: JWT_AUDIENCE,
			client_id: DID_CLIENT_ID,
			auth_contract_id: "LEGACY_DID_LOGIN@1",
			verification_method: `${testDid}#key-1`,
			authorization_scope: "AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1",
		});
		expect(claims.did_document_snapshot).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(claims.lifecycle_state_ref).toMatch(
			new RegExp(`^registry:http://127\\.0\\.0\\.1:\\d+#${claims.did_document_snapshot}$`),
		);
		expect(Number.isNaN(Date.parse(String(claims.lifecycle_freshness_ref)))).toBe(false);
		expect(claims).not.toHaveProperty("azp");
		expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(ACCESS_TOKEN_LIFETIME_SECONDS);
	});

	it("Test 2: introspection returns active=true for the DID-issued token", async () => {
		expect(await introspect(issuedToken)).toMatchObject({ active: true, sub: testDid });
	});

	it("Test 3a: DID-issued no-scope token → policy-verifier passes an explicit owner-identity rule", async () => {
		// A scopeless DID token passes an explicit owner-identity rule.
		// Registry ACLs remain authoritative for resource permissions.
		const res = await verify(issuedToken, "registry.project", "read");

		expect(res.status).toBe(200);
		expect(((await res.json()) as { decision: string }).decision).toBe("allow");
	});

	it("Test 3b: Mismatched-scope token → 403 deny", async () => {
		// With a populated scope claim, `ResourceActionScopeRuleCollector`
		// emits rules that fail to match, so `evaluate()` returns deny.
		const res = await verify(await forgedToken({ scope: "write:other-resource" }), "registry.project", "read");

		expect(res.status).toBe(403);
		expect(((await res.json()) as { decision: string }).decision).toBe("deny");
	});

	it("Test 3c: undeclared (resource, action) → 403 deny (DefaultDenyRuleCollector fail-closed)", async () => {
		const res = await verify(issuedToken, "unconfigured.surface", "read");

		expect(res.status).toBe(403);
		const body = (await res.json()) as { decision: string; code?: string };
		expect(body.decision).toBe("deny");
		expect(body.code).toBe("undeclared_resource_action");
	});

	it("Test 4: Manually crafted JWT with scope → policy verification 200 allow", async () => {
		const res = await verify(await forgedToken({ scope: "read:registry" }), "registry", "read");

		expect(res.status, `verify response status (body: ${await res.clone().text()})`).toBe(200);
		expect(((await res.json()) as { decision: string }).decision).toBe("allow");
	});

	it.each([
		["a non-DID subject", "user-123"],
		["a pipeline DID", `${testDid}:pipeline:child`],
	])("rejects %s even on the declared surface", async (_label, subject) => {
		const res = await verify(await forgedToken({ subject }), "registry.project", "read");

		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ decision: "deny" });
	});

	it.each([
		["issuer", { issuer: "https://wrong-issuer.invalid" }],
		["audience", { audience: "https://wrong-api.invalid" }],
	])("current verifier rejects a token for the wrong %s", async (_label, claims) => {
		const res = await verify(await forgedToken(claims), "registry.project", "read");

		expect(res.status).toBe(401);
	});

	it("the verifier rejects a token signed with another secret", async () => {
		const token = await new SignJWT({})
			.setProtectedHeader({ alg: "HS256", kid: JWT_KID, typ: "at+jwt" })
			.setIssuedAt()
			.setExpirationTime("1h")
			.setIssuer(JWT_ISSUER)
			.setAudience(JWT_AUDIENCE)
			.setSubject(testDid)
			.sign(createSecretKey(Buffer.from("another.secret.at.least.32.bytes.long!!")));

		expect((await verify(token, "registry.project", "read")).status).toBe(401);
	});
});

describe("the grant refuses what it must", () => {
	it("a tampered signature mints no token (400 invalid_grant)", async () => {
		const request = signedRequest();
		const bytes = Buffer.from(request.signature, "base64");
		bytes[0] ^= 0xff;
		const res = await requestToken({ ...request, signature: bytes.toString("base64") });

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "invalid_grant" });
	});

	it("a replayed message mints no second token (400 invalid_request)", async () => {
		const request = signedRequest();
		expect((await requestToken(request)).status).toBe(200);

		const replay = await requestToken(request);
		expect(replay.status).toBe(400);
		expect(await replay.json()).toMatchObject({ error: "invalid_request" });
	});

	it("an audience the client may not be issued mints no token (400 invalid_request)", async () => {
		const res = await requestToken(signedRequest({ audience: "https://other-api.invalid" }));

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "invalid_request" });
	});

	it("a registry outage mints no token (503 temporarily_unavailable, no description)", async () => {
		const res = await requestToken(signedRequest({ did: `did:dplaax:${REGISTRY_NAME}:org:${OUTAGE_ACCOUNT}` }));

		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
	});

	it.each([
		["a non-owner DID", `${testDid}:pipeline:child`],
		["a DID of a registry this provider does not resolve", "did:dplaax:other-registry.invalid:org:test-integration-001"],
	])("%s mints no token (400 invalid_grant)", async (_label, did) => {
		const res = await requestToken(signedRequest({ did }));

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "invalid_grant" });
	});

	it("a message refused by the client's allowance stays spent (the nonce is spent before the allowance is asked)", async () => {
		const request = signedRequest({ audience: "https://other-api.invalid" });
		const first = await requestToken(request);
		expect(first.status).toBe(400);
		expect(await first.json()).toMatchObject({ error: "invalid_request", error_description: expect.stringContaining("not allowed") });

		const replay = await requestToken(request);
		expect(replay.status).toBe(400);
		expect(await replay.json()).toMatchObject({
			error: "invalid_request",
			error_description: expect.stringContaining("nonce already used"),
		});
	});

	it("a DID the registry does not hold mints no token (400 invalid_grant)", async () => {
		const res = await requestToken(signedRequest({ did: `did:dplaax:${REGISTRY_NAME}:org:nobody` }));

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "invalid_grant" });
	});
});

// ─── Revocation and audit ────────────────────────────────────────────────────

describe("revocation and audit are wired, not declared absent", () => {
	it("records one token.issued event for a DID token issuance on the audit receiver", async () => {
		// The `log` receiver writes the kind and the names of the attributes, never
		// their values, so the issuance is told by its kind alone; the tests of
		// this file run one at a time.
		const issuances = () =>
			provider.log.lines().filter((l) => l.event === "audit" && l.fields.kind === "token.issued").length;
		const before = issuances();

		await issueDidToken();

		await expect.poll(issuances).toBe(before + 1);
	});

	// The token is bound to the authenticated client (client_id), so
	// /oauth/revoke finds the owning client and denylists the jti.
	it("RFC 7009 revocation of a DID-issued access token takes effect at introspection", async () => {
		const token = await issueDidToken();
		expect((await introspect(token)).active).toBe(true);

		const res = await fetch(provider.url("/oauth/revoke"), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token, token_type_hint: "access_token", client_id: DID_CLIENT_ID }),
		});
		expect(res.status, `revoke response (body: ${await res.clone().text()})`).toBe(200);

		expect((await introspect(token)).active).toBe(false);
	});
});
