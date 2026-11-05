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
	version?: string;
	authProvider?: unknown;
	engines?: Record<string, string>;
	files?: string[];
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	publishConfig?: unknown;
}

const manifest = JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as Manifest;

/** Each peer at its range, none optional: upstream's generator holds them to the app's versions. */
function expectPeers(peers: Record<string, string>) {
	for (const [name, range] of Object.entries(peers)) {
		expect({ name, range: manifest.peerDependencies?.[name] }).toEqual({ name, range });
		expect({ name, optional: manifest.peerDependenciesMeta?.[name]?.optional === true }).toEqual({ name, optional: false });
	}
}

describe("package.json, as upstream's generator reads a package outside the release", () => {
	it("declares the registry resolver the DID grant's default adapter, needing outbound", () => {
		expect(manifest.authProvider).toEqual({
			format: 1,
			kind: "adapter",
			adapts: "@provin-line/auth-did-grant",
			default: true,
			needs: ["@mod/outbound"],
		});
	});

	it("takes the release's bundle, the DID grant and zod as peers", () => {
		expectPeers({
			"@o3co/auth-provider-foundation": "^0.19.0",
			"@provin-line/auth-did-grant": `^${manifest.version}`,
			zod: "^4.6.7",
		});
	});

	it("depends on did-dplaax at exactly its own version once packed", () => {
		expect(manifest.dependencies?.["@provin-line/did-dplaax"]).toBe("workspace:*");
	});

	it("takes no release package nor zod as a dependency, which would give the app a second copy", () => {
		const own = Object.keys(manifest.dependencies ?? {});
		expect(own.filter((name) => name.startsWith("@o3co/") || name === "zod")).toEqual([]);
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
