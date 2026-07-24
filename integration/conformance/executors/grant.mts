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
import {
	createDidGrant,
	type DidDocument,
	type DidDocumentResolver,
	ResolutionRejectedError,
	type ResolutionResult,
} from "@provin-line/auth-provider-did";
import { decodeJwt } from "jose";
import type { Vector, VectorOutcome } from "../runner.mjs";

/**
 * `auth.grant.*` / `auth.method.*` / `auth.transcript.*` vector family
 * (auth-grant.yaml). As of this writing, dplaax.spec's
 * vectors/README.md has no row for this family (auth-grant.yaml is a newer
 * rule file) — this was the FIRST definition of its `input`/`expect`
 * convention. (P2 vendors this family's real vectors —
 * `auth-*.json` — from dplaax.spec into `../vectors/`, tracked by
 * `../vectors/SYNC_MANIFEST.json`, and runs them unmodified through this
 * same convention.)
 *
 *   "input": {
 *     "did": "<the DID the grant authenticates as>",
 *     "did_document": <DidDocument the mock resolver returns for `did`>,
 *     "request": <the exact GrantContext.body the grant handler receives —
 *                 e.g. {"did", "jws"} or {"did", "message", "signature"}>,
 *     "config"?: <shallow overrides merged onto this executor's default
 *                 oauth.grants.did config slice — e.g. "authContract",
 *                 "supportedAlgorithms">
 *   }
 *
 * `expect` mirrors `GrantHandlerResult.result` directly (no new vocabulary):
 *
 *   "expect": { "status": 400, "error": "invalid_grant" }
 *   "expect": { "status": 200, "token_claims": { <decoded JWT claims> } }
 *
 * This executor drives `createDidGrant` (packages/auth-provider-did/src/
 * did.mts) DIRECTLY, the same way the package's own
 * `did.tokenClaims.test.mts` / `did.test.mts` do, rather than assembling
 * the full `buildModules` -> `createApp` -> HTTP router chain
 * (`integration/tests/integration.test.mts`'s pattern). `buildModules`
 * (`@provin-line/auth-provider-dplaax-module`) contributes the
 * `DplaaxAppConfig` shape this executor's config mirrors and the
 * `didResolver` override convention this executor's mock resolver follows,
 * but its own grant-type constant (`DID_GRANT_TYPE`) is a private,
 * unexported detail of `oauthDidModule` — reaching through `buildModules`'s
 * `Module[]` output to extract and hand-invoke that factory would mean
 * depending on an implementation detail no public contract pins, for no
 * behavioral difference (the factory itself does nothing but call
 * `createDidGrant` with the same `{config, keyStore, pathResolver}` shape
 * this executor already builds). Driving `createDidGrant` directly is
 * therefore the stable, precedented choice — noted here as a judgment call
 * in case a literal "via buildModules" reading was intended instead.
 */
interface GrantVectorInput {
	did: string;
	did_document: DidDocument;
	request: Record<string, unknown>;
	config?: Record<string, unknown>;
	// Index signature so `Record<string, unknown> -> GrantVectorInput` is a
	// valid type-predicate narrowing (TS2677) — vector `input` objects may
	// carry other JSON fields this executor ignores.
	[key: string]: unknown;
}

function isGrantVectorInput(input: Record<string, unknown>): input is GrantVectorInput {
	return (
		typeof input.did === "string" &&
		typeof input.did_document === "object" &&
		input.did_document !== null &&
		typeof input.request === "object" &&
		input.request !== null
	);
}

/**
 * Wrap a `DidDocument` fixture into the `ResolutionResult` shape
 * `resolve()` returns. `retrievedAt` is a FIXED timestamp (not
 * `new Date().toISOString()`, unlike `integration/tests/utils.mts`'s
 * identically-shaped helper) because conformance vectors are static JSON
 * committed to the repo — their outcome must not depend on when the test
 * happens to run.
 */
function makeMockResolution(document: DidDocument, requestedDid: string): ResolutionResult {
	const digest = `sha256:${"0".repeat(64)}`;
	return {
		document,
		canonicalBytes: new TextEncoder().encode(JSON.stringify(document)),
		digest,
		requestedDid,
		finalOrigin: "mock://conformance-registry",
		snapshotRef: `registry:mock://conformance-registry#${digest}`,
		retrievedAt: "2026-01-01T00:00:00.000Z",
	};
}

export async function runGrantVector(v: Vector): Promise<VectorOutcome> {
	if (!isGrantVectorInput(v.input)) {
		throw new Error(
			`vector "${v.id}": auth.grant.*/auth.method.*/auth.transcript.* input must be ` +
				`{ did: string, did_document: object, request: object, config?: object }`,
		);
	}
	const { did, did_document, request, config: configOverrides } = v.input;

	const resolver: DidDocumentResolver = {
		async resolve(requestedDid: string): Promise<ResolutionResult> {
			if (requestedDid !== did) {
				throw new ResolutionRejectedError(
					"did-not-found",
					`conformance fixture only resolves "${did}", got "${requestedDid}"`,
				);
			}
			return makeMockResolution(did_document, did);
		},
	};

	const didGrantConfig = {
		supportedAlgorithms: ["ed25519_raw", "ed25519_jws"],
		// A fixed, generous freshness window: a vector's signed payload
		// carries a fixed `timestamp`, so the window must never lapse
		// relative to wall-clock "now" — otherwise a vector that passed
		// today would start failing on its own after messageMaxAgeSec from
		// the wire timestamp (nothing to do with the rule under test).
		messageMaxAgeSec: 315_360_000, // 10 years
		allowedAudiences: ["https://conformance.test"],
		revocationLatencyBoundSec: 900,
		legacyMaxTtlSec: 900,
		...configOverrides,
	};

	// Minimal CoreConfig stub — createDidGrant only reads oauth.grants.did.*
	// and oauth.accessToken.expiresIn (see did.mts). Cast pattern mirrors
	// packages/auth-provider-did/src/__tests__/did.tokenClaims.test.mts's
	// `mockConfig`.
	const config = {
		oauth: {
			accessToken: { expiresIn: 900 },
			grants: { did: didGrantConfig },
		},
	} as unknown as GrantDependencies["config"];

	const keyStore = createSymmetricKeyStore("conformance-runner-secret");
	const handler = createDidGrant({ config, keyStore }, { resolver });

	try {
		const ctx: GrantContext = {
			body: request,
			session: {},
			issuer: "conformance-runner",
			metadata: {},
			authenticatedClient: null,
		};

		const { result } = await handler.handle(ctx);
		if ("tokens" in result) {
			return { status: result.status, token_claims: decodeJwt(result.tokens.access_token) };
		}
		return { status: result.status, error: result.error };
	} finally {
		handler.cleanup?.();
	}
}
