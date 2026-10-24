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
import { DID_GRANT_TYPE } from "./modules.mjs";

const TITLE = /^# .*$/m;

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
- \`store.accept-volatile = true\` with \`kernel.deployment = single\`: the spent nonces live in this process.
`;
}

/** The project's name and description as the README's opener, and the section naming the provin modules. */
export function patchReadme(text: string, opts: OverlayOptions): string {
	if (!TITLE.test(text)) {
		throw new Error("README.md: no title to name the project under");
	}
	const titled = text.replace(TITLE, () => `# ${opts.name}\n\n${opts.description}`);
	return `${titled.endsWith("\n") ? titled : `${titled}\n`}${section()}`;
}
