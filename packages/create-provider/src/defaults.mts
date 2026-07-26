/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Generator-baked-in defaults. Per create-app.md § 3.3, the generator pins exact
// literals at build time; consumers regenerate by running a newer generator
// version if they want a newer baseline.
//
// These constants are the dependency baseline of the canonical template
// (originally the pre-M4 reference instance's package.json — 2026-05-28 snapshot, provin-line/auth
// commit 21fe40c). When the baseline upgrades, refresh this file in
// lockstep with a generator MINOR bump (see create-app.md § 3.3).

/** Exact-pin runtime + dev dep versions emitted into generated package.json. */
export const DEFAULT_DEP_VERSIONS = {
	// Framework (o3co) — runtime
	"@o3co/auth-provider-core": "0.5.3",
	"@o3co/auth.utils": "0.0.4",
	"@o3co/ts.hocon": "0.1.5",
	// Runtime — non-o3co
	express: "5.2.1",
	// The ed25519_raw DID-grant verifier resolves this via the instance's
	// import.meta.resolve, so it must be a DIRECT runtime dep of the instance
	// (auth-provider-did declares it only as an optional peer).
	"@noble/ed25519": "3.1.0",
	// Dev
	"@types/express": "5.0.6",
	"@types/node": "25.6.0",
	typescript: "5.9.3",
	vitest: "4.1.4",
} as const;

/** Default git-subdirectory ref for `@provin-line/auth-provider-dplaax-module`. */
export const DEFAULT_DPLAAX_MODULE_REF = "main";

/** Default packageManager field in generated package.json. */
export const DEFAULT_PACKAGE_MANAGER =
	"pnpm@10.30.2+sha512.36cdc707e7b7940a988c9c1ecf88d084f8514b5c3f085f53a2e244c2921d3b2545bc20dd4ebe1fc245feec463bb298aecea7a63ed1f7680b877dc6379d8d0cb4";

/** Default http.port in application.conf. */
export const DEFAULT_PORT = 3000;

/** Default SPDX license id. */
export const DEFAULT_LICENSE = "Apache-2.0";

/**
 * Default DID registry baseUrl emitted into config/application.conf.
 * The HOCON also exposes `${?DPLAAX_REGISTRY_BASE_URL}` so operators
 * override at runtime via env var.
 */
export const DEFAULT_REGISTRY_BASE_URL = "https://registry.dplaax.dev";

/**
 * Build the `@provin-line/auth-provider-dplaax-module` dep value for a given
 * git ref. pnpm 10.x git-subdirectory syntax — NOT npm-compatible.
 *
 * @see https://pnpm.io/10.x/package-sources
 */
export function buildDplaaxModuleDep(ref: string): string {
	return `github:provin-line/auth#${ref}&path:/packages/provider-dplaax-module`;
}

/**
 * The single SPDX license currently supported by the generator.
 *
 * create-app.md § 4.2 allow-lists `--license <SPDX>` values, and the
 * generator carries only one verbatim LICENSE body (Apache-2.0). To avoid
 * the false-declaration risk where `package.json#license = "MIT"` ships
 * alongside an Apache-2.0 LICENSE file, the v0.1 generator restricts the
 * value to this allow-list of one. A follow-up issue will broaden the
 * allow-list by carrying the matching verbatim license bodies.
 */
export const SUPPORTED_LICENSES = ["Apache-2.0"] as const;
export type SupportedLicense = (typeof SUPPORTED_LICENSES)[number];

export function isSupportedLicense(value: string): value is SupportedLicense {
	return (SUPPORTED_LICENSES as readonly string[]).includes(value);
}

/**
 * Package managers accepted by `--package-manager`.
 *
 * The scaffold only works under pnpm in v0.1 because the dPLaaX-module dep
 * uses the pnpm 10.x git-subdirectory syntax (`github:...&path:/...`) which
 * npm and yarn do not understand. The flag is kept as a responsibility name
 * — "select the install runner" — so a future PM that gains git-subdirectory
 * support can be added to this allow-list without an API rename.
 *
 * This is an allow-list of bin names used in the emitted Makefile + README;
 * the `packageManager` field in the generated package.json stays pinned to
 * DEFAULT_PACKAGE_MANAGER regardless (Corepack version pinning).
 */
export const SUPPORTED_PACKAGE_MANAGERS = ["pnpm"] as const;
export type SupportedPackageManager =
	(typeof SUPPORTED_PACKAGE_MANAGERS)[number];

export function isSupportedPackageManager(
	value: string,
): value is SupportedPackageManager {
	return (SUPPORTED_PACKAGE_MANAGERS as readonly string[]).includes(value);
}
