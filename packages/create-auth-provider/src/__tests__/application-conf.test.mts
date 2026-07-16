/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Task 10: the scaffold's `config/application.conf.tmpl` bakes a static
// `oauth.grants.did` slice. Task 8 hardened `didConfigSchema`
// (`allowedAudiences` non-empty, `revocationLatencyBoundSec` required — both
// with NO default, fail closed) — a freshly generated scaffold must still
// satisfy that schema out of the box, or every scaffolded provider fails to
// boot on day one (see task-8-report.md "Concerns" #1).
//
// This package has no HOCON-parser dependency (the generator only does
// `__TOKEN__` text substitution; it never HOCON-parses its own output), so
// this test renders the real template via `generateAuthProviderScaffold`
// and hand-extracts the `oauth.grants.did` block's literal (non-`${?VAR}`)
// assignments. Skipping `${?VAR}` lines mirrors real HOCON optional-
// substitution semantics when the referenced env var is unset — exactly the
// out-of-the-box state a freshly scaffolded, unconfigured instance boots
// with. The extracted slice is fed through the REAL `didConfigSchema` from
// `@provin-line/auth-provider-did` (added as a workspace devDependency for
// this test only — this package does not depend on it at runtime).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { didConfigSchema } from "@provin-line/auth-provider-did";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateAuthProviderScaffold } from "../generator.mjs";

let tmpRoot: string;

beforeEach(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "create-auth-provider-conf-"));
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Extract the flat `key -> literal value` pairs of a single-level HOCON
 * block (no nested `{}` inside it), skipping comments and unresolved
 * `${?VAR}` optional-substitution lines (a no-op when the env var is unset —
 * the prior literal assignment for that key stands, matching real HOCON
 * semantics). Sufficient for `oauth.grants.did`, which — by construction, in
 * this template — never nests another `{}` and only ever uses
 * JSON-compatible literal syntax (arrays, numbers, booleans, quoted
 * strings).
 */
function extractFlatHoconBlock(blockText: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const rawLine of blockText.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (value.startsWith("${?")) continue; // unresolved env override — no-op when unset
		result[key] = JSON.parse(value);
	}
	return result;
}

async function renderDidGrantSlice(): Promise<Record<string, unknown>> {
	const outDir = join(tmpRoot, "out");
	await generateAuthProviderScaffold({
		name: "test-scaffold",
		outDir,
		gitInit: false,
	});
	const conf = await readFile(join(outDir, "config/application.conf"), "utf8");
	// The only `did {` in application.conf.tmpl is `oauth.grants.did`
	// (verified: `grep -n "did" application.conf.tmpl` matches exactly one
	// line) — a non-greedy match up to the first `}` is safe since this
	// block has no nested braces.
	const match = conf.match(/\bdid\s*\{([\s\S]*?)\n\s*\}/);
	if (!match) {
		throw new Error("oauth.grants.did block not found in rendered application.conf");
	}
	return extractFlatHoconBlock(match[1]);
}

describe("scaffolded application.conf — oauth.grants.did vs didConfigSchema (Task 8 fail-closed contract)", () => {
	it("the rendered template's did-grant slice parses under didConfigSchema out of the box", async () => {
		const didSlice = await renderDidGrantSlice();
		const result = didConfigSchema.safeParse({
			oauth: { grants: { did: didSlice } },
		});
		expect(
			result.success,
			result.success ? "" : JSON.stringify(result.error.issues, null, 2),
		).toBe(true);
	});

	it("bakes a non-empty allowedAudiences placeholder", async () => {
		const didSlice = await renderDidGrantSlice();
		expect(Array.isArray(didSlice.allowedAudiences)).toBe(true);
		expect((didSlice.allowedAudiences as unknown[]).length).toBeGreaterThan(0);
	});

	it("bakes revocationLatencyBoundSec as a positive integer at least as large as accessToken.expiresIn", async () => {
		const didSlice = await renderDidGrantSlice();
		expect(didSlice.revocationLatencyBoundSec).toBeTypeOf("number");
		expect(didSlice.revocationLatencyBoundSec as number).toBeGreaterThanOrEqual(3600);
	});

	it("leaves authContract / ownerMigrationRatified unset — LEGACY_DID_LOGIN@1 stays the effective default", async () => {
		const didSlice = await renderDidGrantSlice();
		expect(didSlice.authContract).toBeUndefined();
		expect(didSlice.ownerMigrationRatified).toBeUndefined();
	});
});
