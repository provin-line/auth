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

// application.conf holds no value: each key reads its environment variable,
// as upstream's does. Lists and values that span sections go in the local
// layer (config/local.conf.example).

const PRIVATE_KEY_LINE = /^(\s*)private-key = \$\{\?KEYS_SIGNING_PRIVATE_KEY\}$/m;

// `tokens.subject-check = none` states that no module checks subject
// revocation, which boot requires of an app composing none.
const PROVIN_SECTIONS = `tokens {
	subject-check = \${?TOKENS_SUBJECT_CHECK}
}
did-grant {
	message-max-age = \${?DID_GRANT_MESSAGE_MAX_AGE}
	auth-contract = \${?DID_GRANT_AUTH_CONTRACT}
	owner-migration-ratified = \${?DID_GRANT_OWNER_MIGRATION_RATIFIED}
	revocation-latency-bound = \${?DID_GRANT_REVOCATION_LATENCY_BOUND}
	legacy-max-ttl = \${?DID_GRANT_LEGACY_MAX_TTL}
	access-token-lifetime = \${?DID_GRANT_ACCESS_TOKEN_LIFETIME}
}
dplaax-registry {
	url = \${?DPLAAX_REGISTRY_URL}
	timeout = \${?DPLAAX_REGISTRY_TIMEOUT}
	max-document-size = \${?DPLAAX_REGISTRY_MAX_DOCUMENT_SIZE}
}
`;

/**
 * Adds the did-grant and dplaax-registry sections, and the shared secret and
 * its encoding to `keys.signing`: a deployment signing HS256 with a secret its
 * policy-verifier shares sets `secret-encoding = utf8`, the verifier's reading.
 */
export function patchApplicationConf(text: string): string {
	if (!PRIVATE_KEY_LINE.test(text)) {
		throw new Error(
			"config/application.conf: no keys.signing.private-key line to follow",
		);
	}
	const withSecret = text.replace(
		PRIVATE_KEY_LINE,
		(line, indent: string) =>
			`${line}\n${indent}secret = \${?KEYS_SIGNING_SECRET}\n${indent}secret-encoding = \${?KEYS_SIGNING_SECRET_ENCODING}`,
	);
	return `${withSecret.endsWith("\n") ? withSecret : `${withSecret}\n`}${PROVIN_SECTIONS}`;
}

/** The variables the added keys read, each commented out like upstream's. */
export function patchEnvExample(text: string, opts: OverlayOptions): string {
	const lines = [
		"## The dPLaaX modules (README.md). A policy-verifier sharing an HS256 secret reads it as UTF-8: set KEYS_SIGNING_ALG=HS256 and the two KEYS_SIGNING_SECRET lines, and leave KEYS_SIGNING_PRIVATE_KEY out.",
		"## Boot requires TOKENS_SUBJECT_CHECK=none while no composed module checks subject revocation.",
		"# TOKENS_SUBJECT_CHECK=none",
		"# KEYS_SIGNING_SECRET=REPLACE-SHARED-SECRET-OF-AT-LEAST-32-BYTES",
		"# KEYS_SIGNING_SECRET_ENCODING=utf8",
		"# DID_GRANT_REVOCATION_LATENCY_BOUND=15m",
		"# DID_GRANT_ACCESS_TOKEN_LIFETIME=10m",
		"# DID_GRANT_MESSAGE_MAX_AGE=5m",
		"# DID_GRANT_AUTH_CONTRACT=LEGACY_DID_LOGIN@1",
		"# DID_GRANT_OWNER_MIGRATION_RATIFIED=false",
		"# DID_GRANT_LEGACY_MAX_TTL=15m",
		`# DPLAAX_REGISTRY_URL=${opts.registryBaseUrl}`,
		"# DPLAAX_REGISTRY_TIMEOUT=5s",
		"# DPLAAX_REGISTRY_MAX_DOCUMENT_SIZE=64KiB",
	];
	return `${text.endsWith("\n") ? text : `${text}\n`}${lines.join("\n")}\n`;
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

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
	const port = url.port === "" ? (DEFAULT_PORTS[url.protocol] ?? "") : url.port;
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
	const plainInternal = [
		"## The registry over plain http, on a network trusted against reading and changing it (an https registry at a private address goes in outbound.internal-hosts instead):",
		"# outbound.plain-internal = [",
		`# \t${JSON.stringify(`${url.hostname}:${port}`)}`,
		"# ]",
	];
	return `${withGrant.endsWith("\n") ? withGrant : `${withGrant}\n`}${plainInternal.join("\n")}\n`;
}
