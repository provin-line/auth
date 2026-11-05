/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Generation composes exactly this release's provin packages: whatever
// project the modules are read from, what upstream recorded and what the
// project resolved must be the versions of PROVIN_PACKAGES.

import { ofRole, type ProvinPackage } from "./provin-modules.mjs";

/** Every version of `name` a pnpm lockfile resolved, read from its package keys. */
function lockedVersions(lockfile: string, name: string): Set<string> {
	const key = new RegExp(`^\\s+'?${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@([^':(\\s]+)`, "gm");
	return new Set([...lockfile.matchAll(key)].map((m) => m[1] ?? ""));
}

/**
 * Where what generation composed differs from `packages`, one line each,
 * naming the package and the versions: a module against the version
 * upstream recorded in `outside-modules.json`, a dependency against the
 * versions the project's `pnpm-lock.yaml` resolved.
 */
export function composedMismatches(
	outsideModules: string,
	lockfile: string,
	packages: readonly ProvinPackage[],
): string[] {
	const recorded = new Map(
		((JSON.parse(outsideModules) as { modules?: { name: string; version: string }[] }).modules ?? []).map((m) => [
			m.name,
			m.version,
		]),
	);
	const found: string[] = [];
	for (const p of ofRole(packages, "module")) {
		const version = recorded.get(p.name);
		if (version === undefined) found.push(`${p.name} is not composed`);
		else if (version !== p.version) found.push(`${p.name} is ${version}, not ${p.version}`);
	}
	for (const p of ofRole(packages, "dependency")) {
		const versions = lockedVersions(lockfile, p.name);
		if (versions.size === 0) found.push(`${p.name} is not installed`);
		for (const version of [...versions].filter((v) => v !== p.version).sort()) {
			found.push(`${p.name} is ${version}, not ${p.version}`);
		}
	}
	return found;
}
