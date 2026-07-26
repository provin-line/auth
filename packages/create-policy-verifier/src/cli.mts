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

// CLI entry for @provin-line/create-auth-policy-verifier. `main` is exported so unit
// tests can drive it without spawning a child process; the auto-invocation
// at the bottom is skipped when this file is imported as a module.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	isSupportedLicense,
	isSupportedPackageManager,
	SUPPORTED_LICENSES,
	SUPPORTED_PACKAGE_MANAGERS,
} from "./defaults.mjs";
import { ExistingDirectoryNonEmptyError } from "./errors.mjs";
import { generatePolicyVerifierScaffold } from "./generator.mjs";

// Read the package version from package.json at startup so `--version`
// stays in lockstep with the manifest automatically. Works in both src/
// (vitest) and dist/ (post-build) because the relative URL resolves the
// same way against import.meta.url in either layout.
const PACKAGE_VERSION = (
	JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string }
).version;

const HELP_TEXT = `Usage: create-auth-policy-verifier <name> --dplaax-module-ref <tag> [options]

Arguments:
  <name>                       Output directory + package.json name (positional, required).
                               May be a scoped package name like @org/foo;
                               the output directory uses the last segment.

Required:
  --dplaax-module-ref <ref>    Git ref pinned for
                               @provin-line/auth-policy-verifier-dplaax-module.
                               Per create-app.md § 3.3 this MUST be an exact tag,
                               not a moving branch — the CLI does not
                               default to keep the foot-gun closed.

Options:
  --description <text>         package.json description and README opener
                               (default: "dPLaaX policy-verifier instance").
  --port <n>                   Default http.port in config/application.conf
                               (default: 3001).
  --license <SPDX>             LICENSE file content + package.json field
                               (default: Apache-2.0; v0.1 supports only
                               ${SUPPORTED_LICENSES.join(", ")}).
  --author <name>              package.json author field.
  --git-init                   Run \`git init -b main\` after scaffolding (default).
  --no-git-init                Skip git init.
  --package-manager <pm>       Bin name used in Makefile + README install
                               instructions (default: pnpm). v0.1 supports
                               only ${SUPPORTED_PACKAGE_MANAGERS.join(", ")} because the dPLaaX-module
                               dep uses pnpm 10.x git-subdirectory syntax.
  --out <path>                 Output directory override (default:
                               last segment of <name> under cwd).
  -h, --help                   Show this help and exit.
  -V, --version                Print version and exit.
`;

export interface CliIO {
	readonly stdout: NodeJS.WritableStream;
	readonly stderr: NodeJS.WritableStream;
	readonly cwd: string;
}

const DEFAULT_IO: CliIO = {
	stdout: process.stdout,
	stderr: process.stderr,
	cwd: process.cwd(),
};

function lastNameSegment(name: string): string {
	const idx = name.lastIndexOf("/");
	return idx >= 0 ? name.slice(idx + 1) : name;
}

function parsePort(raw: string): number | null {
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0 || n > 65535) {
		return null;
	}
	return n;
}

/**
 * Known moving git refs we reject for `--dplaax-module-ref` per create-app.md § 3.3
 * (exact tag required). The list is intentionally conservative — operators
 * who use custom tag conventions (`release/...`, `v0.1.0`, SHAs) are
 * unaffected. Adding "HEAD" guards against tooling that resolves it
 * server-side to whatever commit happens to be current.
 */
const KNOWN_MOVING_REFS = new Set([
	"main",
	"master",
	"develop",
	"dev",
	"head",
	"trunk",
]);

function isLikelyMovingRef(ref: string): boolean {
	return KNOWN_MOVING_REFS.has(ref.toLowerCase());
}

/**
 * npm package-name validity check (modern lowercase rules).
 *
 * Why a custom check instead of `validate-npm-package-name`: zero runtime
 * deps for the bin. The pattern below matches npm's *publishable* rules
 * (lowercase only, no leading `.` or `_`, URL-safe character set, no
 * trailing punctuation) plus an explicit length cap. It is conservative —
 * `Foo` is rejected even though older registries tolerate it — because
 * the scaffold is meant for new packages, not republishing legacy names.
 *
 * Exported for unit testing. Catches typical foot-guns:
 * - path traversal (`../../etc/foo`)
 * - leading dot/underscore (npm reserves these for `.bin` / private)
 * - trailing dot or hyphen (npm rejects; URL-encoding ambiguity)
 * - whitespace, slashes outside the `@scope/name` form
 * - npm-reserved names (`node_modules`, `favicon.ico`)
 */
