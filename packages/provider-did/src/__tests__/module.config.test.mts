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

// Task 8: config hardening — audience allowlist / auth contract / owner
// migration gate / token lifetime bounds. Two layers under test:
//
//   1. `didConfigSchema` (zod): the boot-time shape check on
//      `oauth.grants.did`. Covers the fields this task adds and the
//      `superRefine` gate on OWNER_* contracts.
//   2. `createDidGrant`'s boot-time asserts (did.mts): cross-field checks
//      the schema itself can't express, because `accessToken.expiresIn`
//      lives in a sibling config slice (`oauth.accessToken`, not
//      `oauth.grants.did`) that `didConfigSchema` never sees.

import { createSymmetricKeyStore, type GrantDependencies } from "@o3co/auth-provider-core";
import { describe, expect, it } from "vitest";
import { createDidGrant } from "../did.mjs";
import { didConfigSchema } from "../module.mjs";
import type { DidDocumentResolver, ResolutionResult } from "../resolver/types.mjs";

// ─── Schema-level tests (didConfigSchema) ──────────────────────────────────

/**
 * A minimal `oauth.grants.did` slice that satisfies the schema on its own —
 * every field with no default is filled in. Tests mutate a deep-ish clone of
 * this via `withDid` rather than repeating the whole shape each time.
 */
function validDidSlice(): Record<string, unknown> {
	return {
		allowedAudiences: ["https://api.example.com"],
		revocationLatencyBoundSec: 3600,
	};
}

/** Wrap a `did` slice into the full shape `didConfigSchema.parse` expects. */
function withDid(did: Record<string, unknown> | undefined) {
	return {
		oauth: {
			grants: did === undefined ? {} : { did },
		},
	};
}

describe("didConfigSchema — allowedAudiences (fail closed)", () => {
	it("rejects when oauth.grants.did is absent entirely", () => {
		const result = didConfigSchema.safeParse(withDid(undefined));
		expect(result.success).toBe(false);
	});

	it("rejects when allowedAudiences is absent", () => {
		const did = validDidSlice();
		did.allowedAudiences = undefined;
		delete did.allowedAudiences;
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
	});

	it("rejects when allowedAudiences is an empty array", () => {
		const did = { ...validDidSlice(), allowedAudiences: [] };
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
	});

	it("accepts a non-empty allowedAudiences", () => {
		const result = didConfigSchema.safeParse(withDid(validDidSlice()));
		expect(result.success).toBe(true);
	});
});

describe("didConfigSchema — revocationLatencyBoundSec (fail closed, no default)", () => {
	it("rejects when revocationLatencyBoundSec is absent", () => {
		const did = validDidSlice();
		delete did.revocationLatencyBoundSec;
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
	});

	it("rejects a non-positive revocationLatencyBoundSec", () => {
		const did = { ...validDidSlice(), revocationLatencyBoundSec: 0 };
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
	});
});

describe("didConfigSchema — authContract default", () => {
	it("defaults authContract to LEGACY_DID_LOGIN@1 when omitted (scaffold default)", () => {
		const result = didConfigSchema.safeParse(withDid(validDidSlice()));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.oauth.grants.did?.authContract).toBe("LEGACY_DID_LOGIN@1");
		}
	});

	it("defaults ownerMigrationRatified to false and legacyMaxTtlSec to 900 when omitted", () => {
		const result = didConfigSchema.safeParse(withDid(validDidSlice()));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.oauth.grants.did?.ownerMigrationRatified).toBe(false);
			expect(result.data.oauth.grants.did?.legacyMaxTtlSec).toBe(900);
		}
	});

	it("defaults resolver bounds passthrough to {} when omitted", () => {
		const result = didConfigSchema.safeParse(withDid(validDidSlice()));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.oauth.grants.did?.resolver).toEqual({});
		}
	});
});

