/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// PROVIN_PACKAGES is what a generated app installs from npm: each entry must
// be the version this repository's package carries, so a release publishes
// what the generator of the same release names.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIN_PACKAGES } from "../index.mjs";

const packages = join(import.meta.dirname, "..", "..", "..");

interface Manifest {
	name: string;
	version: string;
	authProvider?: unknown;
}

const manifests = new Map<string, Manifest>();
for (const dir of await readdir(packages)) {
	try {
		const manifest = JSON.parse(await readFile(join(packages, dir, "package.json"), "utf8")) as Manifest;
		manifests.set(manifest.name, manifest);
	} catch {
		// Not a package directory.
	}
}

describe("PROVIN_PACKAGES", () => {
	it("names the three modules and the library they depend on", () => {
		expect(PROVIN_PACKAGES.map((p) => [p.name, p.module])).toEqual([
			["@provin-line/auth-did-grant", true],
			["@provin-line/auth-did-grant-store", true],
			["@provin-line/auth-dplaax-registry", true],
			["@provin-line/did-dplaax", false],
		]);
	});

	it.each(PROVIN_PACKAGES.map((p) => [p.name, p] as const))("holds %s at the version this repository carries", (name, p) => {
		const manifest = manifests.get(name);
		expect(manifest?.version).toBe(p.version);
	});

	it("marks a module exactly where the package declares itself for auth.provider's generator", () => {
		for (const p of PROVIN_PACKAGES) {
			expect({ name: p.name, declared: manifests.get(p.name)?.authProvider !== undefined }).toEqual({
				name: p.name,
				declared: p.module,
			});
		}
	});

	it("is frozen, so an importer cannot change what an app installs", () => {
		expect(Object.isFrozen(PROVIN_PACKAGES)).toBe(true);
		for (const p of PROVIN_PACKAGES) expect(Object.isFrozen(p)).toBe(true);
	});
});
