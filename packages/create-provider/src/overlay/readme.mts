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
import { DID_GRANT_TYPE } from "../provin-modules.mjs";

const TITLE = /^# .*$/m;

const CHANGING = /^## Changing the modules\n[\s\S]*?(?=^## |(?![\s\S]))/m;

function changingTheModules(): string {
	return `## Changing the modules

To change which modules are composed, run \`@provin-line/create-auth-provider\` again with the dPLaaX modules' ref, and carry the configuration over. Upstream's \`create-auth-provider\` shares the name but not the modules: it composes none of the dPLaaX ones, so running it over this app would drop them, and its \`--pattern\`, \`--add\` and \`--list\` do not exist in this generator.

Boot names what a change needs, and what cannot be composed.
`;
}

function section(): string {
	return `
## The dPLaaX modules

Composed beside the modules above, fetched from git (not npm) at the ref this app was generated with; \`pnpm install\` builds them. Each card, as installed, is the truth about its module:

- \`@provin-line/auth-did-grant\`: the DID grant, \`${DID_GRANT_TYPE}\`. \`node_modules/@provin-line/auth-did-grant/README.md\`
- \`@provin-line/auth-dplaax-registry\`: resolves did:dplaax owner DIDs against a registry, through outbound. \`node_modules/@provin-line/auth-dplaax-registry/README.md\`
- \`@provin-line/auth-did-grant-store\`: keeps the grant's spent nonces on the store. \`node_modules/@provin-line/auth-did-grant-store/README.md\`

Settings they need, besides upstream's:

- \`did-grant.revocation-latency-bound\` and \`did-grant.access-token-lifetime\` (required; \`DID_GRANT_REVOCATION_LATENCY_BOUND\`, \`DID_GRANT_ACCESS_TOKEN_LIFETIME\`).
- \`dplaax-registry.url\` (required; \`DPLAAX_REGISTRY_URL\`). It is reached through outbound: list its host in \`outbound.allow\`, and name its \`host:port\` in \`outbound.plain-internal\` for plain http inside a trusted network, or list the host in \`outbound.internal-hosts\` for https at a private address.
- \`clients.registered\`: a client uses the grant once \`sections.client-allowance.grants\` lists \`${DID_GRANT_TYPE}\`.
- \`keys.signing.secret\` and \`keys.signing.secret-encoding\`: with HS256 shared with a policy-verifier, \`utf8\`, the verifier's reading of the same string.
- \`tokens.subject-check = none\` (\`TOKENS_SUBJECT_CHECK\`): boot requires it, because this composition has no module that checks subject revocation.
- \`store.accept-volatile = true\` with \`kernel.deployment = single\`: the spent nonces live in this process, so a restart forgets them and reopens a replay window of \`did-grant.message-max-age\` (5m by default) for messages signed just before it.

## Installing from git

- \`pnpm-workspace.yaml\` pins the packages the modules reach through \`workspace:*\` to the same ref and allows the git-fetched packages their build (\`allowBuilds\`). It also sets \`blockExoticSubdeps: false\`, which turns pnpm's guard against git sources below direct dependencies off for the whole dependency graph; it goes once the provin packages are published to a registry.
- The ref is in \`package.json\`, in the overrides and in the \`allowBuilds\` keys: regenerate the app to move it, do not edit it by hand.
- pnpm 11 holds a release back until it is a day old. When this app pins a fresh \`@o3co\` release, the first install adds \`minimumReleaseAgeExclude\` entries to \`pnpm-workspace.yaml\`; keep them.
`;
}

/** The project's name and description as the README's opener, and the section naming the provin modules. */
export function patchReadme(text: string, opts: OverlayOptions): string {
	if (!TITLE.test(text)) {
		throw new Error("README.md: no title to name the project under");
	}
	const titled = text.replace(TITLE, () => `# ${opts.name}\n\n${opts.description}`);
	const body = CHANGING.test(titled)
		? titled.replace(CHANGING, () => changingTheModules())
		: titled;
	return `${body.endsWith("\n") ? body : `${body}\n`}${section()}`;
}
