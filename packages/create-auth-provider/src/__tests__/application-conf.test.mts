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
//
// Fix (Task 10 review, Important #1): `didConfigSchema.safeParse` above
// structurally CANNOT see `oauth.accessToken.expiresIn` — a sibling config
// slice outside `oauth.grants.did` — so it never proved the scaffolded
// provider actually boots. The cross-field lifetime-bound asserts
// (`auth.token.lifetime-bound`, `auth.legacy.did-login`) live in
// `createDidGrant` itself (`packages/auth-provider-did/src/did.mts`), not in
// the schema. The second `describe` block below exercises that REAL boot
// path: it builds `createDidGrant`'s actual `GrantDependencies` from the
// rendered template's own `accessToken.expiresIn` / `revocationLatencyBoundSec`
// / `legacyMaxTtlSec` / `allowedAudiences` values (never hardcoded) and
// asserts construction does not throw, plus a negative companion proving a
// future template regression (raising `expiresIn` without raising
// `legacyMaxTtlSec` in lockstep) would be caught.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSymmetricKeyStore } from "@o3co/auth-provider-core";
import type { CoreConfig } from "@o3co/auth-provider-core";
import { makeValidCoreConfig } from "@o3co/auth-provider-core/testing";
import { createDidGrant, didConfigSchema } from "@provin-line/auth-provider-did";
import type { DidDocumentResolver, ResolutionResult } from "@provin-line/auth-provider-did";
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

/** Renders the real scaffold template into a fresh tmp dir and returns the rendered `application.conf` text. */
async function renderApplicationConf(): Promise<string> {
	const outDir = join(tmpRoot, "out");
	await generateAuthProviderScaffold({
		name: "test-scaffold",
		outDir,
		gitInit: false,
	});
	return readFile(join(outDir, "config/application.conf"), "utf8");
}

/**
 * Extracts the `oauth.grants.did` block from a rendered `application.conf`.
 * The only `did {` in application.conf.tmpl is `oauth.grants.did` (verified:
 * `grep -n "did" application.conf.tmpl` matches exactly one line) — a
 * non-greedy match up to the first `}` is safe since this block has no
 * nested braces.
 */
function extractDidSlice(conf: string): Record<string, unknown> {
	const match = conf.match(/\bdid\s*\{([\s\S]*?)\n\s*\}/);
	if (!match) {
		throw new Error("oauth.grants.did block not found in rendered application.conf");
	}
	return extractFlatHoconBlock(match[1]);
}

/**
 * Extracts `oauth.accessToken.expiresIn` from a rendered `application.conf`
 * — the sibling slice `didConfigSchema.safeParse` structurally cannot see
 * (it only sees `oauth.grants.did`), but the real boot path in
 * `createDidGrant` reads it directly (`config.oauth.accessToken.expiresIn`).
 * There is exactly one `accessToken {` block in the template.
 */
function extractAccessTokenExpiresIn(conf: string): number {
	const match = conf.match(/\baccessToken\s*\{([\s\S]*?)\n\s*\}/);
	if (!match) {
		throw new Error("oauth.accessToken block not found in rendered application.conf");
	}
	const slice = extractFlatHoconBlock(match[1]);
	const expiresIn = slice.expiresIn;
	if (typeof expiresIn !== "number") {
		throw new Error(
			`oauth.accessToken.expiresIn did not resolve to a literal number: ${JSON.stringify(expiresIn)}`,
		);
	}
	return expiresIn;
}

async function renderDidGrantSlice(): Promise<Record<string, unknown>> {
	return extractDidSlice(await renderApplicationConf());
}

/**
 * Assembles a real `CoreConfig` (the exact shape `createDidGrant` reads via
 * `deps.config`) from `@o3co/auth-provider-core/testing`'s fixture, with
 * `oauth.accessToken.expiresIn` and `oauth.grants.did` overridden to the
 * caller-supplied values — kept as explicit parameters (rather than always
 * re-deriving from a fresh render) so the negative test below can perturb
 * just `expiresIn` while reusing the template's real did-grant slice.
 */
function buildCoreConfig(didSlice: Record<string, unknown>, expiresIn: number): CoreConfig {
	const base = makeValidCoreConfig();
	return {
		...base,
		oauth: {
			...base.oauth,
			accessToken: { expiresIn },
			grants: { did: didSlice },
		},
	};
}

