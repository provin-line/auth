/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Core generator: walks src/template/ recursively, substitutes __TOKEN__
// markers in files ending with `.tmpl`, renames `_gitignore` -> `.gitignore`
// (npm publish strips literal `.gitignore` from packages), emits
// `package.json` via object + JSON.stringify (so free-form fields are
// JSON-escaped automatically), and writes the result under opts.outDir.
// The CLI in cli.mts is a thin wrapper; tests and tooling call this
// function directly.

import { execFile } from "node:child_process";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	buildDplaaxModuleDep,
	DEFAULT_DEP_VERSIONS,
	DEFAULT_DPLAAX_MODULE_REF,
	DEFAULT_LICENSE,
	DEFAULT_PACKAGE_MANAGER,
	DEFAULT_PORT,
	DEFAULT_REGISTRY_BASE_URL,
	isSupportedLicense,
	SUPPORTED_LICENSES,
} from "./defaults.mjs";
import { ExistingDirectoryNonEmptyError } from "./errors.mjs";

const execFileP = promisify(execFile);

/** Public generation contract. */
export interface GenerateOptions {
	/**
	 * `package.json` name AND the substitution value of `__NAME__` in the
	 * template. Must include any leading scope (e.g. `@org/foo`). The CLI
	 * derives the output directory from this if `outDir` is omitted.
	 */
	readonly name: string;

	/** Absolute or process-relative path. Created if missing; refused if non-empty. */
	readonly outDir: string;

	/** `package.json` description + README opener. Default: "dPLaaX auth.provider instance". */
	readonly description?: string;

	/** Default `http.port` in `config/application.conf`. Default: {@link DEFAULT_PORT}. */
	readonly port?: number;

	/** SPDX license id. Default: `Apache-2.0`. */
	readonly license?: string;

	/** `package.json` author field. Default: empty string. */
	readonly author?: string;

	/**
	 * Run `git init -b main <outDir>` after scaffolding. Default: `true`.
	 * Tests and CI smoke pass `false` to keep temp directories diff-clean.
	 */
	readonly gitInit?: boolean;

	/** Package-manager binary name used in Makefile + README. Default: `pnpm`. */
	readonly packageManager?: string;

	/**
	 * Git ref for the `@provin-line/auth-provider-dplaax-module` dep.
	 * Library-only default: `main` — a MOVING ref, acceptable for tests and
	 * tooling but never for shipped scaffolds; the CLI deliberately requires
	 * the flag and rejects moving branch names (create-app.md § 3.3 / § 4.1).
	 */
	readonly dplaaxModuleRef?: string;

	/** DID registry baseUrl emitted into application.conf. Default: production registry. */
	readonly registryBaseUrl?: string;
}

export interface GenerateResult {
	readonly outDir: string;
	readonly filesWritten: readonly string[];
}

interface FilledOptions {
	name: string;
	outDir: string;
	description: string;
	port: number;
	license: string;
	author: string;
	gitInit: boolean;
	packageManager: string;
	dplaaxModuleRef: string;
	registryBaseUrl: string;
}

function fillDefaults(opts: GenerateOptions): FilledOptions {
	return {
		name: opts.name,
		outDir: opts.outDir,
		description: opts.description ?? "dPLaaX auth.provider instance",
		port: opts.port ?? DEFAULT_PORT,
		license: opts.license ?? DEFAULT_LICENSE,
		author: opts.author ?? "",
		gitInit: opts.gitInit ?? true,
		packageManager: opts.packageManager ?? "pnpm",
		dplaaxModuleRef: opts.dplaaxModuleRef ?? DEFAULT_DPLAAX_MODULE_REF,
		registryBaseUrl: opts.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL,
	};
}

/**
 * Sanitize a scoped package name into a docker image tag — strips `@`,
 * replaces `/` with `-`, lowercases. `@provin-line/auth-provider` →
 * `provin-line-auth-provider`.
 */
function dockerImageTag(name: string): string {
	return name.replace(/^@/, "").replaceAll("/", "-").toLowerCase();
}

/**
 * Closed enumeration of `__TOKEN__` keys substituted into `*.tmpl` text
 * files. Authoritative — `buildTokens` returns `Record<TemplateTokenKey,
 * string>`, so TypeScript catches a missing or extra entry at compile time,
 * and `token-invariants.test.mts` catches drift against the template tree
 * (forward: every template ref is declared; reverse: every declared key is
 * referenced) at test time.
 *
 * `package.json` is NOT in this set — it goes through buildPackageJson()
 * so free-form fields are JSON-escaped instead of text-substituted.
 *
 * @internal Exported for the static invariant test only.
 */