describe("didConfigSchema — OWNER_* contract gate (auth.migration.enable-gate)", () => {
	it("rejects OWNER_AUTHENTICATION_LOGIN@1 without ownerMigrationRatified", () => {
		const did = {
			...validDidSlice(),
			authContract: "OWNER_AUTHENTICATION_LOGIN@1",
			tokenEndpoint: "https://auth.example.com/oauth/token",
		};
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
		if (!result.success) {
			const messages = result.error.issues.map((i) => i.message);
			expect(messages).toContain(
				"owner contract requires ownerMigrationRatified: true (auth.migration.enable-gate)",
			);
		}
	});

	it("rejects OWNER_ASSERTION_CONTROL_LOGIN@1 without tokenEndpoint", () => {
		const did = {
			...validDidSlice(),
			authContract: "OWNER_ASSERTION_CONTROL_LOGIN@1",
			ownerMigrationRatified: true,
		};
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path.join("."));
			expect(paths).toContain("oauth.grants.did.tokenEndpoint");
		}
	});

	it("rejects OWNER_* with neither ownerMigrationRatified nor tokenEndpoint (both issues reported)", () => {
		const did = { ...validDidSlice(), authContract: "OWNER_AUTHENTICATION_LOGIN@1" };
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
		}
	});

	it("parses OWNER_AUTHENTICATION_LOGIN@1 with ownerMigrationRatified + tokenEndpoint", () => {
		const did = {
			...validDidSlice(),
			authContract: "OWNER_AUTHENTICATION_LOGIN@1",
			ownerMigrationRatified: true,
			tokenEndpoint: "https://auth.example.com/oauth/token",
		};
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(true);
	});

	it("parses OWNER_ASSERTION_CONTROL_LOGIN@1 with ownerMigrationRatified + tokenEndpoint", () => {
		const did = {
			...validDidSlice(),
			authContract: "OWNER_ASSERTION_CONTROL_LOGIN@1",
			ownerMigrationRatified: true,
			tokenEndpoint: "https://auth.example.com/oauth/token",
		};
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(true);
	});

	it("LEGACY_DID_LOGIN@1 does not require ownerMigrationRatified or tokenEndpoint", () => {
		const did = { ...validDidSlice(), authContract: "LEGACY_DID_LOGIN@1" };
		const result = didConfigSchema.safeParse(withDid(did));
		expect(result.success).toBe(true);
	});
});

// ─── Boot-time assert tests (createDidGrant, did.mts) ──────────────────────
//
// `accessToken.expiresIn` lives outside `oauth.grants.did`, so the two
// cross-field lifetime-bound checks can't be zod `superRefine` rules on
// `didConfigSchema` — they run as plain-Error boot asserts inside
// `createDidGrant`, which is where a fully-composed config (both slices)
// is available.

const mockResolver: DidDocumentResolver = {
	async resolve(): Promise<ResolutionResult> {
		throw new Error("not expected to be called — these tests only exercise createDidGrant's boot path");
	},
};

const mockKeyStore = createSymmetricKeyStore("test-secret");

