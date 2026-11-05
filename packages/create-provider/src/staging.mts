/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Upstream's generator reads a package outside its release from a project pnpm
// installed it into. Without one given, the generator stages its own: a
// temporary project depending on the provin modules at the versions this
// release composes, installed from the registry the operator's npm
// configuration names, and removed once the app is generated.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProvinPackage } from "./provin-modules.mjs";
import { PROVIN_PACKAGES } from "./provin-modules.mjs";

const execFileP = promisify(execFile);

/**
 * The files of a project depending on the modules among `packages` at their
 * exact versions. It writes no registry setting, so the operator's own npm
 * configuration decides where they come from. pnpm holds a version back until
 * it is a day old; each package is named at its exact version so a release
 * installs on its first day, as the generated app names them.
 */
export function stagingFiles(packages: readonly ProvinPackage[]): Map<string, string> {
	const manifest = {
		name: "provin-stage",
		private: true,
		dependencies: Object.fromEntries(packages.filter((p) => p.module).map((p) => [p.name, p.version])),
	};
	const fresh = packages.map((p) => `  - ${JSON.stringify(`${p.name}@${p.version}`)}`);
	return new Map([
		["package.json", `${JSON.stringify(manifest, null, "\t")}\n`],
		["pnpm-workspace.yaml", ["minimumReleaseAgeExclude:", ...fresh, ""].join("\n")],
	]);
}

/** A project staged for the generator, and the way to remove it. */
export interface StagedModules {
	readonly dir: string;
	remove(): Promise<void>;
}

/** Stages and installs the project `stagingFiles` describes for this release's packages. */
export async function stageProvinModules(): Promise<StagedModules> {
	const dir = await mkdtemp(join(tmpdir(), "create-auth-provider-stage-"));
	const remove = () => rm(dir, { recursive: true, force: true });
	try {
		for (const [path, text] of stagingFiles(PROVIN_PACKAGES)) {
			await writeFile(join(dir, path), text);
		}
		await execFileP("pnpm", ["install"], { cwd: dir });
	} catch (e) {
		await remove();
		const stderr = (e as { stderr?: unknown }).stderr;
		const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : (e as Error).message;
		throw new Error(`installing the provin modules from npm failed: ${detail}`);
	}
	return { dir, remove };
}