export const TEMPLATE_TOKEN_KEYS = [
	"__NAME__",
	"__DESCRIPTION__",
	"__LICENSE__",
	"__PORT__",
	"__PACKAGE_MANAGER_BIN__",
	"__DOCKER_IMAGE_TAG__",
	"__REGISTRY_BASE_URL__",
] as const;
export type TemplateTokenKey = (typeof TEMPLATE_TOKEN_KEYS)[number];

/** @internal Exported for test access only. */
export function buildTokens(
	opts: FilledOptions,
): Record<TemplateTokenKey, string> {
	return {
		__NAME__: opts.name,
		__DESCRIPTION__: opts.description,
		__LICENSE__: opts.license,
		__PORT__: String(opts.port),
		__PACKAGE_MANAGER_BIN__: opts.packageManager,
		__DOCKER_IMAGE_TAG__: dockerImageTag(opts.name),
		__REGISTRY_BASE_URL__: opts.registryBaseUrl,
	};
}

/**
 * `packages/`-dir names of the @provin-line packages the dplaax module pulls
 * in transitively via workspace:*. Baked in like DEFAULT_DEP_VERSIONS —
 * refresh in lockstep with a generator MINOR bump when the module's
 * dependency graph changes (create-app.md § 3.3).
 */
const TRANSITIVE_PROVIN_PACKAGE_DIRS = [
	"auth-provider-did",
	"did-dplaax",
] as const;

/**
 * Build the generated `package.json` as a structured object then serialize
 * with JSON.stringify. Doing the encoding here (instead of through text
 * substitution in `package.json.tmpl`) means free-form fields like
 * `description` and `author` are JSON-escaped automatically — quotes,
 * backslashes, newlines, and Unicode all round-trip safely.
 */
function buildPackageJson(opts: FilledOptions): string {
	const dependencies: Record<string, string> = {
		"@provin-line/auth-provider-dplaax-module": buildDplaaxModuleDep(
			opts.dplaaxModuleRef,
		),
		"@o3co/auth-provider-core": DEFAULT_DEP_VERSIONS["@o3co/auth-provider-core"],
		"@o3co/auth.utils": DEFAULT_DEP_VERSIONS["@o3co/auth.utils"],
		"@o3co/ts.hocon": DEFAULT_DEP_VERSIONS["@o3co/ts.hocon"],
		express: DEFAULT_DEP_VERSIONS.express,
		// Direct dep so the ed25519_raw DID-grant verifier's
		// import.meta.resolve("@noble/ed25519") resolves from the instance root.
		"@noble/ed25519": DEFAULT_DEP_VERSIONS["@noble/ed25519"],
	};
	const devDependencies: Record<string, string> = {
		"@types/express": DEFAULT_DEP_VERSIONS["@types/express"],
		"@types/node": DEFAULT_DEP_VERSIONS["@types/node"],
		typescript: DEFAULT_DEP_VERSIONS.typescript,
		vitest: DEFAULT_DEP_VERSIONS.vitest,
	};

	// Consumer-mode resolution (create-app.md § 3.4): the dplaax module's own
	// @provin-line deps are declared workspace:* in the monorepo and are not
	// published to npm, so a standalone install can only resolve them through
	// consumer-root pnpm.overrides pinned to the same git ref. The git-fetched
	// packages run a `prepare` build, which pnpm ≥10 blocks unless allow-listed
	// in onlyBuiltDependencies.
	const transitiveProvinDeps = TRANSITIVE_PROVIN_PACKAGE_DIRS.map(
		(dir) =>
			[
				`@provin-line/${dir}`,
				`github:provin-line/auth#${opts.dplaaxModuleRef}&path:/packages/${dir}`,
			] as const,
	);
	const pnpmConfig = {
		onlyBuiltDependencies: [
			...transitiveProvinDeps.map(([name]) => name),
			"@provin-line/auth-provider-dplaax-module",
		].sort(),
		overrides: Object.fromEntries(transitiveProvinDeps),
	};

	const manifest = {
		name: opts.name,
		description: opts.description,
		version: "0.0.1",
		license: opts.license,
		author: opts.author,
		type: "module",
		scripts: {
			build: "tsc",
			start: "node dist/main.mjs",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		},
		dependencies,
		devDependencies,
		pnpm: pnpmConfig,
		packageManager: DEFAULT_PACKAGE_MANAGER,
	};

	return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Match the `__TOKEN__` marker shape used by both the runtime substitution
 * (`substitute`) and the static invariant scan (`token-invariants.test`).
 * Single source of truth — if the marker grammar ever loosens, both ends
 * stay in sync.
 *
 * @internal Exported for test access only.
 */
export const TOKEN_RE = /__[A-Z][A-Z0-9_]*__/g;

/**
 * Replace `__TOKEN__` markers in `text` with the values in `tokens`.
 * Throws on any token not in the map — keeps substitution total so a
 * future template author cannot introduce a silent unmapped reference.
 *
 * @internal Exported for test access only. Not part of the public API.
 */
export function substitute(
	text: string,
	tokens: Record<string, string>,
): string {
	return text.replace(TOKEN_RE, (match) => {
		const value = tokens[match];
		if (value === undefined) {
			throw new Error(`Unknown template token: ${match}`);
		}
		return value;
	});
}

interface TemplateEntry {
	/** Path relative to src/template/, with `/` separators. */
	readonly sourceRel: string;
	/** Path relative to outDir, with `/` separators. */
	readonly destRel: string;
	/** When true, file content is passed through token substitution. */
	readonly isTemplate: boolean;
}

const TEMPLATE_DIR_URL = new URL("./template/", import.meta.url);

async function listTemplateEntries(): Promise<TemplateEntry[]> {
	const root = fileURLToPath(TEMPLATE_DIR_URL);
	const out: TemplateEntry[] = [];

	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		for (const e of entries) {
			const full = join(current, e.name);
			if (e.isDirectory()) {
				await walk(full);
				continue;
			}
			const sourceRel = relative(root, full).replaceAll(sep, "/");
			out.push(buildEntry(sourceRel));
		}
	}

	await walk(root);
	out.sort((a, b) => a.destRel.localeCompare(b.destRel));
	return out;
}

