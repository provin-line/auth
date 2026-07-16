/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Direct-API tests for generateAuthProviderScaffold. Round-trip semantics
// of the artifact live in the repo-level scaffold smoke
// (create-app.md § 6.3); here we pin
// the smaller per-file invariants and the collision policy.

import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExistingDirectoryNonEmptyError } from "../errors.mjs";
import { generateAuthProviderScaffold, substitute } from "../generator.mjs";

let tmpRoot: string;

beforeEach(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "create-auth-provider-gen-"));
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe("generateAuthProviderScaffold — file emission", () => {
	it("creates the output dir when missing and writes the template tree", async () => {
		const outDir = join(tmpRoot, "fresh");
		const result = await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			gitInit: false,
		});
		expect(result.outDir).toBe(outDir);
		expect(result.filesWritten.length).toBeGreaterThan(10);
		expect(result.filesWritten).toContain("package.json");
		expect(result.filesWritten).toContain("src/main.mts");
		expect(result.filesWritten).toContain("config/application.conf");
		expect(result.filesWritten).toContain("config/clients.yaml");
		expect(result.filesWritten).toContain("keys/.gitkeep");
	});

	it("accepts an existing empty target directory", async () => {
		const outDir = join(tmpRoot, "empty");
		await mkdir(outDir);
		const result = await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			gitInit: false,
		});
		expect(result.filesWritten.length).toBeGreaterThan(0);
	});

	it("refuses a non-empty target directory with ExistingDirectoryNonEmptyError", async () => {
		const outDir = join(tmpRoot, "occupied");
		await mkdir(outDir);
		await writeFile(join(outDir, "preexisting.txt"), "hi");
		await expect(
			generateAuthProviderScaffold({
				name: "test-scaffold",
				outDir,
				gitInit: false,
			}),
		).rejects.toBeInstanceOf(ExistingDirectoryNonEmptyError);
	});
});

