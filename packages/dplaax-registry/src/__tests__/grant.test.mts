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

// The DID grant composed with this registry and did-grant-store, on
// upstream's test parts: the composition a generated provider runs.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import http from "@o3co/auth-provider-foundation/http/module";
import { httpConfig } from "@o3co/auth-provider-foundation/http/testing";
import { assemble, defineModule, kernelConfig } from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import { type OutboundResponse, outbound } from "@o3co/auth-provider-foundation/outbound";
import { outboundRefusals } from "@o3co/auth-provider-foundation/outbound-policy";
import secretHashModule from "@o3co/auth-provider-foundation/secret-hash/module";
import { simulatedStore } from "@o3co/auth-provider-foundation/store/testing";
import clientsModule from "@o3co/auth-provider-identity/clients/module";
import { clientsConfig, publicClient } from "@o3co/auth-provider-identity/clients/testing";
import clientAllowanceModule from "@o3co/auth-provider-oauth/client-allowance/module";
import { allowancesFor } from "@o3co/auth-provider-oauth/client-allowance/testing";
import issuerModule from "@o3co/auth-provider-oauth/issuer/module";
import { issuerConfig } from "@o3co/auth-provider-oauth/issuer/testing";
import { tokenEndpointLocation } from "@o3co/auth-provider-oauth/token-endpoint";
import { grantCaller, grantCalls } from "@o3co/auth-provider-oauth/token-endpoint/testing";
import { tokens } from "@o3co/auth-provider-oauth/tokens";
import { tokensStandIn } from "@o3co/auth-provider-oauth/tokens/testing";
import { didGrantType } from "@provin-line/auth-did-grant";
import didGrant from "@provin-line/auth-did-grant/module";
import didGrantStore from "@provin-line/auth-did-grant-store/module";
import { describe, expect, it } from "vitest";
import registry from "../module.mjs";

const now = 1_800_000_000_000;
const registryUrl = "http://registry.internal:8443";
const owner = "did:dplaax:registry.internal:org:acme";
const methodId = `${owner}#key-1`;
const audience = "https://rs.example";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
const documentText = JSON.stringify({
	id: owner,
	verificationMethod: [{ id: methodId, type: "JsonWebKey2020", controller: owner, publicKeyJwk: jwk }],
});

/** A registry reached through outbound: it serves the owner's document and nothing else. */
const servingRegistry = defineModule({ name: "outbound" }, (m) => [
	m.provide(outbound).by(() => ({
		fetch: async (url: string): Promise<OutboundResponse> =>
			url === `${registryUrl}/did/org/acme/did.json`
				? { status: 200, headers: new Map(), body: new TextEncoder().encode(documentText) }
				: { status: 404, headers: new Map(), body: new Uint8Array() },
	})),
	m.provide(outboundRefusals).by(() => ({ explained: () => undefined })),
]);

async function provider() {
	const location = defineModule({ name: "token-endpoint-location" }, (m) => [
		m.provide(tokenEndpointLocation).by(() => ({ url: "https://as.example/oauth/token" })),
	]);
	const app = await assemble({
		modules: [
			location,
			http,
			tokensStandIn(),
			issuerModule,
			clientsModule,
			secretHashModule,
			grantCaller,
			clientAllowanceModule,
			servingRegistry,
			simulatedStore().module,
			registry,
			didGrantStore,
			didGrant,
		],
		config: {
			...kernelConfig(),
			...httpConfig(),
			...issuerConfig({ url: "https://as.example" }),
			...clientsConfig([
				publicClient({
					id: "quickstart",
					sections: allowancesFor({ grants: [didGrantType], scopes: [], "default-scopes": [], audiences: [audience] }),
				}),
			]),
			"dplaax-registry": { url: registryUrl },
			"did-grant": { "revocation-latency-bound": "15m", "access-token-lifetime": "10m" },
		},
		// Real randomness: records marks each write with it, and a repeated mark reads as a resend.
		runtime: quietRuntime({ clock: { now: () => now } }),
	});
	return {
		call: (params: Record<string, string>) =>
			app.get(grantCalls).call(didGrantType, "quickstart", { grant_type: didGrantType, ...params }),
		verify: (token: string) => app.get(tokens).verifyAccess(token),
	};
}

function signed(nonce: string) {
	const message = JSON.stringify({ did: owner, audience, timestamp: new Date(now).toISOString(), nonce });
	return { did: owner, message, signature: sign(null, Buffer.from(message), privateKey).toString("base64") };
}

describe("the DID grant on dplaax-registry and did-grant-store", () => {
	it("issues for an owner the registry serves, with the claims of the bytes it served", async () => {
		const { call, verify } = await provider();
		const outcome = await call(signed("n-1"));
		if (outcome.kind !== "issued") throw new Error(JSON.stringify(outcome));
		const digest = `sha256:${createHash("sha256").update(documentText).digest("hex")}`;
		expect(await verify(String(outcome.body.access_token))).toMatchObject({
			kind: "valid",
			grant: {
				subject: owner,
				audience: [audience],
				claims: {
					verification_method: methodId,
					did_document_snapshot: digest,
					lifecycle_state_ref: `registry:${registryUrl}#${digest}`,
					lifecycle_freshness_ref: new Date(now).toISOString(),
				},
			},
		});
	});

	it("refuses the same message twice, its nonce kept on the store", async () => {
		const { call } = await provider();
		await expect(call(signed("n-2"))).resolves.toMatchObject({ kind: "issued" });
		await expect(call(signed("n-2"))).resolves.toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("answers a DID the registry does not hold with invalid_grant", async () => {
		const { call } = await provider();
		const stranger = "did:dplaax:registry.internal:org:nobody";
		const message = JSON.stringify({ did: stranger, audience, timestamp: new Date(now).toISOString(), nonce: "n-3" });
		const outcome = await call({ did: stranger, message, signature: sign(null, Buffer.from(message), privateKey).toString("base64") });
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_grant" });
	});
});
