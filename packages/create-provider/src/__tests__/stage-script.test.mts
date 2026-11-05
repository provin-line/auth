/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// scripts/stage-provin-packages.mjs stages into a directory `make instances`
// passes again run after run: what an earlier run left there must not reach
// the project this run installs.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stageProvinPackages } from "../../../../scripts/stage-provin-packages.mjs";
import { PROVIN_PACKAGES } from "../provin-modules.mjs";

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "create-auth-provider-restage-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("stageProvinPackages", () => {
	it("starts from nothing an earlier run left in its directory", { timeout: 180_000 }, async () => {
		const stale = ["project/pnpm-lock.yaml", "project/node_modules/.stale", "tarballs/stale-0.0.1.tgz", "pnpm-cache/.stale"];
		for (const path of stale) {
			await mkdir(join(dir, path, ".."), { recursive: true });
			await writeFile(join(dir, path), "left by an earlier run\n");
		}
		const staged = await stageProvinPackages({ dir });
		await staged.close();
		expect(stale.filter((path) => existsSync(join(dir, path)) && path !== "project/pnpm-lock.yaml")).toEqual([]);
		expect(await readFile(join(dir, "project", "pnpm-lock.yaml"), "utf8")).not.toContain("left by an earlier run");
		for (const p of PROVIN_PACKAGES.filter((q) => q.role === "module")) {
			expect(existsSync(join(staged.project, "node_modules", p.name, "package.json"))).toBe(true);
		}
	});
});
