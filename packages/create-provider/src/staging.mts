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
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { ProvinPackage } from "./provin-modules.mjs";
import { ofRole, PROVIN_PACKAGES } from "./provin-modules.mjs";

const execFileP = promisify(execFile);

/**
 * The pnpm the staging project installs with: the one the generated app pins,
 * which a test holds them to, so the lockfile upstream reads is that pnpm's.
 */
export const STAGING_PACKAGE_MANAGER = "pnpm@11.28.7";

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
		packageManager: STAGING_PACKAGE_MANAGER,
		dependencies: Object.fromEntries(ofRole(packages, "module").map((p) => [p.name, p.version])),
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

/** How long the staging install may take before it is given up. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** The last lines of a child's output, where pnpm 11 reports why an install failed. */
function tail(text: unknown, lines = 20): string {
	return typeof text === "string" ? text.trim().split("\n").slice(-lines).join("\n") : "";
}

/**
 * Stages and installs the project `stagingFiles` describes for this release's
 * packages. The `.npmrc` of `cwd`, the directory the generator is run from,
 * is copied in when there is one, so a registry or credentials it sets apply
 * to the install as they would to a project there. The staged project is
 * removed with `remove()`; upstream's generator carries only the registries'
 * origins into the app, never what the `.npmrc` holds.
 */
export async function stageProvinModules({ cwd = process.cwd() }: { cwd?: string } = {}): Promise<StagedModules> {
	const dir = await mkdtemp(join(tmpdir(), "create-auth-provider-stage-"));
	const remove = () => rm(dir, { recursive: true, force: true });
	try {
		for (const [path, text] of stagingFiles(PROVIN_PACKAGES)) {
			await writeFile(join(dir, path), text);
		}
		await copyFile(join(cwd, ".npmrc"), join(dir, ".npmrc")).catch((e: NodeJS.ErrnoException) => {
			if (e.code !== "ENOENT") throw e;
		});
		await execFileP("pnpm", ["install"], { cwd: dir, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
	} catch (e) {
		await remove();
		const { stdout, stderr } = e as { stdout?: unknown; stderr?: unknown };
		const detail = [tail(stderr), tail(stdout)].filter((t) => t !== "").join("\n") || (e as Error).message;
		throw new Error(`installing the provin modules failed: ${detail}`, { cause: e });
	}
	return { dir, remove };
}
