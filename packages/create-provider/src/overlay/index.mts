/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Upstream's generator composes the provin modules as packages outside its
// release and writes their sections' bindings from their examples. What it
// does not write for them is patched here, each by a pure function over one
// generated file: the project's name and license, the keys no module's
// example holds, the registry's default URL and how outbound reaches it, the
// DID grant in the example client, the library the modules depend on in the
// day-old-release exclusions, and the README's account of the modules.

import {
	patchApplicationConf,
	patchEnvExample,
	patchLocalConfExample,
} from "./config.mjs";
import { patchPackageJson } from "./package-json.mjs";
import { patchReadme } from "./readme.mjs";
import { patchWorkspaceYaml } from "./workspace-yaml.mjs";

export interface OverlayOptions {
	/** `package.json` name. */
	readonly name: string;
	readonly description: string;
	readonly license: string;
	/** Empty when none is given. */
	readonly author: string;
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
	["config/application.conf", patchApplicationConf],
	[".env.example", patchEnvExample],
	["config/local.conf.example", patchLocalConfExample],
	["README.md", patchReadme],
	["pnpm-workspace.yaml", patchWorkspaceYaml],
];

/**
 * The generated files with the overlay's patches applied. Throws, naming the
 * file, when upstream no longer writes one the overlay patches: a silent skip
 * would ship an app missing what the provin modules need.
 */
export function applyProvinModules(
	files: GeneratedFiles,
	opts: OverlayOptions,
): Map<string, string> {
	const out = new Map(files);
	for (const [path, patch] of PATCHES) {
		const text = files.get(path);
		if (text === undefined) {
			throw new Error(`${path}: upstream did not write it; nothing to patch`);
		}
		out.set(path, patch(text, opts));
	}
	return out;
}
