/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { OverlayOptions } from "./index.mjs";
import { PROVIN_PACKAGES } from "../provin-modules.mjs";

/**
 * Upstream's manifest under the project's name, description, license and
 * author. Upstream already depends on the provin modules it composed; a
 * manifest lacking one is refused, as upstream did not compose it. Built as an
 * object and serialized, so free-form values are JSON-escaped.
 */
export function patchPackageJson(text: string, opts: OverlayOptions): string {
	const upstream = JSON.parse(text) as Record<string, unknown>;
	const dependencies = (upstream.dependencies ?? {}) as Record<string, string>;
	const missing = PROVIN_PACKAGES.filter((p) => p.module && !(p.name in dependencies)).map((p) => p.name);
	if (missing.length > 0) {
		throw new Error(`package.json: upstream composed no ${missing.join(", ")}`);
	}
	const {
		name: _name,
		description: _description,
		license: _license,
		author: _author,
		...rest
	} = upstream;
	const manifest = {
		name: opts.name,
		description: opts.description,
		license: opts.license,
		...(opts.author === "" ? {} : { author: opts.author }),
		...rest,
	};
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}
