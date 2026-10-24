/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { DEFAULT_DEP_VERSIONS } from "../defaults.mjs";
import type { OverlayOptions } from "./index.mjs";
import { gitSubdirectoryRef, PROVIN_MODULES } from "../provin-modules.mjs";

/**
 * The manifest upstream wrote, named for this project and depending on the
 * provin modules. Built as an object and serialized, so free-form values are
 * JSON-escaped.
 */
export function patchPackageJson(text: string, opts: OverlayOptions): string {
	const upstream = JSON.parse(text) as Record<string, unknown>;
	const dependencies = upstream.dependencies as
		| Record<string, string>
		| undefined;
	if (dependencies === undefined) {
		throw new Error("package.json: upstream wrote no dependencies");
	}
	const {
		name: _name,
		description: _description,
		license: _license,
		author: _author,
		...rest
	} = upstream;
	const manifest = {
		...rest,
		name: opts.name,
		description: opts.description,
		license: opts.license,
		...(opts.author === "" ? {} : { author: opts.author }),
		dependencies: {
			...dependencies,
			...Object.fromEntries(
				PROVIN_MODULES.map((m) => [
					m.packageName,
					gitSubdirectoryRef(opts.moduleRef, m.dir),
				]),
			),
			// The ed25519_raw verifier resolves it from the app's root.
			"@noble/ed25519": DEFAULT_DEP_VERSIONS["@noble/ed25519"],
		},
	};
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}
