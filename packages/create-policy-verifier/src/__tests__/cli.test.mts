/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// CLI argument-parsing tests. The CLI's filesystem effects are exercised
// by generator.test.mts (collision policy + token substitution) and the
// repo-level scaffold smoke (create-app.md § 6.3, end-to-end against the
// generated artifact); this file pins the argument-to-exit-code surface.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIO } from "../cli.mjs";
import { isValidNpmName, main, resolveGitInit } from "../cli.mjs";

class CaptureStream extends Writable {
	chunks: string[] = [];
	override _write(
		chunk: Buffer | string,
		_enc: BufferEncoding,
		cb: (err?: Error | null) => void,
	): void {
		this.chunks.push(chunk.toString());
		cb();
	}
	text(): string {
		return this.chunks.join("");
	}
}

let tmpRoot: string;
let stdout: CaptureStream;
let stderr: CaptureStream;
let io: CliIO;

beforeEach(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "create-policy-verifier-cli-"));
	stdout = new CaptureStream();
	stderr = new CaptureStream();
	io = { stdout, stderr, cwd: tmpRoot };
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe("CLI main()", () => {
	it("prints help and exits 0 for --help", async () => {
		const code = await main(["--help"], io);
		expect(code).toBe(0);
		expect(stdout.text()).toMatch(/Usage: create-auth-policy-verifier/);
		expect(stderr.text()).toBe("");
	});

	it("prints help and exits 0 for -h", async () => {
		const code = await main(["-h"], io);
		expect(code).toBe(0);
		expect(stdout.text()).toMatch(/Usage:/);
	});

	it("prints version and exits 0 for --version", async () => {
		const code = await main(["--version"], io);
		expect(code).toBe(0);
		expect(stdout.text()).toMatch(/@provin-line\/create-auth-policy-verifier \d+\.\d+\.\d+/);
	});

	it("prints version for -V", async () => {
		const code = await main(["-V"], io);
		expect(code).toBe(0);
		expect(stdout.text()).toMatch(/@provin-line\/create-auth-policy-verifier/);
	});

	it("returns 2 when <name> is missing", async () => {
		const code = await main([], io);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/missing required <name>/);
	});

	it("returns 2 when too many positionals are given", async () => {
		const code = await main(["foo", "bar"], io);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/too many positional/);
	});

	it("returns 2 when --port is non-numeric", async () => {
		const code = await main(["foo", "--port", "not-a-number"], io);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--port must be a positive integer/);
	});

	it("returns 2 when --port is out of range", async () => {
		const code = await main(["foo", "--port", "70000"], io);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--port/);
	});

	it("returns 2 when --port is zero", async () => {
		const code = await main(["foo", "--port", "0"], io);
		expect(code).toBe(2);
	});

	it("returns 2 on unknown flag", async () => {
		const code = await main(["foo", "--unknown-flag"], io);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/unknown option/i);
	});

	it("returns 2 when --dplaax-module-ref is missing", async () => {
		const code = await main(["foo", "--no-git-init"], io);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--dplaax-module-ref is required/);
	});

	// A pin is a full commit SHA or it is not a pin. The predecessor of these
	// tests rejected a denylist of familiar branch names, which is the shape
	// release.pin.source-exact names as insufficient: any branch is movable,
	// and so is any tag.
	it.each([
		"main",
		"DEVELOP",
		"trunk",
		"v0.1.0",
		"release/2026-07",
		"my-feature",
		"HEAD~1",
		"deadbeef",
		"a".repeat(39),
		"A".repeat(40),
	])("returns 2 for the movable ref %s", async (ref) => {
		const code = await main(
			["foo", "--no-git-init", "--dplaax-module-ref", ref],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/not a commit SHA/);
	});

	it("names --allow-unpinned-ref as the way out", async () => {
		const code = await main(
			["foo", "--no-git-init", "--dplaax-module-ref", "main"],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--allow-unpinned-ref/);
	});

	// The escape has to actually work, or the rejection above is just a wall.
	it("accepts a branch under --allow-unpinned-ref", async () => {
		const code = await main(
			[
				"@provin-line/auth-policy-verifier",
				"--no-git-init",
				"--dplaax-module-ref",
				"main",
				"--allow-unpinned-ref",
				"--out",
				join(tmpRoot, "unpinned"),
			],
			io,
		);
		expect(code).toBe(0);
		expect(stderr.text()).toBe("");
	});

	// …and must not become a blanket bypass: it licenses an unpinned ref,
	// not a missing one.
	it("still requires the flag's value under --allow-unpinned-ref", async () => {
		const code = await main(
			["foo", "--no-git-init", "--allow-unpinned-ref"],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--dplaax-module-ref is required/);
	});

	it("returns 2 when --license is not in the supported allow-list", async () => {
		const code = await main(
			[
				"foo",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--license",
				"MIT",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--license "MIT" is not supported/);
	});

	it("scaffolds successfully with minimal args and exits 0", async () => {
		const code = await main(
			[
				"@provin-line/auth-policy-verifier",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(stderr.text()).toBe("");
		expect(code).toBe(0);
		expect(stdout.text()).toMatch(/Scaffolded \d+ files/);
	});

	it("uses last segment of scoped name as default output dir", async () => {
		const code = await main(
			[
				"@provin-line/auth-policy-verifier",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
			],
			io,
		);
		expect(code).toBe(0);
		// cwd is tmpRoot; default outDir = tmpRoot/auth-policy-verifier
		expect(stdout.text()).toMatch(/auth-policy-verifier/);
	});

	it("--no-git-init overrides --git-init when both are passed", async () => {
		const code = await main(
			[
				"foo",
				"--git-init",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(code).toBe(0);
	});

	it("returns 2 when --package-manager is not pnpm", async () => {
		const code = await main(
			[
				"foo",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--package-manager",
				"npm",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/--package-manager.*pnpm/);
	});

	it("returns 2 when --package-manager is yarn", async () => {
		const code = await main(
			[
				"foo",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--package-manager",
				"yarn",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(code).toBe(2);
	});

	it("accepts --package-manager pnpm", async () => {
		const code = await main(
			[
				"foo",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--package-manager",
				"pnpm",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(code).toBe(0);
	});

	it("returns 2 when <name> contains path-traversal segments", async () => {
		const code = await main(
			[
				"../../etc/foo",
				"--no-git-init",
				"--dplaax-module-ref",
				"1111111111111111111111111111111111111111",
				"--out",
				join(tmpRoot, "out"),
			],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/is not a valid npm package name/i);
	});

	it("returns 2 when <name> starts with a dot", async () => {
		const code = await main(
			[".foo", "--no-git-init", "--dplaax-module-ref", "1111111111111111111111111111111111111111"],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/is not a valid npm package name/i);
	});

	it("returns 2 when <name> contains uppercase letters", async () => {
		const code = await main(
			["Foo", "--no-git-init", "--dplaax-module-ref", "1111111111111111111111111111111111111111"],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/is not a valid npm package name/i);
	});

	it("returns 2 when <name> is a scoped name with empty pkg segment", async () => {
		const code = await main(
			["@scope/", "--no-git-init", "--dplaax-module-ref", "1111111111111111111111111111111111111111"],
			io,
		);
		expect(code).toBe(2);
		expect(stderr.text()).toMatch(/is not a valid npm package name/i);
	});

	it("returns 1 with ExistingDirectoryNonEmptyError message on populated target", async () => {
		// First scaffold succeeds.
		const out = join(tmpRoot, "scaffold");
		const first = await main(
			["foo", "--no-git-init", "--dplaax-module-ref", "1111111111111111111111111111111111111111", "--out", out],
			io,
		);
		expect(first).toBe(0);

		// Second scaffold into the same dir hits collision.
		const stdout2 = new CaptureStream();
		const stderr2 = new CaptureStream();
		const second = await main(
			["foo", "--no-git-init", "--dplaax-module-ref", "1111111111111111111111111111111111111111", "--out", out],
			{ stdout: stdout2, stderr: stderr2, cwd: tmpRoot },
		);
		expect(second).toBe(1);
		expect(stderr2.text()).toMatch(/not empty/);
	});
});

describe("resolveGitInit", () => {
	it("returns true when no relevant flag given", () => {
		expect(resolveGitInit([])).toBe(true);
		expect(resolveGitInit(["foo", "--port", "3000"])).toBe(true);
	});

	it("returns true when only --git-init given", () => {
		expect(resolveGitInit(["foo", "--git-init"])).toBe(true);
	});

	it("returns false when only --no-git-init given", () => {
		expect(resolveGitInit(["foo", "--no-git-init"])).toBe(false);
	});

	it("returns true (last wins) when --no-git-init then --git-init", () => {
		expect(resolveGitInit(["foo", "--no-git-init", "--git-init"])).toBe(true);
	});

	it("returns false (last wins) when --git-init then --no-git-init", () => {
		expect(resolveGitInit(["foo", "--git-init", "--no-git-init"])).toBe(false);
	});

	it("ignores flags after `--` separator", () => {
		// GNU convention: positionals after `--` are not flags.
		expect(resolveGitInit(["foo", "--git-init", "--", "--no-git-init"])).toBe(
			true,
		);
	});
});

describe("isValidNpmName", () => {
	const valid = [
		"foo",
		"foo-bar",
		"my_pkg",
		"a",
		"foo.bar",
		"@provin-line/auth-policy-verifier",
		"@a/b",
		"@scope-with-hyphen/pkg",
	];
	for (const name of valid) {
		it(`accepts ${JSON.stringify(name)}`, () => {
			expect(isValidNpmName(name)).toBe(true);
		});
	}

	const invalid = [
		"", // empty
		"../../etc/foo", // path traversal
		"foo/bar", // unscoped slash
		".foo", // leading dot
		"_foo", // leading underscore
		"Foo", // uppercase
		"foo BAR", // space + uppercase
		"@scope/", // empty pkg segment
		"@/foo", // empty scope
		"@scope/Foo", // uppercase in pkg
		"a".repeat(215), // too long
		"node_modules", // npm-reserved
		"favicon.ico", // npm-reserved
		"@provin-line/node_modules", // npm-reserved as scoped pkg
		"foo.", // trailing dot
		"foo-", // trailing hyphen
		"@scope-/foo", // scope ends in punctuation
	];
	for (const name of invalid) {
		it(`rejects ${JSON.stringify(name)}`, () => {
			expect(isValidNpmName(name)).toBe(false);
		});
	}
});