describe("generateAuthProviderScaffold — template substitution", () => {
	it("substitutes __NAME__ into package.json#name", async () => {
		const outDir = join(tmpRoot, "out");
		await generateAuthProviderScaffold({
			name: "@example/my-auth-provider",
			outDir,
			gitInit: false,
		});
		const pkg = JSON.parse(
			await readFile(join(outDir, "package.json"), "utf8"),
		) as { name: string };
		expect(pkg.name).toBe("@example/my-auth-provider");
	});

	it("substitutes __PORT__ into application.conf", async () => {
		const outDir = join(tmpRoot, "out");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			port: 4242,
			gitInit: false,
		});
		const conf = await readFile(
			join(outDir, "config/application.conf"),
			"utf8",
		);
		expect(conf).toMatch(/^\s*port = 4242$/m);
	});

	it("substitutes --registry-base-url into application.conf", async () => {
		const outDir = join(tmpRoot, "out");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			registryBaseUrl: "https://registry.example.test",
			gitInit: false,
		});
		const conf = await readFile(
			join(outDir, "config/application.conf"),
			"utf8",
		);
		expect(conf).toMatch(/baseUrl = "https:\/\/registry\.example\.test"/);
	});

	it("emits exact-pin dep versions (no caret)", async () => {
		const outDir = join(tmpRoot, "out");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			gitInit: false,
		});
		const pkg = JSON.parse(
			await readFile(join(outDir, "package.json"), "utf8"),
		) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		for (const [name, version] of Object.entries(pkg.dependencies)) {
			expect(
				version.startsWith("^") || version.startsWith("~"),
				`runtime dep ${name} should be exact-pinned, got "${version}"`,
			).toBe(false);
		}
		for (const [name, version] of Object.entries(pkg.devDependencies)) {
			expect(
				version.startsWith("^") || version.startsWith("~"),
				`dev dep ${name} should be exact-pinned, got "${version}"`,
			).toBe(false);
		}
	});

	it("declares @noble/ed25519 as a runtime dep so the DID grant's import.meta.resolve finds it", async () => {
		// The instance sets `pathResolver: import.meta.resolve` (main.mts), so the
		// ed25519_raw DID-grant verifier resolves @noble/ed25519 from the INSTANCE
		// root — it must be a direct dependency here, not merely a transitive one
		// (auth-provider-did declares it only as an optional peer). Without it the
		// provider boots but every DID grant fails with a runtime import error.
		const outDir = join(tmpRoot, "out-noble");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			gitInit: false,
		});
		const pkg = JSON.parse(
			await readFile(join(outDir, "package.json"), "utf8"),
		) as { dependencies: Record<string, string> };
		expect(
			pkg.dependencies["@noble/ed25519"],
			"@noble/ed25519 must be a direct runtime dependency of the generated instance",
		).toBeTruthy();
	});

	it("emits git-subdir form for @provin-line/auth-provider-dplaax-module", async () => {
		const outDir = join(tmpRoot, "out");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			dplaaxModuleRef: "v1.2.3",
			gitInit: false,
		});
		const pkg = JSON.parse(
			await readFile(join(outDir, "package.json"), "utf8"),
		) as { dependencies: Record<string, string> };
		expect(pkg.dependencies["@provin-line/auth-provider-dplaax-module"]).toBe(
			"github:provin-line/auth#v1.2.3&path:/packages/auth-provider-dplaax-module",
		);
	});

	it("emits pnpm.overrides pinning transitive @provin-line deps to the same ref (create-app.md § 3.4)", async () => {
		const outDir = join(tmpRoot, "out-pnpm-overrides");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			dplaaxModuleRef: "v1.2.3",
			gitInit: false,
		});
		const pkg = JSON.parse(
			await readFile(join(outDir, "package.json"), "utf8"),
		) as { pnpm: { overrides: Record<string, string> } };
		expect(pkg.pnpm.overrides).toEqual({
			"@provin-line/auth-provider-did":
				"github:provin-line/auth#v1.2.3&path:/packages/auth-provider-did",
			"@provin-line/did-dplaax":
				"github:provin-line/auth#v1.2.3&path:/packages/did-dplaax",
		});
	});

	it("emits pnpm.onlyBuiltDependencies for every git-fetched @provin-line package", async () => {
		const outDir = join(tmpRoot, "out-pnpm-built");
		await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			dplaaxModuleRef: "v1.2.3",
			gitInit: false,
		});
		const pkg = JSON.parse(
			await readFile(join(outDir, "package.json"), "utf8"),
		) as { pnpm: { onlyBuiltDependencies: string[] } };
		expect(pkg.pnpm.onlyBuiltDependencies).toEqual([
			"@provin-line/auth-provider-did",
			"@provin-line/auth-provider-dplaax-module",
			"@provin-line/did-dplaax",
		]);
	});

	it("renames _gitignore to .gitignore", async () => {
		const outDir = join(tmpRoot, "out");
		const result = await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			gitInit: false,
		});
		expect(result.filesWritten).toContain(".gitignore");
		expect(result.filesWritten).not.toContain("_gitignore");
		const content = await readFile(join(outDir, ".gitignore"), "utf8");
		expect(content).toMatch(/node_modules/);
		expect(content).toMatch(/keys\/\*\.pem/);
	});

	it("emits keys/.gitkeep placeholder for signing-key material", async () => {
		const outDir = join(tmpRoot, "out");
		const result = await generateAuthProviderScaffold({
			name: "test-scaffold",
			outDir,
			gitInit: false,
		});
		expect(result.filesWritten).toContain("keys/.gitkeep");
	});

	it("emits valid JSON even with JSON-special chars in free-form values", async () => {
		const outDir = join(tmpRoot, "out");
		const trickyDescription = 'A "tricky" \\ description\nwith newline';
		const trickyAuthor = 'Name "Quoted" <a@b>';
		await generateAuthProviderScaffold({
			name: "tricky",
			outDir,
			description: trickyDescription,
			author: trickyAuthor,
			gitInit: false,
		});
		const text = await readFile(join(outDir, "package.json"), "utf8");
		const obj = JSON.parse(text) as { description: string; author: string };
		expect(obj.description).toBe(trickyDescription);
		expect(obj.author).toBe(trickyAuthor);
	});
});

describe("generateAuthProviderScaffold — input validation", () => {
	it("rejects an unsupported --license value", async () => {
		const outDir = join(tmpRoot, "out");
		await expect(
			generateAuthProviderScaffold({
				name: "test-scaffold",
				outDir,
				license: "MIT",
				gitInit: false,
			}),
		).rejects.toThrow(/Unsupported license/);
	});
});

describe("substitute() — token totality", () => {
	it("replaces known tokens with their mapped values", () => {
		const result = substitute("Hello __NAME__, port __PORT__", {
			__NAME__: "world",
			__PORT__: "3000",
		});
		expect(result).toBe("Hello world, port 3000");
	});

	it("throws on any unknown token so unmapped templates can't ship silently", () => {
		expect(() =>
			substitute("__UNKNOWN_TOKEN__ in middle", { __NAME__: "x" }),
		).toThrowError(/Unknown template token: __UNKNOWN_TOKEN__/);
	});

	it("leaves single underscores and lowercase markers alone", () => {
		const result = substitute("_x_ and __lowercase__ and __VAL__", {
			__VAL__: "v",
		});
		expect(result).toBe("_x_ and __lowercase__ and v");
	});
});
