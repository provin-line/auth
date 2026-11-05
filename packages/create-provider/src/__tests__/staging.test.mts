/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIN_PACKAGES } from "../provin-modules.mjs";
import { removeOnSignal, stageProvinModules, stagingFiles } from "../staging.mjs";

/** This generator's own version, which it composes every provin package at. */
const release = (JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as { version: string })
	.version;

describe("stagingFiles", () => {
	const files = stagingFiles(PROVIN_PACKAGES);

	it("depends on the three modules at their exact versions, which upstream's generator reads", () => {
		const manifest = JSON.parse(files.get("package.json") ?? "{}");
		expect(manifest.private).toBe(true);
		expect(manifest.dependencies).toEqual({
			"@provin-line/auth-did-grant": release,
			"@provin-line/auth-did-grant-store": release,
			"@provin-line/auth-dplaax-registry": release,
		});
	});

	it("installs with the pnpm the generated app pins, not whichever is first on PATH", () => {
		const manifest = JSON.parse(files.get("package.json") ?? "{}");
		expect(manifest.packageManager).toBe("pnpm@11.28.7");
	});

	it("lets every provin package at its exact version install within its first day, as the app does", () => {
		const yaml = files.get("pnpm-workspace.yaml") ?? "";
		for (const p of PROVIN_PACKAGES) {
			expect(yaml.split("\n")).toContain(`  - "${p.name}@${p.version}"`);
		}
	});

	it("writes no registry setting, so the operator's own npm configuration decides where they come from", () => {
		expect([...files.keys()].sort()).toEqual(["package.json", "pnpm-workspace.yaml"]);
	});
});

describe("stageProvinModules, with a stand-in pnpm", () => {
	let root: string;
	let tmpRoot: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "create-auth-provider-fake-pnpm-"));
		tmpRoot = join(root, "tmp");
		await mkdir(join(root, "bin"));
		await mkdir(tmpRoot);
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	});

	/** Puts a `pnpm` running `script` first on PATH. */
	async function pnpmRunning(script: string): Promise<void> {
		await writeFile(join(root, "bin", "pnpm"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
		vi.stubEnv("PATH", `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`);
	}

	it("installs without running any package's lifecycle scripts", async () => {
		await pnpmRunning('printf "%s\\n" "$@" > args');
		const staged = await stageProvinModules({ cwd: root, tmpRoot });
		try {
			expect((await readFile(join(staged.dir, "args"), "utf8")).split("\n")).toEqual(["install", "--ignore-scripts", ""]);
		} finally {
			await staged.remove();
		}
	});

	it("stages under the directory it is given, and removes the project", async () => {
		await pnpmRunning("true");
		const staged = await stageProvinModules({ cwd: root, tmpRoot });
		expect(await readdir(tmpRoot)).toHaveLength(1);
		await staged.remove();
		expect(await readdir(tmpRoot)).toEqual([]);
	});

	it("says the install timed out, and leaves no project behind", async () => {
		await pnpmRunning("exec sleep 5");
		await expect(stageProvinModules({ cwd: root, tmpRoot, timeoutMs: 200 })).rejects.toThrow(
			/^installing the provin modules timed out after 0\.2 s/,
		);
		expect(await readdir(tmpRoot)).toEqual([]);
	});

	it("listens for a signal while the project exists, and no longer once it is removed", async () => {
		await pnpmRunning("true");
		const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
		const staged = await stageProvinModules({ cwd: root, tmpRoot });
		expect({ int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") }).toEqual({
			int: before.int + 1,
			term: before.term + 1,
		});
		await staged.remove();
		expect({ int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") }).toEqual(before);
	});
});

describe("removeOnSignal", () => {
	/** A process that records the signals sent to it. */
	function processLike() {
		const kill = vi.fn((_pid: number, _signal?: NodeJS.Signals) => true);
		return Object.assign(new EventEmitter(), { pid: 4242, kill });
	}

	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "create-auth-provider-signal-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it.each(["SIGINT", "SIGTERM"] as const)("removes the directory on %s, then lets the signal end the process", (signal) => {
		const target = processLike();
		removeOnSignal(dir, target);
		target.emit(signal, signal);
		expect(existsSync(dir)).toBe(false);
		expect(target.kill).toHaveBeenCalledWith(4242, signal);
		expect(target.listenerCount("SIGINT") + target.listenerCount("SIGTERM")).toBe(0);
	});

	it("leaves the signal to another listener the process has", () => {
		const target = processLike();
		const other = vi.fn();
		target.on("SIGTERM", other);
		removeOnSignal(dir, target);
		target.emit("SIGTERM", "SIGTERM");
		expect(existsSync(dir)).toBe(false);
		expect(other).toHaveBeenCalled();
		expect(target.kill).not.toHaveBeenCalled();
	});

	it("stops listening when stopped", () => {
		const target = processLike();
		const stop = removeOnSignal(dir, target);
		stop();
		target.emit("SIGINT", "SIGINT");
		expect(existsSync(dir)).toBe(true);
		expect(target.kill).not.toHaveBeenCalled();
	});
});
