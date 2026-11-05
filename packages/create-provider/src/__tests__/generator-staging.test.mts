/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Without outsideFrom the generator stages the provin modules itself, from
// the registry the operator's configuration names, and removes what it
// staged whatever happens. The staging is stood in for by the project the
// test run staged, so the test needs no registry.

import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

const staged = inject("stagedProject");
const removed = vi.fn(async () => undefined);
const stageProvinModules = vi.fn(async () => ({ dir: staged, remove: removed }));

let overlayFails = false;
vi.mock("../overlay/index.mjs", async (original) => {
	const real = await original<typeof import("../overlay/index.mjs")>();
	return {
		...real,
		applyProvinModules: (...args: Parameters<typeof real.applyProvinModules>) => {
			if (overlayFails) throw new Error("overlay refused");
			return real.applyProvinModules(...args);
		},
	};
});

vi.mock("../staging.mjs", async (original) => ({
	...(await original<typeof import("../staging.mjs")>()),
	stageProvinModules: () => stageProvinModules(),
}));

const { generateAuthProviderScaffold } = await import("../generator.mjs");

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "create-auth-provider-staging-"));
	removed.mockClear();
	stageProvinModules.mockClear();
	overlayFails = false;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("generateAuthProviderScaffold — its own staging", () => {
	it("stages the modules when no outsideFrom is given, and removes the staging once generated", async () => {
		const result = await generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), gitInit: false });
		expect(result.filesWritten).toContain("outside-modules.json");
		expect(stageProvinModules).toHaveBeenCalledTimes(1);
		expect(removed).toHaveBeenCalledTimes(1);
	});

	it("removes the staging when generating fails, and leaves no app behind", async () => {
		overlayFails = true;
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), gitInit: false }),
		).rejects.toThrow(/overlay refused/);
		expect(stageProvinModules).toHaveBeenCalledTimes(1);
		expect(removed).toHaveBeenCalledTimes(1);
		expect(await readdir(root)).toEqual([]);
	});

	it("stages nothing for a request refused before generating", async () => {
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), license: "MIT", gitInit: false }),
		).rejects.toThrow(/Unsupported license/);
		expect(stageProvinModules).not.toHaveBeenCalled();
	});

	it("refuses a project that resolved a provin package at another version, and leaves no app", async () => {
		const other = join(root, "other");
		await cp(staged, other, { recursive: true, verbatimSymlinks: true });
		const lock = join(other, "pnpm-lock.yaml");
		const text = await readFile(lock, "utf8");
		const version = /'@provin-line\/did-dplaax@([^']+)'/.exec(text)?.[1];
		expect(version).toBeDefined();
		await writeFile(lock, text.replaceAll(`@provin-line/did-dplaax@${version}`, "@provin-line/did-dplaax@0.0.1"));
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), outsideFrom: other, gitInit: false }),
		).rejects.toThrow(new RegExp(`@provin-line/did-dplaax is 0\\.0\\.1, not ${version?.replaceAll(".", "\\.")}`));
		expect((await readdir(root)).sort()).toEqual(["other"]);
	});

	it("refuses what its own staging installed at another version, naming the registry, not the staging it removed", async () => {
		const other = join(root, "other");
		await cp(staged, other, { recursive: true, verbatimSymlinks: true });
		const lock = join(other, "pnpm-lock.yaml");
		const text = await readFile(lock, "utf8");
		const version = /'@provin-line\/did-dplaax@([^']+)'/.exec(text)?.[1];
		await writeFile(lock, text.replaceAll(`@provin-line/did-dplaax@${version}`, "@provin-line/did-dplaax@0.0.1"));
		stageProvinModules.mockImplementationOnce(async () => ({ dir: other, remove: removed }));
		const refused = generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), gitInit: false });
		await expect(refused).rejects.toThrow(
			new RegExp(`^the registry served provin packages other than this release's: @provin-line/did-dplaax is 0\\.0\\.1, not ${version?.replaceAll(".", "\\.")}$`),
		);
		await expect(refused).rejects.not.toThrow(other);
		expect(removed).toHaveBeenCalledTimes(1);
		expect((await readdir(root)).sort()).toEqual(["other"]);
	});

	it("refuses an outsideFrom that names no directory at all", async () => {
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), outsideFrom: "", gitInit: false }),
		).rejects.toThrow("outsideFrom names no directory");
		expect(stageProvinModules).not.toHaveBeenCalled();
	});

	it("refuses an outsideFrom that is no directory, naming it", async () => {
		const none = join(root, "none");
		await expect(
			generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), outsideFrom: none, gitInit: false }),
		).rejects.toThrow(`outsideFrom: ${none} is not a directory`);
		expect(stageProvinModules).not.toHaveBeenCalled();
	});

	it("stages nothing when outsideFrom names a project", async () => {
		await generateAuthProviderScaffold({ name: "app", outDir: join(root, "app"), outsideFrom: staged, gitInit: false });
		expect(stageProvinModules).not.toHaveBeenCalled();
		expect(await readdir(root)).toEqual(["app"]);
	});
});
