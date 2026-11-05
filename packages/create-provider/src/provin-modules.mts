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

import { readFileSync } from "node:fs";

/**
 * This generator release's version. The repository releases every package
 * under one version, so it is the version of each provin package the release
 * composes.
 */
const RELEASE = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
	.version;

/**
 * What a provin package is to a generated app: a `module` the app composes,
 * which auth.provider's generator reads as a package outside its release, or
 * a `dependency` the modules bring in.
 */
export type ProvinPackageRole = "module" | "dependency";

/** A provin package a generated app installs from npm. */
export interface ProvinPackage {
	/** Its npm name. */
	readonly name: string;
	/** The exact version this generator release composes, which generation refuses to differ from. */
	readonly version: string;
	readonly role: ProvinPackageRole;
}

/** Frozen: every generation reads it, so a write by an importer would change what later apps install. */
export const PROVIN_PACKAGES: readonly ProvinPackage[] = Object.freeze(
	(
		[
			{ name: "@provin-line/auth-did-grant", role: "module" },
			{ name: "@provin-line/auth-did-grant-store", role: "module" },
			{ name: "@provin-line/auth-dplaax-registry", role: "module" },
			{ name: "@provin-line/did-dplaax", role: "dependency" },
		] as const
	).map((p) => Object.freeze({ name: p.name, version: RELEASE, role: p.role })),
);

/** The packages among `packages` with `role`. */
export function ofRole(packages: readonly ProvinPackage[], role: ProvinPackageRole): readonly ProvinPackage[] {
	return packages.filter((p) => p.role === role);
}

/** The OAuth grant type the DID grant is requested by. */
export const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";
