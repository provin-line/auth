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

// application.conf holds no value: each key reads its environment variable,
// as upstream's does. Lists and values that span sections go in the local
// layer (config/local.conf.example).

// Keys the composition needs bound that no module's example holds, so
// upstream's generator writes no binding for them: the HS256 secret a
// policy-verifier shares and how to read it, the statement that no module
// checks subject revocation, which boot requires of an app composing none,
// and the lifetime of the DID grant's tokens, which the grant holds to its
// bounds at boot.
const BINDINGS = [
	"keys.signing.secret = ${?KEYS_SIGNING_SECRET}",
	"keys.signing.secret-encoding = ${?KEYS_SIGNING_SECRET_ENCODING}",
	"tokens.subject-check = ${?TOKENS_SUBJECT_CHECK}",
	"tokens.access-token-lifetime = ${?TOKENS_ACCESS_TOKEN_LIFETIME}",
];

/** Binds the four keys above, after upstream's bindings, each to its variable. */
export function patchApplicationConf(text: string): string {
	return `${text.endsWith("\n") ? text : `${text}\n`}${BINDINGS.join("\n")}\n`;
}

const REGISTRY_LINE = /^# DPLAAX_REGISTRY_URL=.*$/m;

/**
 * Upstream's example with the registry's URL defaulted to the option, and the
 * variables the four keys above read, each commented out like upstream's.
 */
export function patchEnvExample(text: string, opts: OverlayOptions): string {
	if (!REGISTRY_LINE.test(text)) {
		throw new Error(".env.example: no DPLAAX_REGISTRY_URL line to default to the registry");
	}
	const withRegistry = text.replace(REGISTRY_LINE, () => `# DPLAAX_REGISTRY_URL=${opts.registryBaseUrl}`);
	const lines = [
		"## The dPLaaX modules (README.md). A policy-verifier sharing an HS256 secret reads it as UTF-8: set KEYS_SIGNING_ALG=HS256 and the two KEYS_SIGNING_SECRET lines, and leave KEYS_SIGNING_PRIVATE_KEY out.",
		"# KEYS_SIGNING_SECRET=REPLACE-SHARED-SECRET-OF-AT-LEAST-32-BYTES",
		"# KEYS_SIGNING_SECRET_ENCODING=utf8",
		"## Boot requires TOKENS_SUBJECT_CHECK=none while no composed module checks subject revocation.",
		"# TOKENS_SUBJECT_CHECK=none",
		"## Boot requires TOKENS_ACCESS_TOKEN_LIFETIME at most DID_GRANT_REVOCATION_LATENCY_BOUND, and under LEGACY_DID_LOGIN@1 at most DID_GRANT_LEGACY_MAX_TTL. Its default, 1h, is over DID_GRANT_LEGACY_MAX_TTL's default, 15m.",
		"# TOKENS_ACCESS_TOKEN_LIFETIME=10m",
	];
	return `${withRegistry.endsWith("\n") ? withRegistry : `${withRegistry}\n`}${lines.join("\n")}\n`;
}

const HTTP_DEFAULT_PORT = "80";

const ALLOW_PLACEHOLDER = '# \t"destination.example.invalid"';
const METHOD_LINE = /^# \t\t"method": "none"$/m;

/**
 * The local layer's example: the registry allowed through outbound (and named
 * for plain http inside the network), and the example client allowed the DID
 * grant, which no client may use until its `client-allowance` lists it.
 */
export function patchLocalConfExample(
	text: string,
	opts: OverlayOptions,
): string {
	if (!text.includes(ALLOW_PLACEHOLDER)) {
		throw new Error(
			"config/local.conf.example: no outbound.allow placeholder to replace",
		);
	}
	if (!METHOD_LINE.test(text)) {
		throw new Error(
			"config/local.conf.example: no example client to allow the DID grant",
		);
	}
	const url = new URL(opts.registryBaseUrl);
	const port = url.port === "" ? HTTP_DEFAULT_PORT : url.port;
	const allowed = text.replace(ALLOW_PLACEHOLDER, `# \t${JSON.stringify(url.hostname)}`);
	const withGrant = allowed.replace(
		METHOD_LINE,
		[
			'# \t\t"method": "none",',
			'# \t\t"sections": {',
			'# \t\t\t"client-allowance": {',
			`# \t\t\t\t"grants": [${JSON.stringify(DID_GRANT_TYPE)}]`,
			"# \t\t\t}",
			"# \t\t}",
		].join("\n"),
	);
	const reach =
		url.protocol === "http:"
			? [
					"## The registry over plain http, on a network trusted against reading and changing it:",
					"# outbound.plain-internal = [",
					`# \t${JSON.stringify(`${url.hostname}:${port}`)}`,
					"# ]",
				]
			: [
					"## The registry over https at a private address; its CA must be trusted by Node (NODE_EXTRA_CA_CERTS):",
					"# outbound.internal-hosts = [",
					`# \t${JSON.stringify(url.hostname)}`,
					"# ]",
				];
	return `${withGrant.endsWith("\n") ? withGrant : `${withGrant}\n`}${reach.join("\n")}\n`;
}