function buildEntry(sourceRel: string): TemplateEntry {
	if (sourceRel.endsWith(".tmpl")) {
		return {
			sourceRel,
			destRel: sourceRel.slice(0, -".tmpl".length),
			isTemplate: true,
		};
	}
	// Rename `_gitignore` (root or nested) to `.gitignore`. npm publish strips
	// literal `.gitignore` from packages, so the template ships `_gitignore`.
	if (basename(sourceRel) === "_gitignore") {
		const dir = dirname(sourceRel);
		const destRel = dir === "." ? ".gitignore" : `${dir}/.gitignore`;
		return { sourceRel, destRel, isTemplate: false };
	}
	return { sourceRel, destRel: sourceRel, isTemplate: false };
}

async function isDirectoryEmpty(dir: string): Promise<boolean> {
	const entries = await readdir(dir);
	return entries.length === 0;
}

async function ensureCleanOutDir(outDir: string): Promise<void> {
	let exists = false;
	try {
		const st = await stat(outDir);
		exists = st.isDirectory();
		if (!exists) {
			throw new Error(`Output path exists but is not a directory: ${outDir}`);
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
			throw e;
		}
	}
	if (exists) {
		if (!(await isDirectoryEmpty(outDir))) {
			throw new ExistingDirectoryNonEmptyError(outDir);
		}
	} else {
		await mkdir(outDir, { recursive: true });
	}
}

async function writeEntry(
	entry: TemplateEntry,
	outDir: string,
	tokens: Record<string, string>,
): Promise<void> {
	const srcPath = fileURLToPath(new URL(entry.sourceRel, TEMPLATE_DIR_URL));
	const dstPath = join(outDir, entry.destRel);
	await mkdir(dirname(dstPath), { recursive: true });
	if (entry.isTemplate) {
		const text = await readFile(srcPath, "utf8");
		await writeFile(dstPath, substitute(text, tokens));
	} else {
		await cp(srcPath, dstPath, { force: true });
	}
}

async function runGitInit(outDir: string): Promise<void> {
	try {
		await execFileP("git", ["init", "-b", "main", outDir]);
	} catch {
		// no-op: a downstream user can `git init` manually.
	}
}

/**
 * Generate an auth.provider scaffold under `opts.outDir`.
 *
 * @throws {ExistingDirectoryNonEmptyError} when the target exists and is
 *   non-empty (create-app.md § 4.3).
 */
export async function generateAuthProviderScaffold(
	opts: GenerateOptions,
): Promise<GenerateResult> {
	const filled = fillDefaults(opts);
	if (!isSupportedLicense(filled.license)) {
		throw new Error(
			`Unsupported license: "${filled.license}". The v0.1 generator carries ` +
				`verbatim LICENSE bodies only for: ${SUPPORTED_LICENSES.join(", ")}. ` +
				"Broaden the allow-list via a follow-up issue before passing other values.",
		);
	}

	await ensureCleanOutDir(filled.outDir);

	const tokens = buildTokens(filled);
	const entries = await listTemplateEntries();
	const written: string[] = [];

	for (const entry of entries) {
		await writeEntry(entry, filled.outDir, tokens);
		written.push(entry.destRel);
	}

	// package.json is emitted separately so free-form values (description,
	// author) are JSON-escaped automatically rather than text-substituted
	// into quoted-string positions in a template.
	const pkgJsonPath = join(filled.outDir, "package.json");
	await writeFile(pkgJsonPath, buildPackageJson(filled));
	written.push("package.json");
	written.sort();

	if (filled.gitInit) {
		await runGitInit(filled.outDir);
	}

	return { outDir: filled.outDir, filesWritten: written };
}
