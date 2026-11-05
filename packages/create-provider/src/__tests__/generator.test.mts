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
// temporary directory, reading the provin modules from the project the test
// run staged, and checks what the overlay made of it. Booting the result is
// the repo-level scaffold smoke's job (create-app.md § 6.3).

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { parse } from "yaml";
import { LISTED_MODULES } from "../defaults.mjs";
import { ExistingDirectoryNonEmptyError } from "../errors.mjs";
import { generateAuthProviderScaffold } from "../generator.mjs";
import { STAGING_PACKAGE_MANAGER } from "../staging.mjs";

/** A project where pnpm installed the provin modules, staged once for the run. */
const staged = inject("stagedProject");
/** This generator's own version, which it composes every provin package at. */
const release = (JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as { version: string })
	.version;

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
		outsideFrom: staged,
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
			"outside-modules.json",
			"scripts/check-outside.mjs",
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

	it("has upstream compose the provin modules, as packages outside its release", async () => {
		const main = await read("src/main.ts");
		for (const name of ["auth-did-grant", "auth-did-grant-store", "auth-dplaax-registry"]) {
			expect(main).toContain(`from "@provin-line/${name}/module"`);
		}
		const record = JSON.parse(await read("outside-modules.json")) as { modules: { name: string; version: string }[] };
		expect(record.modules.map((m) => `${m.name}@${m.version}`)).toEqual([
			`@provin-line/auth-did-grant@${release}`,
			`@provin-line/auth-did-grant-store@${release}`,
			`@provin-line/auth-dplaax-registry@${release}`,
		]);
	});

	it("names the project in package.json beside upstream's pinned dependencies", async () => {
		const pkg = JSON.parse(await read("package.json"));
		expect(pkg.name).toBe("@acme/login");
		expect(pkg.author).toBe("Acme");
		expect(pkg.license).toBe("Apache-2.0");
		// The pnpm the generator stages with is the one upstream pins the app to.
		expect(pkg.packageManager).toBe(STAGING_PACKAGE_MANAGER);
		expect(pkg.dependencies["@o3co/auth-provider-foundation"]).toBe("0.19.0");
		expect(pkg.dependencies["@provin-line/auth-did-grant"]).toBe(release);
		expect(pkg.dependencies).not.toHaveProperty("@noble/ed25519");
	});

	it("carries no workspace-only specifier", async () => {
		expect(await read("package.json")).not.toMatch(/"(workspace|file|link):/);
	});

	it("lets the provin packages, did-dplaax among them, install within their first day", async () => {
		const yaml = await read("pnpm-workspace.yaml");
		const excluded = (parse(yaml) as { minimumReleaseAgeExclude: string[] }).minimumReleaseAgeExclude;
		for (const name of ["auth-did-grant", "auth-did-grant-store", "auth-dplaax-registry", "did-dplaax"]) {
			expect(excluded).toContain(`@provin-line/${name}@${release}`);
		}
		expect(yaml).not.toMatch(/allowBuilds|blockExoticSubdeps|github:/);
	});

	it("reads the registry's URL and the shared secret from the environment", async () => {
		expect(await read("config/application.conf")).toContain(
			"url = ${?DPLAAX_REGISTRY_URL}",
		);
		expect(await read(".env.example")).toContain(
			"# DPLAAX_REGISTRY_URL=http://registry.internal:8443",
		);
		expect(await read("config/application.conf")).toContain(
			"keys.signing.secret-encoding = ${?KEYS_SIGNING_SECRET_ENCODING}",
		);
	});

	it("binds every scalar key of the provin sections, from their packages' examples", async () => {
		const conf = await read("config/application.conf");
		for (const line of [
			"message-max-age = ${?DID_GRANT_MESSAGE_MAX_AGE}",
			"auth-contract = ${?DID_GRANT_AUTH_CONTRACT}",
			"owner-migration-ratified = ${?DID_GRANT_OWNER_MIGRATION_RATIFIED}",
			"revocation-latency-bound = ${?DID_GRANT_REVOCATION_LATENCY_BOUND}",
			"legacy-max-ttl = ${?DID_GRANT_LEGACY_MAX_TTL}",
			"timeout = ${?DPLAAX_REGISTRY_TIMEOUT}",
			"max-document-size = ${?DPLAAX_REGISTRY_MAX_DOCUMENT_SIZE}",
			"tokens.access-token-lifetime = ${?TOKENS_ACCESS_TOKEN_LIFETIME}",
		]) {
			expect(conf).toContain(line);
		}
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
			outsideFrom: staged,
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
			outsideFrom: staged,
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
			outsideFrom: staged,
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
				outsideFrom: staged,
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
			generateAuthProviderScaffold({ name: "a-file", outDir: file, outsideFrom: staged, gitInit: false }),
		).rejects.toThrow(/not a directory/);
	});

	it("rejects an unsupported license before writing anything", async () => {
		const dir = join(tmpRoot, "licensed");
		await expect(
			generateAuthProviderScaffold({
				name: "licensed",
				outDir: dir,
				license: "MIT",
				outsideFrom: staged,
				gitInit: false,
			}),
		).rejects.toThrow(/Unsupported license/);
		await expect(stat(dir)).rejects.toThrow();
	});
});
