/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The repository releases under one version: its tag, the root package.json
// and every workspace package carry the same one. The workspace's packages
// are packages/* and integration; instances/* are generated instances, which
// carry their own version.

interface Manifest {
	name: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

const root = join(import.meta.dirname, "..", "..");
const read = async (dir: string) => JSON.parse(await readFile(join(root, dir, "package.json"), "utf8")) as Manifest;
const rootManifest = await read(".");
const workspace = await Promise.all(
	[
		...(await readdir(join(root, "packages"), { withFileTypes: true }))
			.filter((e) => e.isDirectory())
			.map((e) => join("packages", e.name)),
		"integration",
	].map(async (dir) => ({ dir, manifest: await read(dir) })),
);

describe("the repository's one version", () => {
	it("is the root package.json's", () => {
		expect(rootManifest.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
	});

	it("is every workspace package's", () => {
		const versions = Object.fromEntries(workspace.map(({ manifest }) => [manifest.name, manifest.version]));
		const expected = Object.fromEntries(workspace.map(({ manifest }) => [manifest.name, rootManifest.version]));
		expect(versions).toEqual(expected);
	});

	it("is what a package takes a provin package at otherwise, through the workspace protocol", () => {
		for (const { manifest } of workspace) {
			const own = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
			for (const [name, range] of Object.entries(own)) {
				if (!name.startsWith("@provin-line/")) continue;
				expect({ in: manifest.name, name, range }).toEqual({ in: manifest.name, name, range: expect.stringMatching(/^workspace:/) });
			}
		}
	});

	it("is the caret range a package takes a provin package at as a peer", () => {
		for (const { manifest } of workspace) {
			for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
				if (!name.startsWith("@provin-line/")) continue;
				expect({ in: manifest.name, name, range }).toEqual({ in: manifest.name, name, range: `^${rootManifest.version}` });
			}
		}
	});
});
