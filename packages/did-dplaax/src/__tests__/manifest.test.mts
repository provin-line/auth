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


import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
	authProvider?: unknown;
	engines?: Record<string, string>;
	files?: string[];
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	publishConfig?: unknown;
}

const manifest = JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as Manifest;


describe("package.json", () => {
	it("declares no authProvider: a library, not a module", () => {
		expect(manifest.authProvider).toBeUndefined();
	});

	it("runs on the Node.js auth.provider 0.19 requires", () => {
		expect(manifest.engines).toEqual({ node: ">=24" });
	});

	it("ships its sources beside dist, which the declaration maps point to, without its tests", () => {
		expect(manifest.files).toEqual(expect.arrayContaining(["dist", "src", "!src/**/__tests__"]));
	});

	it("is published to the public registry", () => {
		expect(manifest.publishConfig).toEqual({ access: "public" });
	});
});