const NPM_NAME_SEGMENT = /^[a-z0-9](?:[a-z0-9-_.]*[a-z0-9])?$/;

/**
 * Names that collide with npm tooling internals — accepted by the segment
 * regex above but rejected by npm itself. Conservative list; the historic
 * `.bin` is already caught by the leading-dot rule.
 *
 * @see https://github.com/npm/validate-npm-package-name
 */
const NPM_RESERVED_NAMES: ReadonlySet<string> = new Set([
	"node_modules",
	"favicon.ico",
]);

export function isValidNpmName(name: string): boolean {
	if (name.length === 0 || name.length > 214) return false;
	if (NPM_RESERVED_NAMES.has(name)) return false;
	if (name.startsWith("@")) {
		const slashIdx = name.indexOf("/");
		if (slashIdx < 0) return false;
		const scope = name.slice(1, slashIdx);
		const pkg = name.slice(slashIdx + 1);
		if (NPM_RESERVED_NAMES.has(pkg)) return false;
		return NPM_NAME_SEGMENT.test(scope) && NPM_NAME_SEGMENT.test(pkg);
	}
	return NPM_NAME_SEGMENT.test(name);
}

/**
 * Resolve `--git-init` / `--no-git-init` with last-flag-wins semantics
 * (GNU convention). Operates on raw argv so the result reflects the order
 * the user typed, which `parseArgs.values` does not preserve.
 *
 * Flags appearing after the `--` terminator are treated as positionals and
 * ignored, matching GNU behaviour.
 *
 * Exported for unit testing. The default is `true` because the spec wants
 * scaffolds to be git-initialised by default; callers opt out with
 * `--no-git-init`.
 */
export function resolveGitInit(
	argv: readonly string[],
	defaultValue = true,
): boolean {
	let result = defaultValue;
	for (const arg of argv) {
		if (arg === "--") break;
		if (arg === "--git-init") result = true;
		else if (arg === "--no-git-init") result = false;
	}
	return result;
}

function parseCliArgs(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		options: {
			description: { type: "string" as const },
			port: { type: "string" as const },
			license: { type: "string" as const },
			author: { type: "string" as const },
			"git-init": { type: "boolean" as const },
			"no-git-init": { type: "boolean" as const },
			"package-manager": { type: "string" as const },
			out: { type: "string" as const },
			"dplaax-module-ref": { type: "string" as const },
			help: { type: "boolean" as const, short: "h" },
			version: { type: "boolean" as const, short: "V" },
		},
		allowPositionals: true,
	});
}

