/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The provin modules a generated app composes: the package
// each is published as, the directory it lives in under packages/ of
// provin-line/auth, and the identifier its default export is imported as.
//
// The npm name and the directory are separate facts: the directory does not
// repeat the `auth-` its location implies, the npm name in the @provin-line
// scope needs it. A git-subdirectory spec must name the directory.

export interface ProvinModule {
	readonly packageName: string;
	readonly dir: string;
	readonly importName: string;
	/** Whether the package ships a `reference.conf` with its section defaults. */
	readonly hasReferenceConf: boolean;
}

export const PROVIN_MODULES: readonly ProvinModule[] = [
	{
		packageName: "@provin-line/auth-did-grant",
		dir: "did-grant",
		importName: "didGrant",
		hasReferenceConf: true,
	},
	{
		packageName: "@provin-line/auth-dplaax-registry",
		dir: "dplaax-registry",
		importName: "dplaaxRegistry",
		hasReferenceConf: true,
	},
	{
		packageName: "@provin-line/auth-did-grant-store",
		dir: "did-grant-store",
		importName: "didGrantStore",
		hasReferenceConf: false,
	},
];

/**
 * Packages the modules above reach through `workspace:*` declarations, which a
 * consumer's install cannot resolve: each is pinned at the consumer's root to
 * the same ref. `@provin-line/auth-did-grant` is also a peer of the other two,
 * so pinning it keeps one copy of the contracts the kernel matches by object.
 */
export const PINNED_TRANSITIVE: readonly { packageName: string; dir: string }[] = [
	{ packageName: "@provin-line/did-dplaax", dir: "did-dplaax" },
	{ packageName: "@provin-line/auth-did-grant", dir: "did-grant" },
];

/** `github:` git-subdirectory spec of a package of provin-line/auth at `ref`. */
export function gitSubdirectoryRef(ref: string, dir: string): string {
	return `github:provin-line/auth#${ref}&path:/packages/${dir}`;
}

/** The OAuth grant type the DID grant is requested by. */
export const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";

/**
 * A pin is a full 40-hex commit SHA, or it is not a pin.
 *
 * The check is positive, not a denylist of familiar branch names: a denylist
 * rejects only the moving refs someone thought to enumerate, while
 * `release/2026-07`, `my-feature` and every tag are equally movable
 * (`release.pin.source-exact`).
 *
 * Lowercase only: git resolves object ids in lowercase, and accepting the
 * uppercase spelling would make one commit have two pin strings.
 */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export function isExactCommitSha(ref: string): boolean {
	return COMMIT_SHA.test(ref);
}
