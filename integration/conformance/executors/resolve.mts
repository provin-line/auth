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

import { ResolutionRejectedError, ResolutionUnavailableError } from "@provin-line/auth-provider-did";
import { DplaaxDidResolver } from "@provin-line/auth-provider-dplaax-module";
import type { Vector, VectorOutcome } from "../runner.mjs";

/**
 * `auth.resolve.*` vector family (did-resolution-auth.yaml).
 *
 * This family has no vectors in dplaax.spec_draft yet (new rule file), so
 * there is no established README convention to match — this is the FIRST
 * definition of it. Convention chosen to mirror the mock-registry-response
 * shape `DplaaxDidResolver` actually consumes (a status + body pair), the
 * same shape `packages/auth-provider-dplaax-module/src/__tests__/resolver/
 * resolver.test.mts` builds by hand for every test case:
 *
 *   "input": {
 *     "did": "<the DID being resolved>",
 *     "registry_response": { "status": <http status>, "body": <JSON value> }
 *   }
 *
 * `expect` mirrors the two-class error taxonomy `auth.resolve.failure-
 * mapping` names (INDETERMINATE / FAILED) plus the un-named success case,
 * carrying the resolver's own machine-readable `reason` code (the same
 * string `ResolutionRejectedError`/`ResolutionUnavailableError` already
 * carry — no new vocabulary invented):
 *
 *   "expect": { "result": "OK" }
 *   "expect": { "result": "FAILED", "reason": "id-mismatch" }
 *   "expect": { "result": "INDETERMINATE", "reason": "registry-5xx" }
 */
interface ResolveVectorInput {
	did: string;
	registry_response: { status: number; body: unknown };
	// Index signature so `Record<string, unknown> -> ResolveVectorInput` is a
	// valid type-predicate narrowing (TS2677) — vector `input` objects may
	// carry other JSON fields this executor ignores.
	[key: string]: unknown;
}

function isResolveVectorInput(input: Record<string, unknown>): input is ResolveVectorInput {
	return (
		typeof input.did === "string" &&
		typeof input.registry_response === "object" &&
		input.registry_response !== null &&
		typeof (input.registry_response as Record<string, unknown>).status === "number"
	);
}

export async function runResolveVector(v: Vector): Promise<VectorOutcome> {
	if (!isResolveVectorInput(v.input)) {
		throw new Error(
			`vector "${v.id}": auth.resolve.* input must be { did: string, registry_response: { status: number, body } }`,
		);
	}
	const { did, registry_response } = v.input;

	// The DID's registry segment (did:dplaax:<registry>:...) must be in the
	// resolver's allow-list. DplaaxDidResolver's constructor always
	// includes registryBaseUrl's own hostname in that allow-list, so
	// pointing baseUrl's host at the DID's own registry segment satisfies
	// it without a separate allowedRegistries entry — this executor never
	// makes a real network call (fetchImpl is replaced below), so the
	// base URL's scheme/host is otherwise inert.
	const registrySegment = did.split(":")[2];
	if (!registrySegment) {
		throw new Error(`vector "${v.id}": could not extract a registry segment from did "${did}"`);
	}
	const registryBaseUrl = `http://${registrySegment}`;

	const mockFetch: typeof fetch = async () =>
		new Response(JSON.stringify(registry_response.body), {
			status: registry_response.status,
		});

	const resolver = new DplaaxDidResolver(registryBaseUrl, { fetchImpl: mockFetch });

	try {
		await resolver.resolve(did);
		return { result: "OK" };
	} catch (err) {
		if (err instanceof ResolutionUnavailableError) {
			return { result: "INDETERMINATE", reason: err.reason };
		}
		if (err instanceof ResolutionRejectedError) {
			return { result: "FAILED", reason: err.reason };
		}
		// An error outside the two-class taxonomy is a bug (in the resolver
		// or in this executor's fixture), not a conformance verdict —
		// propagate it so the test fails loudly instead of silently mapping
		// it to some guessed outcome.
		throw err;
	}
}
