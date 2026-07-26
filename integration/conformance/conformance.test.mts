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
 * and asserts the outcome equals the vector's `expect`. As of P2, these
 * vectors are vendored from dplaax.spec's real `auth-*.json` /
 * `did-resolution-*.json` vectors (via `scripts/sync-spec-vectors.sh`,
 * tracked by `vectors/SYNC_MANIFEST.json`) — the spec repo is the normative
 * source of truth (rule `auth.contract.normative-sot`); this directory
 * mirrors it.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
 * three MUST fail closed" — dplaax.spec rules/auth-grant.yaml).
 * `createDidGrant` (packages/provider-did/src/did.mts) does not
 * perform this three-way check today: `validateOwnerLogin` — the function
 * that implements it (packages/provider-did/src/transcript.mts) — is
 * exported from the package's public barrel but is never called from
 * `did.mts`'s `handle()`. This is a *deliberate*, reviewed scope boundary:
 * `did.mts` was left untouched with `validateOwnerLogin` extracted as a
 * pure, unit-tested function, and the request-flow `relationship` is
 * hardcoded to `"legacy"` — wiring the OWNER path (three-way kid match,
 * Fork-Y relationship check) into `handle()` is tracked as follow-up work,
 * not an oversight this task should silently patch (out of this file's
 * scope: runner + seed vectors, not `did.mts` itself — see the README's "P0
 * Auth Contract" section for the current OWNER-path fail-closed posture).
 *
 * The vector's `expect` stays normatively correct (`invalid_grant`) so P2
 * can vendor it unmodified. `it.fails` keeps this test green today while
 * making it a tripwire: the moment `did.mts` wires the three-way match in,
 * this test starts *passing for real* — which `it.fails` reports as a
 * failure (an unexpectedly-passing expected-failure), a loud, impossible-
 * to-miss signal to delete this entry from `KNOWN_FAILING_VECTOR_IDS`.
 *
 * A live `createDidGrant` run against this exact vector's request confirms
 * it mints a 200 today (not the 400 `invalid_grant` the vector expects) —
 * proving the three-way check genuinely isn't wired in, not merely a
 * hypothetical gap.
 */
const KNOWN_FAILING_VECTOR_IDS: ReadonlySet<string> = new Set(["auth-grant-kid-mismatch-001"]);

describe("conformance vectors (dplaax.spec auth.* / did-resolution-auth rules)", () => {
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

/** Matches `sync-spec-vectors.sh`'s own glob: `auth-*.json` / `did-resolution-*.json`. */
const SYNC_VECTOR_GLOB = /^(auth-|did-resolution-).*\.json$/;

async function listSyncCandidateFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir);
	return entries.filter((f) => SYNC_VECTOR_GLOB.test(f)).sort();
}

async function sha256OfFile(filePath: string): Promise<string> {
	const bytes = await readFile(filePath);
	return createHash("sha256").update(bytes).digest("hex");
}

interface DriftCheckInput {
	manifest: { files: Record<string, string> };
	upstreamVectorsDir: string;
	vendoredVectorsDir: string;
}

/**
 * Compares three filename sets — upstream spec vectors (`auth-*.json` /
 * `did-resolution-*.json` under `upstreamVectorsDir`), `SYNC_MANIFEST.json`
 * keys, and the locally vendored copies under `vendoredVectorsDir` — plus
 * the sha256 of both the upstream AND the vendored bytes of every
 * manifest-listed file against the manifest's recorded digest.
 *
 * Returns a list of human-readable drift descriptions; empty means fully in
 * sync. The original check (Codex review, C3) only iterated
 * `manifest.files` and hashed the upstream copy — it missed a NEW spec
 * vector not yet in the manifest, and a stale/edited LOCAL vendored copy.
 * This catches both, plus a manifest entry whose vendored copy or upstream
 * source went missing.
 */
async function computeVectorDrift(input: DriftCheckInput): Promise<string[]> {
	const { manifest, upstreamVectorsDir, vendoredVectorsDir } = input;
	const issues: string[] = [];

	const upstreamFiles = new Set(await listSyncCandidateFiles(upstreamVectorsDir));
	const manifestFiles = new Set(Object.keys(manifest.files));
	const vendoredFiles = new Set(await listSyncCandidateFiles(vendoredVectorsDir));

	for (const f of upstreamFiles) {
		if (!manifestFiles.has(f)) {
			issues.push(`upstream vector "${f}" is not in the manifest (new vector, not yet synced)`);
		}
	}
	for (const f of manifestFiles) {
		if (!upstreamFiles.has(f)) {
			issues.push(`manifest lists "${f}" but it no longer exists upstream (removed/renamed spec vector)`);
		}
		if (!vendoredFiles.has(f)) {
			issues.push(`manifest lists "${f}" but no vendored copy exists locally`);
		}
	}
	for (const f of vendoredFiles) {
		if (!manifestFiles.has(f)) {
			issues.push(`local vendored file "${f}" is not tracked in the manifest`);
		}
	}

	for (const [file, expectedSha256] of Object.entries(manifest.files)) {
		if (upstreamFiles.has(file)) {
			const actual = await sha256OfFile(path.join(upstreamVectorsDir, file));
			if (actual !== expectedSha256) {
				issues.push(`upstream bytes for "${file}" changed since last sync (spec repo drift)`);
			}
		}
		if (vendoredFiles.has(file)) {
			const actual = await sha256OfFile(path.join(vendoredVectorsDir, file));
			if (actual !== expectedSha256) {
				issues.push(`vendored copy of "${file}" no longer matches the manifest (stale/edited local copy)`);
			}
		}
	}

	return issues;
}

describe.skipIf(!process.env.DPLAAX_SPEC_DIR)(
	"spec-vector drift check (DPLAAX_SPEC_DIR set)",
	() => {
		it("upstream spec vectors, SYNC_MANIFEST.json, and locally vendored copies are all in sync (filenames + sha256, both directions)", async () => {
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

			const issues = await computeVectorDrift({
				manifest,
				upstreamVectorsDir: path.join(specDir, "vectors"),
				vendoredVectorsDir: VECTORS_DIR,
			});

			expect(issues, issues.join("\n")).toEqual([]);
		});
	},
);

describe("spec-vector drift check — detection logic (fixture-driven, always runs)", () => {
	it("flags a new upstream vector missing from the manifest, a stale/edited vendored copy, AND a manifest entry whose upstream vector no longer exists, and reports clean once all three are fixed", async () => {
		// Not gated on DPLAAX_SPEC_DIR: this proves computeVectorDrift itself
		// catches all three drift classes it's documented to detect (new
		// upstream vector, stale/edited local copy, removed/renamed upstream
		// vector), using throwaway fixture directories rather than the real
		// spec checkout.
		const tmpRoot = await mkdtemp(path.join(tmpdir(), "conformance-drift-check-"));
		try {
			const specVectorsDir = path.join(tmpRoot, "spec", "vectors");
			const vendoredDir = path.join(tmpRoot, "vendored");
			await mkdir(specVectorsDir, { recursive: true });
			await mkdir(vendoredDir, { recursive: true });

			const stableContent = JSON.stringify({ id: "auth-stable-001" });
			const staleVendoredContent = JSON.stringify({ id: "auth-stable-001", tampered: true });
			const newUpstreamContent = JSON.stringify({ id: "auth-new-001" });
			// (c) a manifest-tracked, still-vendored vector whose upstream
			// source has been removed/renamed in the spec repo.
			const removedContent = JSON.stringify({ id: "auth-removed-001" });

			await writeFile(path.join(specVectorsDir, "auth-stable-001.json"), stableContent);
			// (a) a new upstream vector the manifest doesn't know about yet.
			await writeFile(path.join(specVectorsDir, "auth-new-001.json"), newUpstreamContent);
			// (b) a local vendored copy that has drifted from what was synced.
			await writeFile(path.join(vendoredDir, "auth-stable-001.json"), staleVendoredContent);
			// (c) vendored + manifest-tracked, but deliberately NOT written to
			// specVectorsDir — simulates the upstream spec vector having been
			// removed or renamed after it was last synced.
			await writeFile(path.join(vendoredDir, "auth-removed-001.json"), removedContent);

			const driftedManifest = {
				files: {
					"auth-stable-001.json": createHash("sha256").update(stableContent).digest("hex"),
					"auth-removed-001.json": createHash("sha256").update(removedContent).digest("hex"),
				},
			};

			const issues = await computeVectorDrift({
				manifest: driftedManifest,
				upstreamVectorsDir: specVectorsDir,
				vendoredVectorsDir: vendoredDir,
			});

			expect(
				issues.some((i) => i.includes('"auth-new-001.json"') && i.includes("not in the manifest")),
			).toBe(true);
			expect(
				issues.some(
					(i) => i.includes('"auth-stable-001.json"') && i.includes("stale/edited local copy"),
				),
			).toBe(true);
			expect(
				issues.some(
					(i) =>
						i.includes('"auth-removed-001.json"') && i.includes("no longer exists upstream"),
				),
			).toBe(true);

			// Fix all three drifts — sync the new vector, restore the tampered
			// vendored copy, and decommission the removed-upstream vector
			// (delete its vendored copy + drop it from the manifest) — the
			// check must go clean, proving it doesn't just always-fail.
			await writeFile(path.join(vendoredDir, "auth-stable-001.json"), stableContent);
			await writeFile(path.join(vendoredDir, "auth-new-001.json"), newUpstreamContent);
			await rm(path.join(vendoredDir, "auth-removed-001.json"));
			const fixedManifest = {
				files: {
					"auth-stable-001.json": createHash("sha256").update(stableContent).digest("hex"),
					"auth-new-001.json": createHash("sha256").update(newUpstreamContent).digest("hex"),
				},
			};

			const cleanIssues = await computeVectorDrift({
				manifest: fixedManifest,
				upstreamVectorsDir: specVectorsDir,
				vendoredVectorsDir: vendoredDir,
			});

			expect(cleanIssues).toEqual([]);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});
});
