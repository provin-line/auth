/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Runs the real upstream generator (@o3co/auth-provider-scaffold) into a
// temporary directory and checks what the overlay made of it. Booting the
// result is the repo-level scaffold smoke's job (create-app.md § 6.3).

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LISTED_MODULES } from "../defaults.mjs";
import { ExistingDirectoryNonEmptyError } from "../errors.mjs";
import { generateAuthProviderScaffold } from "../generator.mjs";

const REF = "0123456789abcdef0123456789abcdef01234567";

let tmpRoot: string;
let outDir: string;
let filesWritten: readonly string[];

const read = (rel: string) => readFile(join(outDir, rel), "utf8");

beforeAll(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "create-auth-provider-gen-"));
	outDir = join(tmpRoot, "app");
	const result = await generateAuthProviderScaffold({
		name: "@acme/login",
		outDir,
		description: "Acme login",
		author: "Acme",
		dplaaxModuleRef: REF,
		registryBaseUrl: "http://registry.internal:8443",
		gitInit: false,
	});
	expect(result.outDir).toBe(outDir);
	filesWritten = result.filesWritten;
});

afterAll(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe("generateAuthProviderScaffold", () => {
	it("lists the files it wrote, sorted, with the overlay's and the license", () => {
		expect([...filesWritten]).toEqual([...filesWritten].sort());
		for (const f of [
			"package.json",
			"pnpm-workspace.yaml",
			"src/main.ts",
			"config/application.conf",
			"config/local.conf.example",
			".env.example",
			"Dockerfile",
			"README.md",
			"AGENTS.md",
			"LICENSE",
		]) {
			expect(filesWritten).toContain(f);
		}
	});

	it("asks upstream for the listed app, whose modules run in the app", async () => {
		const main = await read("src/main.ts");
		expect(main).toContain("token-endpoint/module");
		expect(main).toContain("client-allowance/module");
		expect(main).toContain("outbound/module");
		expect(main).toContain("discovery/module");
		expect(main).toContain('from "@o3co/auth-provider-oauth/token-control/module"');
		expect(LISTED_MODULES).toEqual([
			"@mod/token-endpoint",
			"@mod/client-allowance",
			"@mod/outbound",
			"@mod/discovery",
			"@mod/token-control",
		]);
	});

	it("composes the provin modules into the assemble list", async () => {
		const main = await read("src/main.ts");
		expect(main).toContain('import didGrant from "@provin-line/auth-did-grant/module"');
		expect(main).toMatch(/modules: \[[^\]]*didGrant, dplaaxRegistry, didGrantStore\]/);
	});

	it("names the project in package.json beside upstream's pinned dependencies", async () => {
		const pkg = JSON.parse(await read("package.json"));
		expect(pkg.name).toBe("@acme/login");
		expect(pkg.author).toBe("Acme");
		expect(pkg.license).toBe("Apache-2.0");
		expect(pkg.packageManager).toMatch(/^pnpm@11\./);
		expect(pkg.scripts.start).toContain("src/main.ts");
		expect(pkg.dependencies["@o3co/auth-provider-foundation"]).toBe("0.18.4");
		expect(pkg.dependencies["@provin-line/auth-did-grant"]).toBe(
			`github:provin-line/auth#${REF}&path:/packages/did-grant`,
		);
		expect(pkg.dependencies["@noble/ed25519"]).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("carries no workspace-only specifier", async () => {
		expect(await read("package.json")).not.toMatch(/"(workspace|file|link):/);
	});

	it("pins the transitive packages in the pnpm workspace file", async () => {
		const yaml = await read("pnpm-workspace.yaml");
		expect(yaml).toContain(`#${REF}&path:/packages/did-dplaax`);
		expect(yaml).toContain("allowBuilds:");
	});

	it("reads the registry's URL and the shared secret from the environment", async () => {
		expect(await read("config/application.conf")).toContain(
			"url = ${?DPLAAX_REGISTRY_URL}",
		);
		expect(await read(".env.example")).toContain(
			"# DPLAAX_REGISTRY_URL=http://registry.internal:8443",
		);
		expect(await read("config/application.conf")).toContain(
			"secret-encoding = ${?KEYS_SIGNING_SECRET_ENCODING}",
		);
	});

	it("writes the Apache-2.0 text verbatim from the package's own LICENSE", async () => {
		const own = await readFile(new URL("../../LICENSE", import.meta.url), "utf8");
		expect(await read("LICENSE")).toBe(own);
	});

	it("writes no build output or compiler configuration: the app runs its sources", () => {
		expect(filesWritten).not.toContain("tsconfig.json");
		expect(filesWritten.some((f) => f.startsWith("dist/"))).toBe(false);
	});

	it("initialises git only when asked", async () => {
		await expect(stat(join(outDir, ".git"))).rejects.toThrow();
		const withGit = join(tmpRoot, "with-git");
		await generateAuthProviderScaffold({
			name: "with-git",
			outDir: withGit,
			dplaaxModuleRef: REF,
			gitInit: true,
		});
		expect((await stat(join(withGit, ".git"))).isDirectory()).toBe(true);
	});

	it("escapes free-form values in package.json", async () => {
		const dir = join(tmpRoot, "tricky");
		await generateAuthProviderScaffold({
			name: "tricky",
			outDir: dir,
			description: 'say "hi"\nthere',
			dplaaxModuleRef: REF,
			gitInit: false,
		});
		const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
		expect(pkg.description).toBe('say "hi"\nthere');
	});
});

describe("generateAuthProviderScaffold — target and input policy", () => {
	it("accepts an existing empty target directory", async () => {
		const dir = join(tmpRoot, "empty");
		await mkdir(dir);
		const result = await generateAuthProviderScaffold({
			name: "empty",
			outDir: dir,
			dplaaxModuleRef: REF,
			gitInit: false,
		});
		expect(result.filesWritten).toContain("package.json");
	});

	it("refuses a non-empty target with ExistingDirectoryNonEmptyError, leaving it as it was", async () => {
		const dir = join(tmpRoot, "occupied");
		await mkdir(dir);
		await writeFile(join(dir, "keep.txt"), "mine");
		await expect(
			generateAuthProviderScaffold({
				name: "occupied",
				outDir: dir,
				dplaaxModuleRef: REF,
				gitInit: false,
			}),
		).rejects.toBeInstanceOf(ExistingDirectoryNonEmptyError);
		expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("mine");
		await expect(stat(join(dir, "package.json"))).rejects.toThrow();
	});

	it("refuses a target that is a file", async () => {
		const file = join(tmpRoot, "a-file");
		await writeFile(file, "x");
		await expect(
			generateAuthProviderScaffold({ name: "a-file", outDir: file, gitInit: false }),
		).rejects.toThrow(/not a directory/);
	});

	it("rejects an unsupported license before writing anything", async () => {
		const dir = join(tmpRoot, "licensed");
		await expect(
			generateAuthProviderScaffold({
				name: "licensed",
				outDir: dir,
				license: "MIT",
				gitInit: false,
			}),
		).rejects.toThrow(/Unsupported license/);
		await expect(stat(dir)).rejects.toThrow();
	});
});
