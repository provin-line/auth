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

// CLI entry for @provin-line/create-auth-provider. `main` is exported so unit
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
import { generateAuthProviderScaffold } from "./generator.mjs";

// Read the package version from package.json at startup so `--version`
// stays in lockstep with the manifest automatically. Works in both src/
// (vitest) and dist/ (post-build) because the relative URL resolves the
// same way against import.meta.url in either layout.
const PACKAGE_VERSION = (
	JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string }
).version;

const HELP_TEXT = `Usage: create-auth-provider <name> --dplaax-module-ref <sha> [options]

Arguments:
  <name>                       Output directory + package.json name (positional, required).
                               May be a scoped package name like @org/foo;
                               the output directory uses the last segment.

Required:
  --dplaax-module-ref <sha>    Full 40-hex commit SHA pinning
                               @provin-line/auth-provider-dplaax-module.
                               Branches and tags both move, so neither
                               identifies the bytes an instance was
                               generated from. No default: the flag is
                               required so the pin is always a choice.

Options:
  --allow-unpinned-ref         Accept a branch or tag for
                               --dplaax-module-ref. Local iteration only:
                               the generated instance is not publishable,
                               because its dependency graph can change
                               under a name that did not.
  --description <text>         package.json description and README opener
                               (default: "dPLaaX auth.provider instance").
  --port <n>                   Default http.port in config/application.conf
                               (default: 3000).
  --license <SPDX>             LICENSE file content + package.json field
                               (default: Apache-2.0; v0.1 supports only
                               ${SUPPORTED_LICENSES.join(", ")}).
  --author <name>              package.json author field.
  --registry-base-url <url>    Default dplaax.registry.baseUrl in
                               config/application.conf (overridable at runtime
                               via DPLAAX_REGISTRY_BASE_URL).
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
 * A pin is a full 40-hex commit SHA, or it is not a pin.
 *
 * This replaced a denylist of familiar branch names (main, develop, …). A
 * denylist cannot be a pin discipline: it only rejects the moving refs someone
 * thought to enumerate, while `release/2026-07`, `my-feature` and every tag —
 * all equally movable — sailed through. `release.pin.source-exact` says so
 * outright, so the check is now the positive form.
 *
 * Lowercase only: git resolves object ids in lowercase, and accepting the
 * uppercase spelling would make one commit have two pin strings.
 */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export function isExactCommitSha(ref: string): boolean {
	return COMMIT_SHA.test(ref);
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

/**
 * Validate `--registry-base-url` so the substituted value cannot inject
 * HOCON or YAML metacharacters into the emitted config / docker-compose
 * files (Claude review Important #2). Returns an error message string when
 * invalid, or null on success.
 */
function validateRegistryBaseUrl(value: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return `--registry-base-url must be a valid URL (got "${value}")`;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return `--registry-base-url protocol must be http or https (got "${parsed.protocol}")`;
	}
	// Reject characters that would break HOCON / YAML double-quoted
	// string literals once interpolated. URL.parse accepts more than
	// these patterns will tolerate.
	if (/["\n\r\\]/.test(value)) {
		return "--registry-base-url contains characters that break HOCON/YAML quoting";
	}
	return null;
}

function parseCliArgs(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		options: {
			description: { type: "string" as const },
			port: { type: "string" as const },
			license: { type: "string" as const },
			author: { type: "string" as const },
			"registry-base-url": { type: "string" as const },
			"git-init": { type: "boolean" as const },
			"no-git-init": { type: "boolean" as const },
			"package-manager": { type: "string" as const },
			out: { type: "string" as const },
			"dplaax-module-ref": { type: "string" as const },
			"allow-unpinned-ref": { type: "boolean" as const },
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
		io.stdout.write(`@provin-line/create-auth-provider ${PACKAGE_VERSION}\n`);
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
		// Unreachable: we already checked positionals.length above.
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

	// A published release's source dependency resolves to a commit SHA or the
	// artifact's dependency graph is not pinned at all (release.pin.source-exact).
	// --allow-unpinned-ref is the mode boundary: local iteration against a branch
	// is legitimate, publishing from one is not, so the escape is explicit and
	// says in its own name what it gives up.
	const dplaaxModuleRef = values["dplaax-module-ref"];
	if (dplaaxModuleRef === undefined || dplaaxModuleRef === "") {
		io.stderr.write(
			`Error: --dplaax-module-ref is required (a full 40-hex commit SHA).\n\n${HELP_TEXT}`,
		);
		return 2;
	}
	if (!isExactCommitSha(dplaaxModuleRef) && values["allow-unpinned-ref"] !== true) {
		io.stderr.write(
			`Error: --dplaax-module-ref "${dplaaxModuleRef}" is not a commit SHA.\n` +
				`A pin must be a full 40-hex lowercase commit id; branches and tags both move, ` +
				`so neither identifies the bytes this instance was generated from.\n` +
				`For local iteration, pass --allow-unpinned-ref to accept it anyway — ` +
				`the result is not publishable.\n`,
		);
		return 2;
	}

	if (values["registry-base-url"] !== undefined) {
		const err = validateRegistryBaseUrl(values["registry-base-url"]);
		if (err !== null) {
			io.stderr.write(`Error: ${err}\n`);
			return 2;
		}
	}

	// --git-init and --no-git-init are intentionally separate flags rather
	// than a single tri-state boolean: parseArgs does not natively model
	// "default true, override with --no-foo" without a custom layer.
	// resolveGitInit walks argv so the result is last-flag-wins (GNU
	// convention) — `values` from parseArgs drops the order.
	const gitInit = resolveGitInit(argv);

	const outDir = resolve(io.cwd, values.out ?? lastNameSegment(name));

	try {
		const result = await generateAuthProviderScaffold({
			name,
			outDir,
			description: values.description,
			port,
			license: values.license,
			author: values.author,
			gitInit,
			packageManager: values["package-manager"],
			dplaaxModuleRef,
			registryBaseUrl: values["registry-base-url"],
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
