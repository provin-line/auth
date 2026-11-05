/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The provin packages a generated app installs, at the versions this
// generator release composes. Upstream's generator composes the modules among
// them as packages outside its release, read from a project pnpm installed
// them into; the library they depend on comes with them.

/** A provin package a generated app installs from npm. */
export interface ProvinPackage {
	/** Its npm name. */
	readonly name: string;
	/** The exact version this generator release composes. */
	readonly version: string;
	/**
	 * Whether the app composes its `./module`, a package outside auth.provider's
	 * release that its generator reads. A library the modules depend on is not one.
	 */
	readonly module: boolean;
}

/** Frozen: every generation reads it, so a write by an importer would change what later apps install. */
export const PROVIN_PACKAGES: readonly ProvinPackage[] = Object.freeze(
	[
		{ name: "@provin-line/auth-did-grant", version: "0.1.0", module: true },
		{ name: "@provin-line/auth-did-grant-store", version: "0.1.0", module: true },
		{ name: "@provin-line/auth-dplaax-registry", version: "0.1.0", module: true },
		{ name: "@provin-line/did-dplaax", version: "0.1.0", module: false },
	].map((p) => Object.freeze(p)),
);

/** The OAuth grant type the DID grant is requested by. */
export const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";
