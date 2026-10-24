/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// A generation that fails after upstream wrote its app must leave nothing in
// the target: an app without the dPLaaX modules is not a result.

import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../overlay/index.mjs", () => ({
	applyProvinModules: () => {
		throw new Error("src/main.ts: upstream moved");
	},
}));

const { generateAuthProviderScaffold } = await import("../generator.mjs");

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "create-auth-provider-fail-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("generateAuthProviderScaffold — failed overlay", () => {
	it("leaves no target behind and no stray files beside it", async () => {
		const target = join(root, "app");
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: target, gitInit: false }),
		).rejects.toThrow(/upstream moved/);
		expect(await readdir(root)).toEqual([]);
	});

	it("leaves an existing empty target empty", async () => {
		const target = join(root, "app");
		await mkdir(target);
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: target, gitInit: false }),
		).rejects.toThrow(/upstream moved/);
		expect(await readdir(target)).toEqual([]);
		expect(await readdir(root)).toEqual(["app"]);
	});
});
