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
import { STAGED_PACKAGES } from "../../../../scripts/stage-provin-packages.mjs";
import { PROVIN_PACKAGES } from "../index.mjs";
import { STAGING_PACKAGE_MANAGER } from "../staging.mjs";

const packages = join(import.meta.dirname, "..", "..", "..");
const repository = join(packages, "..");
/** This generator's own version: the repository's one version, a release's. */
const release = (JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as { version: string })
	.version;

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
	it("names the three modules and the library they depend on, each by its role", () => {
		expect(PROVIN_PACKAGES.map((p) => [p.name, p.role])).toEqual([
			["@provin-line/auth-did-grant", "module"],
			["@provin-line/auth-did-grant-store", "module"],
			["@provin-line/auth-dplaax-registry", "module"],
			["@provin-line/did-dplaax", "dependency"],
		]);
	});

	it("holds every package at this generator release's version", () => {
		expect(PROVIN_PACKAGES.map((p) => p.version)).toEqual(PROVIN_PACKAGES.map(() => release));
	});

	it.each(PROVIN_PACKAGES.map((p) => [p.name, p] as const))("holds %s at the version this repository carries", (name, p) => {
		const manifest = manifests.get(name);
		expect(manifest?.version).toBe(p.version);
	});

	it("marks a module exactly where the package declares itself for auth.provider's generator", () => {
		for (const p of PROVIN_PACKAGES) {
			expect({ name: p.name, declared: manifests.get(p.name)?.authProvider !== undefined }).toEqual({
				name: p.name,
				declared: p.role === "module",
			});
		}
	});

	it("is the list scripts/stage-provin-packages.mjs stages, by name and role", async () => {
		const staged = await Promise.all(
			STAGED_PACKAGES.map(async (p) => {
				const manifest = JSON.parse(await readFile(join(packages, p.dir, "package.json"), "utf8")) as Manifest;
				return [manifest.name, p.role];
			}),
		);
		expect(staged.sort()).toEqual(PROVIN_PACKAGES.map((p) => [p.name, p.role]).sort());
	});

	it("is staged with the pnpm this repository installs with", async () => {
		const root = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as { packageManager: string };
		// The root's carries corepack's integrity hash after `+`.
		expect(root.packageManager.split("+")[0]).toBe(STAGING_PACKAGE_MANAGER);
	});

	it("is frozen, so an importer cannot change what an app installs", () => {
		expect(Object.isFrozen(PROVIN_PACKAGES)).toBe(true);
		for (const p of PROVIN_PACKAGES) expect(Object.isFrozen(p)).toBe(true);
	});
});
