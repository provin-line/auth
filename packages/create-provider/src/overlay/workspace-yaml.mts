/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { PROVIN_PACKAGES } from "../provin-modules.mjs";

const EXCLUDE = /^minimumReleaseAgeExclude:\n((?: {2}- .*\n)*)/m;

/**
 * Upstream's pnpm workspace settings, with each provin library at its exact
 * version added to `minimumReleaseAgeExclude`. pnpm holds a version back
 * until it is a day old; upstream names there the modules the generator was
 * told were fresh, but not the library they depend on (`did-dplaax`), which
 * its generator cannot be told of. Naming it keeps a release installable on
 * its first day, at the version this generator release composes.
 */
export function patchWorkspaceYaml(text: string): string {
	const list = EXCLUDE.exec(text);
	if (list === null) {
		throw new Error("pnpm-workspace.yaml: no minimumReleaseAgeExclude list to add the provin libraries to");
	}
	const named = new Set((list[1] ?? "").split("\n"));
	const added = PROVIN_PACKAGES.filter((p) => !p.module)
		.map((p) => `  - ${JSON.stringify(`${p.name}@${p.version}`)}`)
		.filter((line) => !named.has(line));
	const end = list.index + list[0].length;
	return `${text.slice(0, end)}${added.map((line) => `${line}\n`).join("")}${text.slice(end)}`;
}