function makeBootConfig(overrides: {
	expiresIn: number;
	authContract?: string;
	revocationLatencyBoundSec?: number;
	legacyMaxTtlSec?: number;
	allowedAudiences?: string[];
	tokenEndpoint?: string;
	ownerMigrationRatified?: boolean;
	supportedAlgorithms?: string[];
}): GrantDependencies["config"] {
	return {
		oauth: {
			jwt: { secret: "test-secret" },
			accessToken: { expiresIn: overrides.expiresIn },
			grants: {
				did: {
					allowedAudiences: overrides.allowedAudiences ?? ["https://api.example.com"],
					...(overrides.authContract !== undefined ? { authContract: overrides.authContract } : {}),
					...(overrides.revocationLatencyBoundSec !== undefined
						? { revocationLatencyBoundSec: overrides.revocationLatencyBoundSec }
						: {}),
					...(overrides.legacyMaxTtlSec !== undefined
						? { legacyMaxTtlSec: overrides.legacyMaxTtlSec }
						: {}),
					...(overrides.tokenEndpoint !== undefined ? { tokenEndpoint: overrides.tokenEndpoint } : {}),
					...(overrides.ownerMigrationRatified !== undefined
						? { ownerMigrationRatified: overrides.ownerMigrationRatified }
						: {}),
					...(overrides.supportedAlgorithms !== undefined
						? { supportedAlgorithms: overrides.supportedAlgorithms }
						: {}),
				},
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: hand-built boot-config fixture, same pattern as did.test.mts's mockConfig
	} as any;
}

/** A minimal fully-valid OWNER boot config — every OWNER-only requirement satisfied. */
function makeValidOwnerBootConfig(
	authContract: string,
	overrides: Partial<Parameters<typeof makeBootConfig>[0]> = {},
) {
	return makeBootConfig({
		expiresIn: 3600,
		authContract,
		revocationLatencyBoundSec: 3600,
		tokenEndpoint: "https://issuer.example/token",
		ownerMigrationRatified: true,
		supportedAlgorithms: ["ed25519_jws"],
		...overrides,
	});
}

describe("createDidGrant — boot-time lifetime-bound asserts", () => {
	it("throws when revocationLatencyBoundSec is absent (fail closed, no default)", () => {
		const config = makeBootConfig({ expiresIn: 3600 });
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/revocationLatencyBoundSec is required/,
		);
	});

	it("throws when expiresIn exceeds revocationLatencyBoundSec (rule auth.token.lifetime-bound)", () => {
		const config = makeBootConfig({
			expiresIn: 3600,
			revocationLatencyBoundSec: 1800,
			legacyMaxTtlSec: 3600,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/exceeds revocationLatencyBoundSec/,
		);
	});

	it("throws when authContract is LEGACY_DID_LOGIN@1 and expiresIn exceeds legacyMaxTtlSec (rule auth.legacy.did-login)", () => {
		const config = makeBootConfig({
			expiresIn: 3600,
			revocationLatencyBoundSec: 7200,
			legacyMaxTtlSec: 900,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/exceeds legacyMaxTtlSec/,
		);
	});

	it("does NOT apply legacyMaxTtlSec when authContract is not LEGACY_DID_LOGIN@1", () => {
		// The OWNER path is now wired in (the Option-B construction-time
		// stopgap was removed once `handle()` enforced `validateOwnerLogin` —
		// see "OWNER authContract — no longer refused at construction" below),
		// so a fully-valid OWNER contract constructs successfully even though
		// `legacyMaxTtlSec` (900) is below `expiresIn` (3600) — that bound is
		// `LEGACY_DID_LOGIN@1`-only (rule `auth.legacy.did-login`).
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", {
			revocationLatencyBoundSec: 7200,
			legacyMaxTtlSec: 900,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});

	it("succeeds when expiresIn is within both bounds", () => {
		const config = makeBootConfig({
			expiresIn: 3600,
			revocationLatencyBoundSec: 3600,
			legacyMaxTtlSec: 3600,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});

	it("succeeds at the boundary — expiresIn exactly equal to both bounds (<=, not <)", () => {
		const config = makeBootConfig({
			expiresIn: 900,
			revocationLatencyBoundSec: 900,
			legacyMaxTtlSec: 900,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});
});

// ─── OWNER authContract — no longer refused at construction ────────────────
//
// The OWNER validation path (`validateOwnerLogin` in transcript.mts —
// versioned transcript, three-way kid match, Fork-Y relationship) is now
// wired into `createDidGrant`'s request handler (`handle()`'s step 5b), so
// selecting an OWNER `authContract` no longer refuses at construction time
// (the former Option-B stopgap). Three boot-time requirements remain,
// mirroring the existing `allowedAudiences` / `revocationLatencyBoundSec`
// fail-closed style — a hand-built config that selects an OWNER contract
// without any of them still fails closed at construction:
//   - `tokenEndpoint`: `validateOwnerLogin` checks the transcript's
//     `token_endpoint` field against it.
//   - `ownerMigrationRatified: true`: rule `auth.migration.enable-gate` —
//     `didConfigSchema`'s `superRefine` already enforces this at parse
//     time; this re-asserts it for a hand-built config that skips
//     `didConfigSchema.parse`.
//   - Every configured `supportedAlgorithms` entry must be header-bearing
//     (JWS-family) — see "OWNER authContract requires header-bearing
//     supportedAlgorithms" below (rule `auth.grant.kid-match`).
// See `did.owner.test.mts` for the request-handling behavior itself
// (transcript parsing, three-way kid match, relationship enforcement,
// audience-required).

describe("createDidGrant — OWNER authContract no longer refuses at construction", () => {
	it("does NOT throw for authContract OWNER_AUTHENTICATION_LOGIN@1 when fully configured", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1");
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});

	it("does NOT throw for authContract OWNER_ASSERTION_CONTROL_LOGIN@1 when fully configured", () => {
		const config = makeValidOwnerBootConfig("OWNER_ASSERTION_CONTROL_LOGIN@1");
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});

	it("throws when authContract is OWNER_AUTHENTICATION_LOGIN@1 and tokenEndpoint is missing (fail closed)", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", { tokenEndpoint: undefined });
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/tokenEndpoint/,
		);
	});

	it("throws when authContract is OWNER_ASSERTION_CONTROL_LOGIN@1 and tokenEndpoint is missing (fail closed)", () => {
		const config = makeValidOwnerBootConfig("OWNER_ASSERTION_CONTROL_LOGIN@1", { tokenEndpoint: undefined });
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/tokenEndpoint/,
		);
	});

	it("does NOT throw for authContract LEGACY_DID_LOGIN@1 (the default) with otherwise-valid config", () => {
		const config = makeBootConfig({
			expiresIn: 3600,
			authContract: "LEGACY_DID_LOGIN@1",
			revocationLatencyBoundSec: 3600,
			legacyMaxTtlSec: 3600,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});
});

// ─── OWNER authContract requires ownerMigrationRatified (item 3) ───────────
//
// The removed Option-B stopgap incidentally enforced `auth.migration.
// enable-gate` for a hand-built config too (any OWNER `authContract` threw
// unconditionally). The wired-in replacement guards must not silently drop
// that enforcement — `didConfigSchema`'s `superRefine` already requires
// `ownerMigrationRatified: true` at parse time; this pins the same
// fail-closed re-assert `createDidGrant` performs for a config that skips
// `didConfigSchema.parse` (mirroring `allowedAudiences` / `tokenEndpoint`).

describe("createDidGrant — OWNER authContract requires ownerMigrationRatified", () => {
	it("throws when authContract is OWNER_AUTHENTICATION_LOGIN@1 and ownerMigrationRatified is not true (fail closed)", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", {
			ownerMigrationRatified: undefined,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/ownerMigrationRatified/,
		);
	});

	it("throws when ownerMigrationRatified is explicitly false", () => {
		const config = makeValidOwnerBootConfig("OWNER_ASSERTION_CONTROL_LOGIN@1", {
			ownerMigrationRatified: false,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/ownerMigrationRatified/,
		);
	});

	it("does NOT require ownerMigrationRatified for LEGACY_DID_LOGIN@1", () => {
		const config = makeBootConfig({
			expiresIn: 3600,
			authContract: "LEGACY_DID_LOGIN@1",
			revocationLatencyBoundSec: 3600,
			legacyMaxTtlSec: 3600,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});
});

// ─── OWNER authContract requires header-bearing supportedAlgorithms (item 1a) ──
//
// Converged review finding: `ed25519_raw` / `ed25519_prehash` sign a bare
// JSON message with no protected header at all, so `parsedMessage.headerKid`
// can only ever be `undefined` for them (enforced in `ed25519Raw.mts` /
// `ed25519Prehash.mts` — see their own test files for the payload-forgery
// regression this closes). An OWNER contract's three-way kid match (rule
// `auth.grant.kid-match`) is therefore unsatisfiable on those algorithms —
// this boot-time guard makes that a fail-closed construction error instead
// of a request that can simply never succeed, including under the
// `didConfigSchema` default `supportedAlgorithms: ["ed25519_raw"]`.

describe("createDidGrant — OWNER authContract requires header-bearing supportedAlgorithms", () => {
	it("throws when authContract is OWNER_* and supportedAlgorithms includes ed25519_raw", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", {
			supportedAlgorithms: ["ed25519_raw"],
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/header-bearing/,
		);
	});

	it("throws when authContract is OWNER_* and supportedAlgorithms includes ed25519_prehash", () => {
		const config = makeValidOwnerBootConfig("OWNER_ASSERTION_CONTROL_LOGIN@1", {
			supportedAlgorithms: ["ed25519_prehash"],
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/header-bearing/,
		);
	});

	it("throws when authContract is OWNER_* and supportedAlgorithms is omitted (defaults to ed25519_raw)", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", {
			supportedAlgorithms: undefined,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/header-bearing/,
		);
	});

	it("throws when only ONE of several configured supportedAlgorithms is not header-bearing", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", {
			supportedAlgorithms: ["ed25519_jws", "ed25519_raw"],
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).toThrow(
			/header-bearing/,
		);
	});

	it("does NOT throw when supportedAlgorithms is all JWS-family (ed25519_jws, es256_jws, es256k_jws)", () => {
		const config = makeValidOwnerBootConfig("OWNER_AUTHENTICATION_LOGIN@1", {
			supportedAlgorithms: ["ed25519_jws", "es256_jws", "es256k_jws"],
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});

	it("does NOT restrict supportedAlgorithms for LEGACY_DID_LOGIN@1 (ed25519_raw stays the default)", () => {
		const config = makeBootConfig({
			expiresIn: 3600,
			authContract: "LEGACY_DID_LOGIN@1",
			revocationLatencyBoundSec: 3600,
			legacyMaxTtlSec: 3600,
		});
		expect(() => createDidGrant({ config, keyStore: mockKeyStore }, { resolver: mockResolver })).not.toThrow();
	});
});
