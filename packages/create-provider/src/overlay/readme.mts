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

To change the app, run \`@provin-line/create-auth-provider\` again from outside this directory, at the version whose dPLaaX modules you want, and carry the configuration over: each version composes the modules at the versions it was released with. Upstream's \`create-auth-provider\` shares the name but composes the dPLaaX modules only when each is named as an \`npm:\` package, so running it over this app as upstream's guide says would drop them, and its \`--pattern\`, \`--add\` and \`--list\` do not exist in this generator.

Boot names what a change needs, and what cannot be composed.
`;
}

function section(): string {
	return `
## The dPLaaX modules

Composed beside the modules above as packages outside the release, from npm at the versions this app was generated with: \`## Packages outside this release\` records each, and each card, as installed, is the truth about its module.

Settings they need, besides upstream's:

- \`did-grant.revocation-latency-bound\` (required; \`DID_GRANT_REVOCATION_LATENCY_BOUND\`): \`tokens.access-token-lifetime\` (\`TOKENS_ACCESS_TOKEN_LIFETIME\`), the lifetime of the grant's tokens, must be at most this, and under \`LEGACY_DID_LOGIN@1\` at most \`did-grant.legacy-max-ttl\` (15m by default), or boot is refused. Its default, 1h, is over that, so set it.
- \`dplaax-registry.url\` (required; \`DPLAAX_REGISTRY_URL\`). It is reached through outbound: list its host in \`outbound.allow\`, and name its \`host:port\` in \`outbound.plain-internal\` for plain http inside a trusted network, or list the host in \`outbound.internal-hosts\` for https at a private address.
- \`clients.registered\`: a client uses the grant once \`sections.client-allowance.grants\` lists \`${DID_GRANT_TYPE}\`.
- \`keys.signing.secret\` and \`keys.signing.secret-encoding\` (\`KEYS_SIGNING_SECRET\`, \`KEYS_SIGNING_SECRET_ENCODING\`): with HS256 shared with a policy-verifier, \`utf8\`, the verifier's reading of the same string.
- \`tokens.subject-check = none\` (\`TOKENS_SUBJECT_CHECK\`): boot requires it, because this composition has no module that checks subject revocation.
- \`store.accept-volatile = true\` with \`kernel.deployment = single\`: the spent nonces and the revoked tokens live in this process, so a restart forgets them. It reopens a replay window of \`did-grant.message-max-age\` (5m by default) for messages signed just before it, and a revoked token introspects active again until it expires (within \`tokens.access-token-lifetime\`).
- Introspection (\`POST /oauth/introspect\`) answers \`confidential\` clients only: one with \`sections.client-secret.hash\` (bcrypt or scrypt) whose \`sections.client-allowance.audiences\` covers the token's audience. A DID client with no audiences is issued tokens for the issuer URL.

\`config/application.conf\` reads the four keys no module's example holds (\`keys.signing.secret\`, \`keys.signing.secret-encoding\`, \`tokens.subject-check\`, \`tokens.access-token-lifetime\`) from their variables too, but a refusal of one does not say where to write it.

## A did-dplaax release within its first day

\`@provin-line/auth-dplaax-registry\` depends on \`@provin-line/did-dplaax\`, which is not among the packages outside the release. pnpm holds a version back until it is a day old, so \`pnpm-workspace.yaml\` names did-dplaax at the version this app was generated with in \`minimumReleaseAgeExclude\`, as it names the modules. A newer did-dplaax resolved within its first day is held back: add it there at its exact version (\`"@provin-line/did-dplaax@<version>"\`), or wait a day.
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
