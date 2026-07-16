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
 * Conformance vector runner (Task 11, rule `auth.contract.normative-sot`).
 *
 * dplaax.spec_draft is the normative source of truth for the DID
 * authentication verification contract; provin.auth's implementation is a
 * projection of it (rule `auth.contract.normative-sot`). This runner is the
 * bridge that lets provin.auth execute dplaax.spec_draft's vector shape
 * against this repo's actual executors, so drift between the spec and the
 * implementation shows up as a failing test rather than silent divergence.
 *
 * Vector shape (top-level — spec-pinned, matches dplaax.spec_draft's
 * `vectors/README.md` EXACTLY, verified against `vectors/resolver-001.json`,
 * `vectors/commitment-001.json`, `vectors/confidence-002.json`):
 *
 *   { "id": string, "rule": string, "description": string,
 *     "input": object, "expect": "accept" | "reject" | object }
 *
 * The spec's README documents `input`/`expect` sub-shape conventions
 * per rule family (e.g. `commitment.*`, `resolver.*`, `confidence.*`) but
 * does not yet have rows for the `auth.*` / `did-resolution-auth.yaml`
 * families (auth-grant.yaml / did-resolution-auth.yaml are new — no
 * `auth-*.json` / `did-resolution-*.json` vectors exist in the spec repo
 * yet). This file's executors are therefore the FIRST implementation of
 * that family's `input`/`expect` convention; see the executor modules'
 * doc comments for the exact per-family shape, and
 * `.superpowers/sdd/task-11-report.md` for the rationale P2 needs to fold
 * this into the spec repo's README table.
 *
 * Dispatch table (by `rule` id prefix):
 *   - `auth.resolve.*`                                  -> executors/resolve.mts
 *   - `auth.grant.*` / `auth.method.*` / `auth.transcript.*` -> executors/grant.mts
 *   - anything else                                      -> throws (fails the
 *     test, never skips) — "no executor for rule <id> — add one before
 *     vendoring this vector". A vector with no executor is a vector nobody
 *     is actually running; failing loudly is the only safe default.
 */

import { runGrantVector } from "./executors/grant.mjs";
import { runResolveVector } from "./executors/resolve.mjs";

/** The generic dplaax.spec_draft vector shape — see file doc comment. */
export interface Vector {
	readonly id: string;
	readonly rule: string;
	readonly description: string;
	readonly input: Record<string, unknown>;
	readonly expect: unknown;
}

/**
 * An executor's mapped outcome for a vector. Directly `toEqual`-comparable
 * against the vector's `expect` — executors map an implementation-specific
 * result (a thrown `Resolution*Error`, a `GrantHandlerResult`, ...) onto
 * this shape rather than the test asserting against raw implementation
 * types.
 */
export type VectorOutcome = Record<string, unknown>;

export async function runVector(v: Vector): Promise<VectorOutcome> {
	if (v.rule.startsWith("auth.resolve.")) {
		return runResolveVector(v);
	}
	if (
		v.rule.startsWith("auth.grant.") ||
		v.rule.startsWith("auth.method.") ||
		v.rule.startsWith("auth.transcript.")
	) {
		return runGrantVector(v);
	}
	throw new Error(
		`no executor for rule "${v.rule}" (vector "${v.id}") — add one before vendoring this vector`,
	);
}