const mockResolver: DidDocumentResolver = {
	async resolve(_did: string): Promise<ResolutionResult> {
		throw new Error(
			"not expected to be called — these tests only exercise createDidGrant's synchronous construction, never .handle()",
		);
	},
};

const keyStore = createSymmetricKeyStore("test-secret");

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
		// Dynamic comparison (Task 10 review, Important #1 compounding): read
		// accessToken.expiresIn from the SAME render rather than hardcoding it,
		// so this assertion tracks the template's actual value instead of a
		// number that can silently drift out of sync with it.
		const conf = await renderApplicationConf();
		const didSlice = extractDidSlice(conf);
		const expiresIn = extractAccessTokenExpiresIn(conf);
		expect(didSlice.revocationLatencyBoundSec).toBeTypeOf("number");
		expect(Number.isInteger(didSlice.revocationLatencyBoundSec)).toBe(true);
		expect(didSlice.revocationLatencyBoundSec as number).toBeGreaterThanOrEqual(expiresIn);
	});

	it("bakes legacyMaxTtlSec as a positive integer at least as large as accessToken.expiresIn", async () => {
		// Previously untested (Task 10 review, Important #1 compounding).
		const conf = await renderApplicationConf();
		const didSlice = extractDidSlice(conf);
		const expiresIn = extractAccessTokenExpiresIn(conf);
		expect(didSlice.legacyMaxTtlSec).toBeTypeOf("number");
		expect(didSlice.legacyMaxTtlSec as number).toBeGreaterThan(0);
		expect(Number.isInteger(didSlice.legacyMaxTtlSec)).toBe(true);
		expect(didSlice.legacyMaxTtlSec as number).toBeGreaterThanOrEqual(expiresIn);
	});

	it("leaves authContract / ownerMigrationRatified unset — LEGACY_DID_LOGIN@1 stays the effective default", async () => {
		const didSlice = await renderDidGrantSlice();
		expect(didSlice.authContract).toBeUndefined();
		expect(didSlice.ownerMigrationRatified).toBeUndefined();
	});
});

describe("scaffolded application.conf — real boot path via createDidGrant (Task 10 review, Important #1)", () => {
	it("createDidGrant constructs without throwing, fed the rendered template's actual oauth values", async () => {
		// This is the REAL boot-path assert `didConfigSchema.safeParse` above
		// cannot make: `createDidGrant` (the module.mts wiring boot-time calls
		// into) reads `config.oauth.accessToken.expiresIn` — a sibling slice
		// outside `oauth.grants.did` that the schema literally cannot see — and
		// enforces the `auth.token.lifetime-bound` / `auth.legacy.did-login`
		// cross-field bounds itself. Every value fed in here comes from the
		// same rendered template (never hardcoded).
		const conf = await renderApplicationConf();
		const didSlice = extractDidSlice(conf);
		const expiresIn = extractAccessTokenExpiresIn(conf);
		const config = buildCoreConfig(didSlice, expiresIn);

		expect(() => createDidGrant({ config, keyStore }, { resolver: mockResolver })).not.toThrow();
	});

	it("createDidGrant throws when expiresIn exceeds legacyMaxTtlSec (guards a future template regression)", async () => {
		// Negative companion: proves this test suite would actually catch a
		// future scaffold edit that raises oauth.accessToken.expiresIn without
		// raising oauth.grants.did.legacyMaxTtlSec in lockstep. Isolates the
		// legacyMaxTtlSec bound specifically by pushing
		// revocationLatencyBoundSec (a separate, independent bound in
		// createDidGrant) far out of the way, so only the legacyMaxTtlSec
		// assert can fire.
		const conf = await renderApplicationConf();
		const didSlice = extractDidSlice(conf);
		const legacyMaxTtlSec = didSlice.legacyMaxTtlSec as number;
		const tooLongExpiresIn = legacyMaxTtlSec + 1;
		const config = buildCoreConfig(
			{ ...didSlice, revocationLatencyBoundSec: tooLongExpiresIn + 100_000 },
			tooLongExpiresIn,
		);

		expect(() => createDidGrant({ config, keyStore }, { resolver: mockResolver })).toThrow(
			/legacyMaxTtlSec/,
		);
	});
});
