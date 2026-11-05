/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIN_PACKAGES } from "../provin-modules.mjs";
import { stagingFiles } from "../staging.mjs";

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
