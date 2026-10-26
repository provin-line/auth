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

import crypto from "node:crypto";
import keysModule from "@o3co/auth-provider-foundation/keys/module";
import { keysConfig } from "@o3co/auth-provider-foundation/keys/testing";
import {
	assemble,
	defineModule,
	isUnavailable,
	kernelConfig,
} from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import secretHashModule from "@o3co/auth-provider-foundation/secret-hash/module";
import { simulatedStore } from "@o3co/auth-provider-foundation/store/testing";
import clientsModule from "@o3co/auth-provider-identity/clients/module";
import { clientsConfig, publicClient } from "@o3co/auth-provider-identity/clients/testing";
import clientAllowanceModule from "@o3co/auth-provider-oauth/client-allowance/module";
import { allowancesFor } from "@o3co/auth-provider-oauth/client-allowance/testing";
import issuerModule from "@o3co/auth-provider-oauth/issuer/module";
import { issuerConfig } from "@o3co/auth-provider-oauth/issuer/testing";
import senderBindingModule from "@o3co/auth-provider-oauth/sender-binding/module";
import { grantCaller, grantCalls } from "@o3co/auth-provider-oauth/token-endpoint/testing";
import { tokenEndpointLocation } from "@o3co/auth-provider-oauth/token-endpoint";
import tokensModule from "@o3co/auth-provider-oauth/tokens/module";
import { tokensConfig } from "@o3co/auth-provider-oauth/tokens/testing";
import httpModule from "@o3co/auth-provider-foundation/http/module";
import { httpConfig } from "@o3co/auth-provider-foundation/http/testing";
import { type DidDocument, didDocuments, didGrantType } from "@provin-line/auth-did-grant";
import didGrant from "@provin-line/auth-did-grant/module";
import didGrantStore from "@provin-line/auth-did-grant-store/module";
import { decodeJwt } from "jose";
import type { Vector, VectorOutcome } from "../runner.mjs";

/**
 * `auth.grant.*` / `auth.method.*` / `auth.transcript.*` vector family
 * (auth-grant.yaml). `input`:
 *   "input": {
 *     "did": "<the DID the grant authenticates as>",
 *     "did_document": <DidDocument the registry stand-in serves for `did`>,
 *     "request": <the token request's parameters, all strings — e.g.
 *                 {"did", "jws"} or {"did", "message", "signature"}>,
 *     "config"?: <overrides merged onto this executor's default `did-grant`
 *                 section, in the module's own keys — e.g. "auth-contract",
 *                 "supported-algorithms">
 *   }
 * The outcome is the grant's answer as the token endpoint writes it; a
 * vector's `expect` names the part of it the vector fixes (`VectorOutcome`):
 *   "expect": { "status": 400, "error": "invalid_grant" }
 *   "expect": { "status": 200 }
 *   "expect": { "status": 200, "token_claims": { <the claims it fixes> } }
 *
 * The did-grant module runs composed with the dplaax-registry's contract
 * (served here by a stand-in that holds the vector's document), did-grant-store
 * on a simulated store, and upstream's real `tokens` and `keys`, called through
 * upstream's `grantCaller` as the token endpoint calls a grant. The kernel's
 * clock is set to the signed message's own timestamp, so a vector's fixed
 * timestamp is always within the message window whenever the test runs.
 */
interface GrantVectorInput {
	did: string;
	did_document: DidDocument;
	request: Record<string, string>;
	config?: Record<string, unknown>;
	// Vector `input` objects may carry other JSON fields this executor ignores.
	[key: string]: unknown;
}

function isGrantVectorInput(input: Record<string, unknown>): input is GrantVectorInput {
	return (
		typeof input.did === "string" &&
		typeof input.did_document === "object" &&
		input.did_document !== null &&
		typeof input.request === "object" &&
		input.request !== null &&
		Object.values(input.request).every((value) => typeof value === "string")
	);
}

const AUDIENCE = "https://conformance.test";
const CLIENT = "conformance-client";
/** What a vector's clock falls back to when its request names no timestamp. */
const FALLBACK_NOW = Date.parse("2026-01-01T00:00:00.000Z");

/** The timestamp of the signed message: the `message` JSON, or the payload of the compact `jws`. */
function messageTimestamp(request: Record<string, string>): number {
	try {
		const text =
			request.message ?? Buffer.from(String(request.jws).split(".")[1] ?? "", "base64url").toString("utf8");
		const parsed = Date.parse(String((JSON.parse(text) as { timestamp?: unknown }).timestamp));
		return Number.isNaN(parsed) ? FALLBACK_NOW : parsed;
	} catch {
		return FALLBACK_NOW;
	}
}

export async function runGrantVector(v: Vector): Promise<VectorOutcome> {
	if (!isGrantVectorInput(v.input)) {
		throw new Error(
			`vector "${v.id}": auth.grant.*/auth.method.*/auth.transcript.* input must be ` +
				`{ did: string, did_document: object, request: object, config?: object }`,
		);
	}
	const { did, did_document, request, config: overrides } = v.input;
	const now = messageTimestamp(request);

	const bytes = new TextEncoder().encode(JSON.stringify(did_document));
	const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
	const registry = defineModule({ name: "conformance-registry" }, (m) => [
		m.provide(didDocuments).by(() => ({
			async resolve(requested) {
				if (requested !== did) {
					return { kind: "rejected", reason: `conformance fixture only resolves "${did}"` };
				}
				return {
					kind: "resolved",
					resolution: {
						document: did_document,
						canonicalBytes: bytes,
						digest,
						requestedDid: did,
						finalOrigin: "mock://conformance-registry",
						snapshotRef: `registry:mock://conformance-registry#${digest}`,
						retrievedAt: new Date(now).toISOString(),
					},
				};
			},
		})),
	]);
	const location = defineModule({ name: "token-endpoint-location" }, (m) => [
		m.provide(tokenEndpointLocation).by(() => ({ url: `${AUDIENCE}/oauth/token` })),
	]);

	const app = await assemble({
		modules: [
			location,
			httpModule,
			keysModule,
			tokensModule,
			senderBindingModule,
			issuerModule,
			clientsModule,
			secretHashModule,
			grantCaller,
			clientAllowanceModule,
			registry,
			simulatedStore().module,
			didGrantStore,
			didGrant,
		],
		config: {
			...kernelConfig(),
			...httpConfig(),
			...keysConfig(),
			...tokensConfig(),
			...issuerConfig({ url: AUDIENCE }),
			...clientsConfig([
				publicClient({
					id: CLIENT,
					sections: allowancesFor({
						grants: [didGrantType],
						scopes: [],
						"default-scopes": [],
						audiences: [AUDIENCE],
					}),
				}),
			]),
			"did-grant": {
				"supported-algorithms": ["ed25519_raw", "ed25519_jws"],
				"revocation-latency-bound": "15m",
				"legacy-max-ttl": "15m",
				"access-token-lifetime": "10m",
				...overrides,
			},
		},
		runtime: quietRuntime({ clock: { now: () => now } }),
	});

	try {
		const outcome = await app.get(grantCalls).call(didGrantType, CLIENT, { grant_type: didGrantType, ...request });
		if (outcome.kind === "issued") {
			return { status: 200, token_claims: decodeJwt(String(outcome.body.access_token)) };
		}
		return { status: outcome.status ?? 400, error: outcome.error };
	} catch (err) {
		// An unavailable registry or nonce store is the token endpoint's 503.
		if (isUnavailable(err)) return { status: 503, error: "temporarily_unavailable" };
		throw err;
	} finally {
		await app.stop();
	}
}
