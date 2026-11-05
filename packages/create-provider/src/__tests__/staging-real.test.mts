/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The generator's own staging, as an operator runs it: pnpm installs the
// modules from the registry the invoking directory's .npmrc names, here a
// loopback one serving this checkout's packages. It stages under a directory
// of this test's own, and pnpm keeps its metadata in a cache of this run's own:
// a loopback registry's port comes round again, serving other bytes under the
// same versions, which a shared cache would answer from.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { serveTarballs } from "../../../../scripts/local-registry.mjs";
import { generateAuthProviderScaffold } from "../generator.mjs";
import { PROVIN_PACKAGES } from "../provin-modules.mjs";
import { stageProvinModules } from "../staging.mjs";

let registry: { url: string; close: () => Promise<void> };
let root: string;
let tmpRoot: string;

beforeAll(async () => {
	registry = await serveTarballs(inject("stagedTarballs"));
	root = await mkdtemp(join(tmpdir(), "create-auth-provider-real-"));
	tmpRoot = join(root, "tmp");
	await mkdir(tmpRoot);
	vi.stubEnv("pnpm_config_cache_dir", join(root, "pnpm-cache"));
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await registry.close();
	await rm(root, { recursive: true, force: true });
});

async function operatorDir(npmrc: string): Promise<string> {
	const dir = await mkdtemp(join(root, "operator-"));
	await writeFile(join(dir, ".npmrc"), npmrc);
	return dir;
}

describe("stageProvinModules", () => {
	it("installs the modules from the registry the invoking directory's .npmrc names, and removes the project", async () => {
		const host = new URL(registry.url).host;
		const dir = await operatorDir(`@provin-line:registry=${registry.url}/\n//${host}/:_authToken=OPERATOR-SECRET\n`);
		const project = await stageProvinModules({ cwd: dir, tmpRoot });
		try {
			expect(await readdir(tmpRoot)).toHaveLength(1);
			for (const p of PROVIN_PACKAGES.filter((q) => q.role === "module")) {
				const manifest = JSON.parse(await readFile(join(project.dir, "node_modules", p.name, "package.json"), "utf8"));
				expect({ name: p.name, version: manifest.version }).toEqual({ name: p.name, version: p.version });
			}
			const app = join(root, "app");
			await generateAuthProviderScaffold({ name: "app", outDir: app, outsideFrom: project.dir, gitInit: false });
			const appNpmrc = await readFile(join(app, ".npmrc"), "utf8");
			expect(appNpmrc).toContain(`@provin-line:registry=${registry.url}/`);
			expect(appNpmrc).not.toContain("OPERATOR-SECRET");
		} finally {
			await project.remove();
		}
		expect(existsSync(project.dir)).toBe(false);
		expect(await readdir(tmpRoot)).toEqual([]);
	});

	it("says why when the install fails, and leaves no project behind", async () => {
		const empty = await serveTarballs(await mkdtemp(join(root, "empty-")));
		try {
			const dir = await operatorDir(`@provin-line:registry=${empty.url}/\n`);
			await expect(stageProvinModules({ cwd: dir, tmpRoot })).rejects.toThrow(
				/installing the provin modules failed: .*ERR_PNPM_/s,
			);
			expect(await readdir(tmpRoot)).toEqual([]);
		} finally {
			await empty.close();
		}
	});
});