export async function main(
	argv: readonly string[],
	io: CliIO = DEFAULT_IO,
): Promise<number> {
	let parsed: ReturnType<typeof parseCliArgs>;
	try {
		parsed = parseCliArgs(argv);
	} catch (e) {
		io.stderr.write(`Error: ${(e as Error).message}\n\n${HELP_TEXT}`);
		return 2;
	}

	const { values, positionals } = parsed;

	if (values.help) {
		io.stdout.write(HELP_TEXT);
		return 0;
	}
	if (values.version) {
		io.stdout.write(`@provin-line/create-auth-policy-verifier ${PACKAGE_VERSION}\n`);
		return 0;
	}

	if (positionals.length === 0) {
		io.stderr.write(`Error: missing required <name> argument.\n\n${HELP_TEXT}`);
		return 2;
	}
	if (positionals.length > 1) {
		io.stderr.write(
			`Error: too many positional arguments (got ${positionals.length}, expected 1).\n\n${HELP_TEXT}`,
		);
		return 2;
	}

	const name = positionals[0];
	if (name === undefined) {
		// Unreachable: we already checked positionals.length above. The
		// explicit guard satisfies strict null-checking without an assertion.
		io.stderr.write(`Error: missing required <name> argument.\n\n${HELP_TEXT}`);
		return 2;
	}

	if (!isValidNpmName(name)) {
		io.stderr.write(
			`Error: "${name}" is not a valid npm package name. ` +
				`Names must be lowercase, start with a letter or digit, contain only ` +
				`[a-z0-9-_.], and be ≤214 chars. Scoped names use the form ` +
				`@scope/name. See https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name.\n`,
		);
		return 2;
	}

	let port: number | undefined;
	if (values.port !== undefined) {
		const parsedPort = parsePort(values.port);
		if (parsedPort === null) {
			io.stderr.write(
				`Error: --port must be a positive integer ≤ 65535 (got "${values.port}").\n`,
			);
			return 2;
		}
		port = parsedPort;
	}

	if (
		values.license !== undefined &&
		!isSupportedLicense(values.license)
	) {
		io.stderr.write(
			`Error: --license "${values.license}" is not supported in v0.1. ` +
				`Allowed: ${SUPPORTED_LICENSES.join(", ")}. ` +
				`Broaden the allow-list via a follow-up issue before passing other values.\n`,
		);
		return 2;
	}

	if (
		values["package-manager"] !== undefined &&
		!isSupportedPackageManager(values["package-manager"])
	) {
		io.stderr.write(
			`Error: --package-manager "${values["package-manager"]}" is not supported in v0.1. ` +
				`Allowed: ${SUPPORTED_PACKAGE_MANAGERS.join(", ")}. ` +
				`The scaffold's dPLaaX-module dep uses pnpm 10.x git-subdirectory syntax which ` +
				`other PMs do not understand; broaden this allow-list when they gain support.\n`,
		);
		return 2;
	}

	// create-app.md § 3.3 forbids moving refs (branches) for the dPLaaX-module dep:
	// pin must be an exact tag. The CLI both requires an explicit value
	// AND rejects known branch names so a typo or omitted flag cannot
	// silently ship a moving-target scaffold.
	const dplaaxModuleRef = values["dplaax-module-ref"];
	if (dplaaxModuleRef === undefined || dplaaxModuleRef === "") {
		io.stderr.write(
			`Error: --dplaax-module-ref is required (create-app.md § 3.3: exact tag, not a moving branch).\n\n${HELP_TEXT}`,
		);
		return 2;
	}
	if (isLikelyMovingRef(dplaaxModuleRef)) {
		io.stderr.write(
			`Error: --dplaax-module-ref "${dplaaxModuleRef}" is a moving branch; create-app.md § 3.3 requires an exact tag or commit SHA.\n`,
		);
		return 2;
	}

	// --git-init and --no-git-init are intentionally separate flags rather
	// than a single tri-state boolean: parseArgs does not natively model
	// "default true, override with --no-foo" without a custom layer.
	// resolveGitInit walks argv so the result is last-flag-wins (GNU
	// convention) — `values` from parseArgs drops the order.
	const gitInit = resolveGitInit(argv);

	const outDir = resolve(io.cwd, values.out ?? lastNameSegment(name));

	try {
		const result = await generatePolicyVerifierScaffold({
			name,
			outDir,
			description: values.description,
			port,
			license: values.license,
			author: values.author,
			gitInit,
			packageManager: values["package-manager"],
			dplaaxModuleRef,
		});

		io.stdout.write(
			`Scaffolded ${result.filesWritten.length} files at ${result.outDir}\n` +
				`\n` +
				`Next steps:\n` +
				`  cd ${result.outDir}\n` +
				`  ${values["package-manager"] ?? "pnpm"} install\n` +
				`  ${values["package-manager"] ?? "pnpm"} run test\n`,
		);
		return 0;
	} catch (e) {
		if (e instanceof ExistingDirectoryNonEmptyError) {
			io.stderr.write(`${e.message}\n`);
			return 1;
		}
		io.stderr.write(`Error: ${(e as Error).message}\n`);
		return 1;
	}
}

// Auto-invocation when run as a script via the `bin` entry in package.json.
// Skipped when this module is `import`-ed (e.g. by the unit tests).
const invokedAsScript =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === process.argv[1];

if (invokedAsScript) {
	const code = await main(process.argv.slice(2));
	process.exit(code);
}
