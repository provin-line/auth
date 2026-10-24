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
// These constants are the dependency baseline of the canonical template:
// The baseline is auth.provider 0.18.4: the generator package pins
// @o3co/auth-provider-scaffold at exactly that version, and the app it writes
// carries upstream's own pins. When the baseline moves, bump the scaffold pin
// and refresh this file with a generator MINOR bump (create-app.md § 3.3).

/**
 * Exact pins of the dependencies the overlay adds to upstream's manifest.
 * Upstream's own dependencies come with upstream's generator.
 */
export const DEFAULT_DEP_VERSIONS = {
	// The ed25519_raw DID-grant verifier resolves this from the app's root
	// through import.meta.resolve, so it must be a DIRECT runtime dependency of
	// the app (did-grant declares it only as an optional peer).
	"@noble/ed25519": "3.2.0",
} as const;

/**
 * The modules upstream's generator is asked to compose: what they need to run
 * (tokens, keys, issuer, clients, store, audit, http, ...) comes with them.
 */
export const LISTED_MODULES = [
	"@mod/token-endpoint",
	"@mod/client-allowance",
	"@mod/outbound",
	"@mod/discovery",
	"@mod/token-control",
] as const;

/**
 * Default git ref of provin-line/auth for the provin modules. Library-only
 * default: `main` is a MOVING ref, acceptable for tests and tooling but never
 * for shipped scaffolds; the CLI deliberately requires the flag and accepts
 * only a commit SHA (create-app.md § 3.3 / § 4.1).
 */
export const DEFAULT_DPLAAX_MODULE_REF = "main";

/** Default SPDX license id. */
export const DEFAULT_LICENSE = "Apache-2.0";

/** Default DID registry URL: `DPLAAX_REGISTRY_URL` in the generated `.env.example`. */
export const DEFAULT_REGISTRY_BASE_URL = "https://registry.dplaax.dev";

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
