#!/usr/bin/env node
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

// Stages the provin packages as this checkout has built them, for
// create-provider's `--outside-from`: packs the four packages, serves them
// from a loopback registry (scripts/local-registry.mjs), and installs a
// project that depends on the three modules at their exact versions, its
// `@provin-line` scope pointed at that registry. A generated app takes the scope's registry from
// that project, so it installs the same packages while the registry serves.
//
// Usage: node scripts/stage-provin-packages.mjs [--dir <dir>] [--port <n>] [--serve]
//   Prints the project's path on stdout. --dir defaults to a new temporary
//   directory; --port to 4880. With --serve the registry keeps serving until
//   the process is stopped; without it, it stops once the project is
//   installed.
//
// It packs what `dist` holds and builds nothing: run `pnpm -r build` (or an
// install, whose `prepare` builds) first. Building here would replace `dist`
// under any test of the same checkout running beside it.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { serveTarballs } from "./local-registry.mjs";

const root = join(import.meta.dirname, "..");
const LIBRARIES = ["did-dplaax"];
const MODULES = ["did-grant", "did-grant-store", "dplaax-registry"];
const manifestOf = (dir) => JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));

/**
 * Packs the packages into `<dir>/tarballs`, serves them on `port`, and
 * installs `<dir>/project`. Resolves with the project's path and the
 * registry's URL and `close`.
 */
export async function stageProvinPackages({ dir, port = 0 }) {
	const tarballs = join(dir, "tarballs");
	const project = join(dir, "project");
	mkdirSync(tarballs, { recursive: true });
	mkdirSync(project, { recursive: true });
	for (const name of [...LIBRARIES, ...MODULES]) {
		const cwd = join(root, "packages", name);
		if (!existsSync(join(cwd, "dist"))) throw new Error(`packages/${name} has no dist: build it first`);
		execFileSync("pnpm", ["pack", "--config.ignore-scripts=true", "--pack-destination", tarballs], {
			cwd,
			stdio: ["ignore", "ignore", "inherit"],
		});
	}
	const registry = await serveTarballs(tarballs, { port });
	try {
		const modules = MODULES.map(manifestOf);
		const manifest = {
			name: "provin-stage",
			private: true,
			dependencies: Object.fromEntries(modules.map((m) => [m.name, m.version])),
		};
		writeFileSync(join(project, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
		writeFileSync(join(project, ".npmrc"), `@provin-line:registry=${registry.url}/\n`);
		// Every version the registry serves reads as published now: name each
		// exactly, so pnpm's wait for a day-old release lets these through.
		const fresh = [...LIBRARIES, ...MODULES].map(manifestOf).map((m) => `  - "${m.name}@${m.version}"`);
		writeFileSync(join(project, "pnpm-workspace.yaml"), ["minimumReleaseAgeExclude:", ...fresh, ""].join("\n"));
		// Asynchronously: the registry answers from this process's event loop.
		await promisify(execFile)("pnpm", ["install"], { cwd: project });
		return { project, url: registry.url, close: registry.close };
	} catch (err) {
		await registry.close();
		throw err;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: { dir: { type: "string" }, port: { type: "string" }, serve: { type: "boolean" } },
	});
	const dir = values.dir === undefined ? mkdtempSync(join(tmpdir(), "provin-stage-")) : resolve(values.dir);
	const staged = await stageProvinPackages({ dir, port: Number(values.port ?? 4880) });
	process.stdout.write(`${staged.project}\n`);
	if (values.serve) {
		console.error(`serving the provin packages on ${staged.url} until stopped`);
		process.on("SIGTERM", () => staged.close().then(() => process.exit(0)));
		process.on("SIGINT", () => staged.close().then(() => process.exit(0)));
	} else {
		await staged.close();
	}
}
