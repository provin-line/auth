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

import { assemble, defineModule, isUnavailable, kernelConfig } from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import { type OutboundResponse, outbound } from "@o3co/auth-provider-foundation/outbound";
import { outboundRefusals } from "@o3co/auth-provider-foundation/outbound-policy";
import { didDocuments } from "@provin-line/auth-did-grant";
import registry from "@provin-line/auth-dplaax-registry/module";
import type { Vector, VectorOutcome } from "../runner.mjs";

/**
 * `auth.resolve.*` vector family (did-resolution-auth.yaml). `input`:
 *   "input": {
 *     "did": "<the DID being resolved>",
 *     "registry_response": { "status": <http status>, "body": <JSON value> }
 *   }
 * `expect` is the two-class taxonomy `auth.resolve.failure-mapping` names
 * (INDETERMINATE / FAILED) plus the un-named success case, with the spec's
 * machine-readable `reason`:
 *   "expect": { "result": "OK" }
 *   "expect": { "result": "FAILED", "reason": "id-mismatch" }
 *   "expect": { "result": "INDETERMINATE", "reason": "registry-5xx" }
 *
 * The dplaax-registry module resolves against an outbound that answers the
 * vector's status and body. The module answers a rejection with a sentence for
 * the client and an unavailable registry with `Unavailable`, neither with the
 * spec's reason code, so `reasonOf` names the code from the module's answer for
 * the answers the vectors pin and refuses any other: a new answer fails the
 * run until it is mapped.
 */
interface ResolveVectorInput {
	did: string;
	registry_response: { status: number; body: unknown };
	// Vector `input` objects may carry other JSON fields this executor ignores.
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

/**
 * The spec's reason code for an answer of the module, or a refusal to guess
 * one. An unavailable registry is told by what the module says it was.
 */
function reasonOf(v: Vector, answer: { class: "FAILED"; reason: string } | { class: "INDETERMINATE"; what: string }): string {
	if (answer.class === "INDETERMINATE" && /HTTP 5\d\d$/.test(answer.what)) return "registry-5xx";
	if (answer.class === "FAILED" && /names another DID/.test(answer.reason)) return "id-mismatch";
	throw new Error(`vector "${v.id}": no reason code for ${JSON.stringify(answer)}; map it in reasonOf`);
}

export async function runResolveVector(v: Vector): Promise<VectorOutcome> {
	if (!isResolveVectorInput(v.input)) {
		throw new Error(
			`vector "${v.id}": auth.resolve.* input must be { did: string, registry_response: { status: number, body } }`,
		);
	}
	const { did, registry_response } = v.input;

	// The DID's registry segment (did:dplaax:<registry>:...) must be the
	// registry URL's host, so the URL is built from it. Nothing is sent over a
	// network: the outbound below answers the vector's response.
	const registrySegment = did.split(":")[2];
	if (!registrySegment) {
		throw new Error(`vector "${v.id}": could not extract a registry segment from did "${did}"`);
	}

	const answering = defineModule({ name: "outbound" }, (m) => [
		m.provide(outbound).by(() => ({
			fetch: async (): Promise<OutboundResponse> => ({
				status: registry_response.status,
				headers: new Map([["content-type", "application/json"]]),
				body: new TextEncoder().encode(JSON.stringify(registry_response.body)),
			}),
		})),
		m.provide(outboundRefusals).by(() => ({ explained: () => undefined })),
	]);
	const app = await assemble({
		modules: [answering, registry],
		config: { ...kernelConfig(), "dplaax-registry": { url: `http://${registrySegment}` } },
		runtime: quietRuntime(),
	});

	try {
		const answer = await app.get(didDocuments).resolve(did);
		if (answer.kind === "resolved") return { result: "OK" };
		return { result: "FAILED", reason: reasonOf(v, { class: "FAILED", reason: answer.reason }) };
	} catch (err) {
		if (isUnavailable(err)) {
			return {
				result: "INDETERMINATE",
				reason: reasonOf(v, { class: "INDETERMINATE", what: err.what }),
			};
		}
		// An error outside the two-class taxonomy is a bug (in the module or in
		// this executor's fixture), not a conformance verdict: it propagates so
		// the test fails loudly instead of mapping to some guessed outcome.
		throw err;
	} finally {
		await app.stop();
	}
}
