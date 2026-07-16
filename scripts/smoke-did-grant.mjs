/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Smoke: one real DID-grant round trip against a GENERATED auth-provider
 * instance (create-app.md § 6.3, hardened).
 *
 * The boot smoke (scripts/smoke-instance.sh) only proves the instance serves
 * its health endpoint — both historical consumer-install gaps (the PDP surface
 * drift and the generated provider's missing @noble/ed25519) sailed through
 * it. This script exercises the path those gaps lived on:
 *
 *   DID-signed assertion → POST /oauth/token (https://dplaax.dev/oauth/grant-type/did)
 *   → 200 + access_token
 *
 * plus one negative (tampered signature must NOT mint a token — proves the
 * verification actually runs rather than the endpoint 200-ing everything).
 *
 * Self-contained: Ed25519 via node:crypto (no deps), a throwaway in-process
 * DID registry serving the owner DID document, and a public smoke client
 * injected via CLIENT_REPOSITORY_PATH — the instance under test is never
 * mutated.
 *
 * Usage: node scripts/smoke-did-grant.mjs <instance-dir> <port>
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const [instanceDir, portArg] = process.argv.slice(2);
if (!instanceDir || !portArg) {
	console.error("usage: smoke-did-grant.mjs <instance-dir> <port>");
	process.exit(1);
}
const port = Number(portArg);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
	console.error(`smoke-did-grant: port ${JSON.stringify(portArg)} is not a valid port`);
	process.exit(1);
}

const mainMjs = path.join(instanceDir, "dist", "main.mjs");
if (!fs.existsSync(mainMjs)) {
	console.error(`smoke-did-grant: ${mainMjs} missing — run the build first`);
	process.exit(1);
}

// Stale-port guard first (same doctrine as smoke-instance.sh, and cheapest to
// fail) — any HTTP response means a stale server owns the port.
try {
	await fetch(`http://localhost:${port}/_healthcheck`, {
		signal: AbortSignal.timeout(2000),
	});
	console.error(
		`smoke-did-grant: port ${port} already serving — refusing to run against a stale server`,
	);
	process.exit(1);
} catch {
	/* expected: nothing listening */
}

const fail = (msg) => {
	console.error(`smoke-did-grant: ${msg}`);
	process.exitCode = 1;
};

// ── DID material (native Ed25519 — the CLIENT side deliberately avoids the
// instance's own crypto deps so a missing runtime dep in the scaffold cannot
// mask itself) ────────────────────────────────────────────────────────────────
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const ACCOUNT_ID = "smoke-ci-001";
// Registry segment must equal the registry base URL's hostname (the resolver's
// allow-list is hostname-based, ports stripped).
const DID = `did:dplaax:127.0.0.1:org:${ACCOUNT_ID}`;
const didDocument = {
	id: DID,
	verificationMethod: [
		{
			id: `${DID}#key-1`,
			type: "JsonWebKey2020",
			controller: DID,
			publicKeyJwk: publicKey.export({ format: "jwk" }),
		},
	],
};

// ── throwaway DID registry ────────────────────────────────────────────────────
const registry = http.createServer((req, res) => {
	if (req.url === `/did/org/${ACCOUNT_ID}/did.json`) {
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(didDocument));
		return;
	}
	res.statusCode = 404;
	res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((resolve, reject) => {
	registry.listen(0, "127.0.0.1", resolve);
	registry.on("error", reject);
});
const registryPort = registry.address().port;

// ── public smoke client, injected without touching the instance ─────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-did-grant-"));
const clientsPath = path.join(tmpDir, "clients.yaml");
const CLIENT_ID = "smoke-did-client";
fs.writeFileSync(
	clientsPath,
	`${CLIENT_ID}:\n  tokenEndpointAuthMethod: "none"\n  allowedRedirectUris: []\n  allowedScopes: []\n`,
);

// ── boot the instance under test ─────────────────────────────────────────────
const child = spawn("node", ["dist/main.mjs"], {
	cwd: instanceDir,
	stdio: ["ignore", "inherit", "inherit"],
	env: {
		...process.env,
		OAUTH_JWT_ALGORITHM: "HS256",
		OAUTH_JWT_SECRET: "smoke-only-secret",
		OAUTH_JWT_ISSUER: "https://smoke.invalid",
		HTTP_PORT: String(port),
		// The DID grant is not OIDC; allow the non-OIDC token path.
		OAUTH_OIDC_MODE: "dual",
		DPLAAX_REGISTRY_BASE_URL: `http://127.0.0.1:${registryPort}`,
		CLIENT_REPOSITORY_PATH: clientsPath,
	},
});
let childExited = false;
child.on("exit", () => {
	childExited = true;
});
const cleanup = () => {
	// SIGKILL: the exit handler cannot wait for a graceful shutdown, and a
	// lingering child would trip the next run's stale-port guard.
	child.kill("SIGKILL");
	registry.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

// ── wait for health ──────────────────────────────────────────────────────────
const base = `http://localhost:${port}`;
let healthy = false;
for (let i = 0; i < 30; i++) {
	try {
		const res = await fetch(`${base}/_healthcheck`, {
			signal: AbortSignal.timeout(1000),
		});
		if (res.ok) {
			healthy = true;
			break;
		}
	} catch {
		/* not up yet */
	}
	if (childExited) {
		fail("instance exited before becoming healthy");
		process.exit(1);
	}
	await new Promise((r) => setTimeout(r, 1000));
}
if (!healthy) {
	fail("health check timed out (30 attempts)");
	process.exit(1);
}

// ── the round trip ───────────────────────────────────────────────────────────
// Every leg builds a FRESH message: the provider's nonce-replay guard sits
// behind signature verification, so reusing a spent nonce would let a broken
// verifier hide behind a replay rejection (false pass on the negative leg).
const freshMessage = () =>
	JSON.stringify({
		did: DID,
		timestamp: new Date().toISOString(),
		nonce: crypto.randomBytes(16).toString("hex"),
	});
const signOver = (msg) =>
	crypto.sign(null, Buffer.from(msg, "utf8"), privateKey).toString("base64");

const tokenRequest = (msg, sig) =>
	fetch(`${base}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "https://dplaax.dev/oauth/grant-type/did",
			client_id: CLIENT_ID,
			did: DID,
			message: msg,
			signature: sig,
		}),
		signal: AbortSignal.timeout(10_000),
	});

const message = freshMessage();
const res = await tokenRequest(message, signOver(message));
const bodyText = await res.text();
if (res.status !== 200) {
	fail(`DID grant returned HTTP ${res.status}, want 200 — body: ${bodyText}`);
	process.exit(1);
}
let body;
try {
	body = JSON.parse(bodyText);
} catch {
	fail(`token response is not JSON: ${bodyText}`);
	process.exit(1);
}
if (typeof body.access_token !== "string" || body.access_token.length === 0) {
	fail(`token response carries no access_token: ${bodyText}`);
	process.exit(1);
}
if (body.token_type !== "Bearer") {
	fail(`token_type = ${JSON.stringify(body.token_type)}, want "Bearer"`);
	process.exit(1);
}

// Negative: a tampered signature over a FRESH message must be rejected as a
// client error. Without this, a provider that 200s everything would pass the
// positive leg; with a reused nonce, a broken verifier could hide behind the
// replay guard; and a 5xx would mean the server fell over, not that
// verification rejected it.
const badMessage = freshMessage();
const tampered = Buffer.from(signOver(badMessage), "base64");
tampered[0] ^= 0xff;
const badRes = await tokenRequest(badMessage, tampered.toString("base64"));
if (badRes.status === 200) {
	fail("tampered signature still minted a token — verification is not running");
	process.exit(1);
}
if (badRes.status < 400 || badRes.status > 499) {
	fail(
		`tampered signature yielded HTTP ${badRes.status}, want 4xx (verification reject, not a server fault)`,
	);
	process.exit(1);
}

console.log(
	`smoke-did-grant: OK — DID grant minted a Bearer token on :${port} (tampered signature rejected with HTTP ${badRes.status})`,
);
process.exit(0);
