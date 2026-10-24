/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The generator emits the verifier baseline as exact pins; the workspace
// packages require the same baseline as `^pin` (docs/upstream-compatibility.md).
// Upstream exact-pins each package to its siblings, so the three move together.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEP_VERSIONS } from "../defaults.mjs";

const VERIFIER = [
	"@o3co/auth.policy-verifier.server",
	"@o3co/auth.policy-verifier.builtins",
	"@o3co/auth.policy-verifier.core",
] as const;

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

type Manifest = Partial<
	Record<"dependencies" | "devDependencies" | "peerDependencies", Record<string, string>>
>;

describe("DEFAULT_DEP_VERSIONS — verifier baseline", () => {
	it("pins the three verifier packages to one version", () => {
		expect(new Set(VERIFIER.map((p) => DEFAULT_DEP_VERSIONS[p])).size).toBe(1);
	});

	it("pins the verifier baseline 0.17.0", () => {
		expect(DEFAULT_DEP_VERSIONS["@o3co/auth.policy-verifier.server"]).toBe("0.17.0");
	});

	it.each(["packages/policy-verifier-dplaax-module/package.json", "integration/package.json"])(
		"%s requires the generator's baseline as ^pin",
		async (manifest) => {
			const pkg = JSON.parse(await readFile(join(repoRoot, manifest), "utf8")) as Manifest;
			const ranges = Object.fromEntries(
				[pkg.dependencies, pkg.devDependencies, pkg.peerDependencies].flatMap((deps) =>
					Object.entries(deps ?? {}),
				),
			);
			const listed = VERIFIER.filter((name) => name in ranges);
			expect(listed.length).toBeGreaterThan(0);
			for (const name of listed) {
				expect({ name, range: ranges[name] }).toEqual({
					name,
					range: `^${DEFAULT_DEP_VERSIONS[name]}`,
				});
			}
		},
	);
});
