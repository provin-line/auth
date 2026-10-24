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
} from "../provin-modules.mjs";

const REPO = "git+https://github.com/provin-line/auth.git";

/**
 * The keys pnpm 11 matches a git-hosted package's `allowBuilds` entry by: the
 * name and the source it resolves the reference to. A `github:` reference
 * resolves to a codeload tarball, and to the git repository when the repo is
 * fetched through authenticated git; both are keyed, each scoped to the
 * commit. For a ref that is not a commit SHA the commit is not known here, so
 * the key is scoped to the repository, which pnpm matches at any ref.
 */
function allowBuildsKeys(
	packageName: string,
	dir: string,
	ref: string,
): string[] {
	if (!isExactCommitSha(ref)) return [`${packageName}@${REPO}`];
	return [
		`${packageName}@https://codeload.github.com/provin-line/auth/tar.gz/${ref}#path:/packages/${dir}`,
		`${packageName}@${REPO}#${ref}&path:/packages/${dir}`,
	];
}

/**
 * The app's pnpm 11 workspace settings (pnpm 11 no longer reads
 * `package.json#pnpm`):
 *
 * - `overrides` pin the `workspace:*` dependencies of the git-fetched
 *   packages, which no registry serves, to the same ref;
 * - `blockExoticSubdeps: false`, because those pinned packages are git
 *   sources below the app's direct dependencies, which pnpm 11 refuses by
 *   default. It turns that guard off for the whole dependency graph, and goes
 *   once the provin packages are published to a registry;
 * - `allowBuilds` lets the git-fetched packages run their `prepare`, which
 *   builds them and which pnpm blocks for a package not allowed.
 *
 * Keys and values are JSON strings, which are YAML double-quoted scalars (a
 * key beginning with `@` must be quoted).
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
	const builds = fetched.flatMap(({ packageName, dir }) =>
		allowBuildsKeys(packageName, dir, ref).map(
			(key) => `  ${JSON.stringify(key)}: true`,
		),
	);
	return [
		"# The provin modules are fetched from git, not npm. Regenerate the app to move the ref:",
		"# it is in package.json, in the overrides below and in the allowBuilds keys.",
		"overrides:",
		...overrides,
		"# The overridden packages are git sources below the app's direct dependencies, which",
		"# pnpm 11 refuses as exotic sub-dependencies. This turns that guard off for the whole",
		"# dependency graph; it goes once the provin packages are published to a registry.",
		"blockExoticSubdeps: false",
		"allowBuilds:",
		...builds,
		"",
	].join("\n");
}
