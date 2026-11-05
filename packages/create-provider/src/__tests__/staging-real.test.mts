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
// loopback one serving this checkout's packages.

import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { serveTarballs } from "../../../../scripts/local-registry.mjs";
import { generateAuthProviderScaffold } from "../generator.mjs";
import { PROVIN_PACKAGES } from "../provin-modules.mjs";
import { stageProvinModules } from "../staging.mjs";

const STAGE_PREFIX = "create-auth-provider-stage-";
const staged = () => readdir(tmpdir()).then((names) => names.filter((n) => n.startsWith(STAGE_PREFIX)).sort());

let registry: { url: string; close: () => Promise<void> };
let root: string;

beforeAll(async () => {
	registry = await serveTarballs(inject("stagedTarballs"));
	root = await mkdtemp(join(tmpdir(), "create-auth-provider-real-"));
});

afterAll(async () => {
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
		const before = await staged();
		const project = await stageProvinModules({ cwd: dir });
		try {
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
		expect(await staged()).toEqual(before);
	});

	it("says why when the install fails, and leaves no project behind", async () => {
		const empty = await serveTarballs(await mkdtemp(join(root, "empty-")));
		try {
			const dir = await operatorDir(`@provin-line:registry=${empty.url}/\n`);
			const before = await staged();
			await expect(stageProvinModules({ cwd: dir })).rejects.toThrow(/installing the provin modules failed: .*ERR_PNPM_/s);
			expect(await staged()).toEqual(before);
		} finally {
			await empty.close();
		}
	});
});
