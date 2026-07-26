/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Static invariants over the template/ tree:
//
// 1. Every `__TOKEN__` ref inside src/template/ must be declared in
//    TEMPLATE_TOKEN_KEYS — otherwise generator.substitute() would throw
//    at runtime on the first scaffold that exercises the file.
//
// 2. Every key in TEMPLATE_TOKEN_KEYS must be referenced by at least one
//    template file — dead entries are bookkeeping noise that hide the
//    real interface between the generator and its templates.
//
// A broken token would also surface in the repo-level scaffold smoke
// (create-app.md § 6.3), but that runs an entire generate-install-boot
// cycle. Pinning the invariants here fails CI in milliseconds with a
// precise message.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATE_TOKEN_KEYS, TOKEN_RE } from "../generator.mjs";

const TEMPLATE_DIR = fileURLToPath(new URL("../template/", import.meta.url));

// Mirror `generator.buildEntry`'s `.tmpl` rule: substitute() is only called
// on files whose source path ends in `.tmpl`. Restricting the walker to the
// same set prevents the invariant from firing on legitimate `__DUNDER__`
// literals that might appear in plain `.mts` / `.json` / `.env.example`
// shipped under template/ but never passed through substitute().
async function walkTmplFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) await walk(full);
			else if (full.endsWith(".tmpl")) out.push(full);
		}
	}
	await walk(root);
	return out;
}

async function collectTemplateTokenRefs(): Promise<Set<string>> {
	const refs = new Set<string>();
	for (const file of await walkTmplFiles(TEMPLATE_DIR)) {
		const text = await readFile(file, "utf8");
		// Build a fresh regex per file: TOKEN_RE is /g, lastIndex would
		// carry between match() calls.
		const localRe = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
		const matches = text.match(localRe);
		if (matches) for (const m of matches) refs.add(m);
	}
	return refs;
}

describe("template token invariants", () => {
	it("every __TOKEN__ ref in src/template/ is declared in TEMPLATE_TOKEN_KEYS", async () => {
		const refs = await collectTemplateTokenRefs();
		const declared = new Set<string>(TEMPLATE_TOKEN_KEYS);
		const undeclared = [...refs].filter((r) => !declared.has(r)).sort();
		expect(
			undeclared,
			`Undeclared tokens referenced by templates: ${undeclared.join(", ")}. ` +
				`Add them to TEMPLATE_TOKEN_KEYS and buildTokens(), or remove the references.`,
		).toEqual([]);
	});

	it("every TEMPLATE_TOKEN_KEYS entry is referenced by at least one template", async () => {
		const refs = await collectTemplateTokenRefs();
		const unreferenced = TEMPLATE_TOKEN_KEYS.filter((k) => !refs.has(k)).sort();
		expect(
			unreferenced,
			`Declared tokens never used in templates: ${unreferenced.join(", ")}. ` +
				`Remove them from TEMPLATE_TOKEN_KEYS and buildTokens(), or reference them.`,
		).toEqual([]);
	});
});
