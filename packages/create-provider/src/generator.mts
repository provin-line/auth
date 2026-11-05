/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Generation: upstream's generator writes the app, composing the provin
// modules as packages outside its release, the overlay patches what it does
// not write for them, and this file writes the result. The CLI in cli.mts is a
// thin wrapper; tests and tooling call this function directly.

import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { generate } from "@o3co/auth-provider-scaffold/create-app";
import {
	DEFAULT_LICENSE,
	DEFAULT_REGISTRY_BASE_URL,
	isSupportedLicense,
	LISTED_MODULES,
	SUPPORTED_LICENSES,
} from "./defaults.mjs";
import { ExistingDirectoryNonEmptyError } from "./errors.mjs";
import { applyProvinModules } from "./overlay/index.mjs";
import { PROVIN_PACKAGES } from "./provin-modules.mjs";
import { stageProvinModules } from "./staging.mjs";

const execFileP = promisify(execFile);

/** Public generation contract. */
export interface GenerateOptions {
	/**
	 * `package.json` name. Must include any leading scope (e.g. `@org/foo`).
	 * The CLI derives the output directory from this if `outDir` is omitted.
	 */
	readonly name: string;

	/** Absolute or process-relative path. Created if missing; refused if non-empty. */
	readonly outDir: string;

	/** `package.json` description + README opener. Default: "dPLaaX auth.provider instance". */
	readonly description?: string;

	/** SPDX license id. Default: `Apache-2.0`. */
	readonly license?: string;

	/** `package.json` author field. Default: none. */
	readonly author?: string;

	/**
	 * Run `git init -b main <outDir>` after scaffolding. Default: `true`.
	 * Tests and CI smoke pass `false` to keep temp directories diff-clean.
	 */
	readonly gitInit?: boolean;

	/**
	 * A project where pnpm installed the provin modules, which upstream's
	 * generator reads them from: their manifests, files and lockfile records,
	 * and the registries the project installs from. Default: a temporary
	 * project the generator stages, installing `PROVIN_PACKAGES` from the
	 * registry the operator's npm configuration names, removed afterwards.
	 */
	readonly outsideFrom?: string;

	/** DID registry URL: the default of `DPLAAX_REGISTRY_URL` in `.env.example`. Default: production registry. */
	readonly registryBaseUrl?: string;
}

export interface GenerateResult {
	readonly outDir: string;
	readonly filesWritten: readonly string[];
}

/** The package's own LICENSE, which is the Apache-2.0 text verbatim. */
const LICENSE_URL = new URL("../LICENSE", import.meta.url);

async function ensureCleanOutDir(outDir: string): Promise<void> {
	let exists = false;
	try {
		exists = (await stat(outDir)).isDirectory();
		if (!exists) {
			throw new Error(`Output path exists but is not a directory: ${outDir}`);
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
			throw e;
		}
	}
	if (exists && (await readdir(outDir)).length > 0) {
		throw new ExistingDirectoryNonEmptyError(outDir);
	}
}

async function readTree(root: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	async function walk(dir: string): Promise<void> {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else {
				files.set(
					relative(root, full).replaceAll(sep, "/"),
					await readFile(full, "utf8"),
				);
			}
		}
	}
	await walk(root);
	return files;
}

async function runGitInit(outDir: string): Promise<void> {
	try {
		await execFileP("git", ["init", "-b", "main", outDir]);
	} catch {
		// no-op: a downstream user can `git init` manually.
	}
}

/**
 * Generate an auth.provider app under `opts.outDir`.
 *
 * @throws {ExistingDirectoryNonEmptyError} when the target exists and is
 *   non-empty (create-app.md § 4.3).
 */
export async function generateAuthProviderScaffold(
	opts: GenerateOptions,
): Promise<GenerateResult> {
	const license = opts.license ?? DEFAULT_LICENSE;
	if (!isSupportedLicense(license)) {
		throw new Error(
			`Unsupported license: "${license}". The generator carries ` +
				`verbatim LICENSE bodies only for: ${SUPPORTED_LICENSES.join(", ")}. ` +
				"Broaden the allow-list via a follow-up issue before passing other values.",
		);
	}

	const outDir = resolve(opts.outDir);
	await ensureCleanOutDir(outDir);

	const modules = PROVIN_PACKAGES.filter((p) => p.module).map((p) => p.name);
	const own = opts.outsideFrom === undefined ? await stageProvinModules() : undefined;
	const from = own?.dir ?? resolve(opts.outsideFrom ?? "");

	// The app is built beside the target and moved into place once whole, so a
	// failure leaves nothing: an app without the dPLaaX modules is not a result.
	let composed: Map<string, string>;
	try {
		await mkdir(dirname(outDir), { recursive: true });
		const building = await mkdtemp(join(dirname(outDir), `.${basename(outDir)}-`));
		try {
			await generate({
				target: building,
				modules: [...LISTED_MODULES, ...modules],
				// Each named fresh: the versions are this release's, which may be a day old or less.
				outside: { from, names: modules, fresh: modules },
			});
			const generated = await readTree(building);
			composed = applyProvinModules(generated, {
				name: opts.name,
				description: opts.description ?? "dPLaaX auth.provider instance",
				license,
				author: opts.author ?? "",
				registryBaseUrl: opts.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL,
			});
			composed.set("LICENSE", await readFile(LICENSE_URL, "utf8"));
			for (const [path, text] of composed) {
				if (generated.get(path) === text) continue;
				const full = join(building, path);
				await mkdir(dirname(full), { recursive: true });
				await writeFile(full, text);
			}
			await rename(building, outDir);
		} catch (e) {
			await rm(building, { recursive: true, force: true });
			throw e;
		}
	} finally {
		await own?.remove();
	}

	if (opts.gitInit ?? true) {
		await runGitInit(outDir);
	}

	return { outDir, filesWritten: [...composed.keys()].sort() };
}
