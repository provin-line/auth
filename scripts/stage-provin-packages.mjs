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
// `@provin-line` scope pointed at that registry. A generated app takes the
// scope's registry from that project, so it installs the same packages while
// the registry serves.
//
// Usage: node scripts/stage-provin-packages.mjs [--dir <dir>] [--port <n>] [--serve]
//   Prints the project's path on stdout. --dir defaults to a new temporary
//   directory; --port to 0, a free port. With --serve the registry keeps
//   serving until the process is stopped; without it, it stops once the
//   project is installed.
//
// It packs what `dist` holds and builds nothing: run `pnpm -r build` (or an
// install, whose `prepare` builds) first. Building here would replace `dist`
// under any test of the same checkout running beside it.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { serveTarballs } from "./local-registry.mjs";

const root = join(import.meta.dirname, "..");
const execFileP = promisify(execFile);

/**
 * The packages staged, by their `packages/` directory, each with the role it
 * has to a generated app: create-provider's `PROVIN_PACKAGES`, which a test
 * holds this list to.
 */
export const STAGED_PACKAGES = Object.freeze(
	[
		{ dir: "did-dplaax", role: "dependency" },
		{ dir: "did-grant", role: "module" },
		{ dir: "did-grant-store", role: "module" },
		{ dir: "dplaax-registry", role: "module" },
	].map((p) => Object.freeze(p)),
);

const manifestOf = (dir) => JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));

/** The last lines of a child's output, where pnpm reports why it failed. */
function tail(text, lines = 20) {
	return typeof text === "string" ? text.trim().split("\n").slice(-lines).join("\n") : "";
}

/** Runs pnpm, failing with what it printed on either stream. */
async function pnpm(args, cwd, what) {
	try {
		await execFileP("pnpm", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
	} catch (err) {
		const detail = [tail(err.stderr), tail(err.stdout)].filter((t) => t !== "").join("\n") || err.message;
		throw new Error(`${what} failed: ${detail}`, { cause: err });
	}
}

/** Every file path a package's `exports` names, at any depth of conditions. */
function exportTargets(exports) {
	if (typeof exports === "string") return [exports];
	if (exports === null || typeof exports !== "object") return [];
	return Object.values(exports).flatMap(exportTargets);
}

/** Refuses a package whose `dist` is missing or lacks a file its `exports` names. */
function assertBuilt(dir) {
	const cwd = join(root, "packages", dir);
	const missing = exportTargets(manifestOf(dir).exports).filter((target) => !existsSync(join(cwd, target)));
	if (!existsSync(join(cwd, "dist")) || missing.length > 0) {
		const what = missing.length > 0 ? `lacks ${missing.join(", ")}` : "has no dist";
		throw new Error(`packages/${dir} ${what}: build it first`);
	}
}

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
	for (const { dir: name } of STAGED_PACKAGES) {
		assertBuilt(name);
		await pnpm(
			["pack", "--config.ignore-scripts=true", "--pack-destination", tarballs],
			join(root, "packages", name),
			`packing packages/${name}`,
		);
	}
	const registry = await serveTarballs(tarballs, { port });
	try {
		const all = STAGED_PACKAGES.map((p) => ({ ...p, manifest: manifestOf(p.dir) }));
		const manifest = {
			name: "provin-stage",
			private: true,
			// The pnpm this repository and a generated app install with.
			packageManager: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager,
			dependencies: Object.fromEntries(
				all.filter((p) => p.role === "module").map((p) => [p.manifest.name, p.manifest.version]),
			),
		};
		writeFileSync(join(project, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
		writeFileSync(join(project, ".npmrc"), `@provin-line:registry=${registry.url}/\n`);
		// Every version the registry serves reads as published now: name each
		// exactly, so pnpm's wait for a day-old release lets these through.
		const fresh = all.map((p) => `  - "${p.manifest.name}@${p.manifest.version}"`);
		writeFileSync(join(project, "pnpm-workspace.yaml"), ["minimumReleaseAgeExclude:", ...fresh, ""].join("\n"));
		// Asynchronously, as the registry answers from this process's event
		// loop. A cache of its own: the registry serves the same versions with
		// new bytes from run to run, which a shared metadata cache would not see.
		await pnpm(["install", `--config.cache-dir=${join(dir, "pnpm-cache")}`], project, "installing the staged project");
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
	const staged = await stageProvinPackages({ dir, port: Number(values.port ?? 0) });
	process.stdout.write(`${staged.project}\n`);
	if (values.serve) {
		console.error(`serving the provin packages on ${staged.url} until stopped`);
		process.on("SIGTERM", () => staged.close().then(() => process.exit(0)));
		process.on("SIGINT", () => staged.close().then(() => process.exit(0)));
	} else {
		await staged.close();
	}
}
