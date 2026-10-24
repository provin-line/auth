/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The seam through which provin's modules join the app upstream generates.
//
// Upstream's generator composes only the modules its own packages index, so
// the files it wrote are patched here, each by a pure function over one file.
// This directory is the whole of that: when upstream composes modules from
// outside its bundles itself, the generator calls it with the provin modules
// and this directory goes.

import { patchAgents } from "./agents.mjs";
import {
	patchApplicationConf,
	patchEnvExample,
	patchLocalConfExample,
} from "./config.mjs";
import { patchMainTs } from "./main-ts.mjs";
import { patchPackageJson } from "./package-json.mjs";
import { patchReadme } from "./readme.mjs";
import { buildWorkspaceYaml } from "./workspace-yaml.mjs";

export interface OverlayOptions {
	/** `package.json` name. */
	readonly name: string;
	readonly description: string;
	readonly license: string;
	/** Empty when none is given. */
	readonly author: string;
	/** Git ref of provin-line/auth the provin modules are fetched at. */
	readonly moduleRef: string;
	/** The registry's URL, the default of `DPLAAX_REGISTRY_URL`. */
	readonly registryBaseUrl: string;
}

/** Generated files by path relative to the app's root. */
export type GeneratedFiles = ReadonlyMap<string, string>;

const PATCHES: readonly (readonly [
	path: string,
	patch: (text: string, opts: OverlayOptions) => string,
])[] = [
	["package.json", patchPackageJson],
	["src/main.ts", patchMainTs],
	["config/application.conf", patchApplicationConf],
	[".env.example", patchEnvExample],
	["config/local.conf.example", patchLocalConfExample],
	["README.md", patchReadme],
	["AGENTS.md", patchAgents],
];

const WORKSPACE_FILE = "pnpm-workspace.yaml";

/**
 * The generated files with the provin modules composed in. Throws, naming the
 * file, when upstream no longer writes one the overlay patches or already
 * writes the one it adds: a silent skip would ship an app without the modules.
 */
export function applyProvinModules(
	files: GeneratedFiles,
	opts: OverlayOptions,
): Map<string, string> {
	if (files.has(WORKSPACE_FILE)) {
		throw new Error(
			`${WORKSPACE_FILE}: upstream wrote one; the overlay would overwrite it`,
		);
	}
	const out = new Map(files);
	for (const [path, patch] of PATCHES) {
		const text = files.get(path);
		if (text === undefined) {
			throw new Error(`${path}: upstream did not write it; nothing to patch`);
		}
		out.set(path, patch(text, opts));
	}
	out.set(WORKSPACE_FILE, buildWorkspaceYaml(opts.moduleRef));
	return out;
}
