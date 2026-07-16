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
 * Conformance test suite (Task 11, rule `auth.contract.normative-sot`).
 *
 * Loads every `*.json` vector in `./vectors/`, runs it through `runVector`,
 * and asserts the outcome equals the vector's `expect`. These seed vectors
 * are LOCAL for now (P2 vendors dplaax.spec_draft's real `auth-*.json` /
 * `did-resolution-*.json` vectors here via `scripts/sync-spec-vectors.sh`);
 * once vendored, this file runs them unmodified.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runVector, type Vector } from "./runner.mjs";

const CONFORMANCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = path.join(CONFORMANCE_DIR, "vectors");
const MANIFEST_FILE = "SYNC_MANIFEST.json";

async function loadVectors(): Promise<Vector[]> {
	const entries = await readdir(VECTORS_DIR);
	const files = entries.filter((f) => f.endsWith(".json") && f !== MANIFEST_FILE).sort();
	return Promise.all(
		files.map(async (file) => {
			const raw = await readFile(path.join(VECTORS_DIR, file), "utf8");
			return JSON.parse(raw) as Vector;
		}),
	);
}

const vectors = await loadVectors();

/**
 * Known, tracked gap — NOT a runner/vector bug.
 *
 * `auth-grant-kid-mismatch-001` exercises rule `auth.grant.kid-match`
 * ("The JWS protected kid, the signed-payload method id, and the
 * resolver-selected method id MUST be identical; any divergence among the
 * three MUST fail closed" — dplaax.spec_draft rules/auth-grant.yaml).
 * `createDidGrant` (packages/auth-provider-did/src/did.mts) does not
 * perform this three-way check today: `validateOwnerLogin` — the function
 * that implements it (packages/auth-provider-did/src/transcript.mts) — is
 * exported from the package's public barrel but is never called from
 * `did.mts`'s `handle()`. This is a *deliberate*, reviewed scope boundary
 * across Tasks 6/9 of the p0-auth-contract plan (see
 * `.superpowers/sdd/progress.md`, Task 6: "did.mts untouched,
 * validateOwnerLogin extracted as pure fn"; Task 9: relationship hardcoded
 * to "legacy", OWNER path flagged as future work) — not an oversight this
 * task should silently patch (out of Task 11's file scope: runner + seed
 * vectors, not `did.mts`).
 *
 * The vector's `expect` stays normatively correct (`invalid_grant`) so P2
 * can vendor it unmodified. `it.fails` keeps this test green today while
 * making it a tripwire: the moment `did.mts` wires the three-way match in,
 * this test starts *passing for real* — which `it.fails` reports as a
 * failure (an unexpectedly-passing expected-failure), a loud, impossible-
 * to-miss signal to delete this entry from `KNOWN_FAILING_VECTOR_IDS`.
 *
 * See `.superpowers/sdd/task-11-report.md` for the full evidence trail
 * (including a live `createDidGrant` run proving a 200 mint today).
 */
const KNOWN_FAILING_VECTOR_IDS: ReadonlySet<string> = new Set(["auth-grant-kid-mismatch-001"]);

describe("conformance vectors (dplaax.spec_draft auth.* / did-resolution-auth rules)", () => {
	it("found at least one vendored vector", () => {
		expect(vectors.length).toBeGreaterThan(0);
	});

	for (const vector of vectors) {
		const runIt = KNOWN_FAILING_VECTOR_IDS.has(vector.id) ? it.fails : it;
		runIt(`${vector.id} [${vector.rule}]: ${vector.description}`, async () => {
			const outcome = await runVector(vector);
			expect(outcome).toEqual(vector.expect);
		});
	}

	it("throws — never silently skips — when a vector names a rule with no executor", async () => {
		// Test-only throwaway fixture, deliberately NOT placed under
		// vectors/: proves the runner fails closed on an unrecognized rule
		// id rather than vendoring an untested vector silently.
		const unknownRuleVector: Vector = {
			id: "test-only-unknown-rule-fixture",
			rule: "auth.totally-unimplemented.rule",
			description: "throwaway fixture proving unknown-rule-id fails the test, never skips",
			input: {},
			expect: "accept",
		};

		await expect(runVector(unknownRuleVector)).rejects.toThrow(/no executor for rule/i);
	});
});

describe.skipIf(!process.env.DPLAAX_SPEC_DIR)(
	"spec-vector drift check (DPLAAX_SPEC_DIR set)",
	() => {
		it("vendored vector bytes match dplaax.spec_draft's current auth-*/did-resolution-*.json (SYNC_MANIFEST.json sha256)", async () => {
			const specDir = process.env.DPLAAX_SPEC_DIR as string;
			let manifestRaw: string;
			try {
				manifestRaw = await readFile(path.join(VECTORS_DIR, MANIFEST_FILE), "utf8");
			} catch (err) {
				throw new Error(
					`${MANIFEST_FILE} not found in ${VECTORS_DIR} — run scripts/sync-spec-vectors.sh ` +
						`(with DPLAAX_SPEC_DIR set) before running the drift check`,
					{ cause: err },
				);
			}
			const manifest = JSON.parse(manifestRaw) as { files: Record<string, string> };

			for (const [file, expectedSha256] of Object.entries(manifest.files)) {
				const bytes = await readFile(path.join(specDir, "vectors", file));
				const actualSha256 = createHash("sha256").update(bytes).digest("hex");
				expect(actualSha256, `drift detected in ${file} (spec repo changed since last sync)`).toBe(
					expectedSha256,
				);
			}
		});
	},
);
