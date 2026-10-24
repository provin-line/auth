/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
	gitSubdirectoryRef,
	isExactCommitSha,
	PINNED_TRANSITIVE,
	PROVIN_MODULES,
} from "./modules.mjs";

/**
 * The key pnpm 11 matches a git-hosted package's `allowBuilds` entry by: the
 * name and the source it resolves a `github:` reference to, a codeload tarball
 * of the commit. Known only for a commit SHA; a branch or tag resolves to a
 * commit not yet known here.
 */
function allowBuildsKey(packageName: string, dir: string, sha: string): string {
	return `${packageName}@https://codeload.github.com/provin-line/auth/tar.gz/${sha}#path:/packages/${dir}`;
}

/**
 * The app's pnpm 11 workspace settings (pnpm 11 no longer reads
 * `package.json#pnpm`):
 *
 * - `overrides` pin the `workspace:*` dependencies of the git-fetched
 *   packages, which no registry serves, to the same ref;
 * - `blockExoticSubdeps: false`, because those pinned packages are git
 *   sources below the app's direct dependencies, which pnpm 11 refuses by
 *   default;
 * - `allowBuilds` lets the git-fetched packages run their `prepare`, which
 *   builds them and which pnpm blocks for a package not allowed. For a ref
 *   that is not a commit SHA pnpm names the key to add when the install stops.
 *
 * Values are JSON strings, which are YAML double-quoted scalars.
 */
export function buildWorkspaceYaml(ref: string): string {
	const overrides = PINNED_TRANSITIVE.map(
		({ packageName, dir }) =>
			`  ${JSON.stringify(packageName)}: ${JSON.stringify(gitSubdirectoryRef(ref, dir))}`,
	);
	const fetched = [
		...PROVIN_MODULES.map(({ packageName, dir }) => ({ packageName, dir })),
		...PINNED_TRANSITIVE.filter(
			(p) => !PROVIN_MODULES.some((m) => m.packageName === p.packageName),
		),
	];
	const builds = isExactCommitSha(ref)
		? [
				"allowBuilds:",
				...fetched.map(
					({ packageName, dir }) =>
						`  ${JSON.stringify(allowBuildsKey(packageName, dir, ref))}: true`,
				),
			]
		: [
				"# allowBuilds: not written for a ref that is not a commit SHA; pnpm names the key to add.",
			];
	return [
		"# The provin modules are fetched from git, not npm (see the README).",
		"overrides:",
		...overrides,
		"blockExoticSubdeps: false",
		...builds,
		"",
	].join("\n");
}
