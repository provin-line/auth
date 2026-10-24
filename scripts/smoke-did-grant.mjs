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
 * A boot alone proves little: the consumer-install gaps this repo has had
 * (the PDP surface drift, a missing @noble/ed25519) all booted. This script
 * exercises the path they lived on:
 *
 *   DID-signed assertion → POST /oauth/token (https://dplaax.dev/oauth/grant-type/did)
 *   → 200 + access_token
 *
 * The token is checked as a consumer would read it: signed with the HS256
 * secret as UTF-8 bytes (the policy-verifier's reading, keys.signing.secret-encoding
 * = utf8) and carrying the six claims of dplaax.spec's auth.token.signed-claims.
 * One negative follows: a tampered signature must NOT mint a token — proves the
 * verification actually runs rather than the endpoint 200-ing everything.
 * Last, token-control: the metadata names the revocation and introspection
 * endpoints, a confidential client introspects the token active, its client
 * revokes it, and introspection then answers it inactive.
 *
 * Self-contained: Ed25519 via node:crypto (no deps), a throwaway in-process
 * DID registry serving the owner DID document on loopback, and the instance's
 * settings supplied from outside — its environment for the keys application.conf
 * reads, and a local layer file (APP_CONFIG) for the lists. The instance under
 * test is never mutated.
 *
 * Against a built image instead of a directory (--image), the instance runs in
 * a container: the registry then listens on every interface and is named
 * host.docker.internal, which outbound reaches as a plain-internal peer (the
 * host-gateway address is private), and the container's port 8080 is
 * published on <port>.
 *
 * Usage: node scripts/smoke-did-grant.mjs <instance-dir> <port>
 *        node scripts/smoke-did-grant.mjs --image <image> <port>
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const image = args[0] === "--image" ? args[1] : undefined;
if (args[0] === "--image") args.splice(0, 2);
const [instanceDir, portArg] = image === undefined ? args : [undefined, args[0]];
if ((image === undefined && !instanceDir) || !portArg || args[0] === "--image") {
	console.error(
		"usage: smoke-did-grant.mjs <instance-dir> <port> | --image <image> <port>",
	);
	process.exit(1);
}
const port = Number(portArg);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
	console.error(`smoke-did-grant: port ${JSON.stringify(portArg)} is not a valid port`);
	process.exit(1);
}

if (image === undefined) {
	const mainTs = path.join(instanceDir, "src", "main.ts");
	if (!fs.existsSync(mainTs)) {
		console.error(`smoke-did-grant: ${mainTs} missing — generate the instance first`);
		process.exit(1);
	}
	if (!fs.existsSync(path.join(instanceDir, "node_modules"))) {
		console.error(`smoke-did-grant: ${instanceDir}/node_modules missing — install first`);
		process.exit(1);
	}
}
// The name the registry is reached by, which is the DID's registry segment.
const registryHost = image === undefined ? "127.0.0.1" : "host.docker.internal";

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
// The DID's registry segment must be the registry URL's host.
const DID = `did:dplaax:${registryHost}:org:${ACCOUNT_ID}`;
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
	registry.listen(0, image === undefined ? "127.0.0.1" : "0.0.0.0", resolve);
	registry.on("error", reject);
});
const registryPort = registry.address().port;

// ── the instance's settings, from outside the instance ──────────────────────
// A shared secret both an HS256 provider and a policy-verifier read as UTF-8.
const SECRET = "smoke.only.secret.at.least.32.bytes.long";
const CLIENT_ID = "smoke-did-client";
// A confidential client to introspect with (introspection refuses public
// ones), its secret held as the scrypt hash secret-hash reads. The DID client
// names no audience, so its tokens are for the issuer: the introspector may
// see that audience.
const INTROSPECTOR_ID = "smoke-introspector";
const INTROSPECTOR_SECRET = crypto.randomBytes(24).toString("base64url");
const introspectorHash = (() => {
	const salt = crypto.randomBytes(16);
	const key = crypto.scryptSync(INTROSPECTOR_SECRET, salt, 32, { N: 1024, r: 8, p: 1 });
	const b64 = (bytes) => bytes.toString("base64").replace(/=+$/, "");
	return `$scrypt$ln=10,r=8,p=1$${b64(salt)}$${b64(key)}`;
})();
const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";
const origin = `http://localhost:${port}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-did-grant-"));
const localConf = path.join(tmpDir, "local.conf");
// Plain http to the registry: outbound admits the pair by name (loopback for a
// directory, a private peer for a container), and the host must pass its allow
// list too.
const outboundConf =
	image === undefined
		? `outbound.plain-loopback = ["${registryHost}:${registryPort}"]`
		: `outbound.plain-internal = ["${registryHost}:${registryPort}"]`;
fs.writeFileSync(
	localConf,
	`outbound.allow = ["${registryHost}"]
${outboundConf}
audit.receivers = [log]
clients.registered = [
	{
		id = "${CLIENT_ID}"
		kind = public
		method = none
		sections {
			client-allowance {
				grants = ["${DID_GRANT_TYPE}"]
			}
		}
	}
	{
		id = "${INTROSPECTOR_ID}"
		kind = confidential
		method = client_secret_basic
		sections {
			client-secret { hash = "${introspectorHash}" }
			client-allowance { audiences = ["${origin}"] }
		}
	}
]
`,
	{ mode: 0o644 },
);

// ── boot the instance under test ─────────────────────────────────────────────
const settings = {
	KERNEL_DEPLOYMENT: "single",
	STORE_ACCEPT_VOLATILE: "true",
	TOKENS_REVOCATION: "denylist",
	TOKENS_SUBJECT_CHECK: "none",
	HTTP_PUBLIC_ORIGIN: origin,
	HTTP_INSECURE_ORIGIN: "true",
	ISSUER_URL: origin,
	KEYS_SIGNING_KID: "smoke-1",
	KEYS_SIGNING_ALG: "HS256",
	KEYS_SIGNING_SECRET: SECRET,
	KEYS_SIGNING_SECRET_ENCODING: "utf8",
	DID_GRANT_REVOCATION_LATENCY_BOUND: "15m",
	DID_GRANT_ACCESS_TOKEN_LIFETIME: "10m",
	DPLAAX_REGISTRY_URL: `http://${registryHost}:${registryPort}`,
};
const containerName = `smoke-did-grant-${process.pid}`;
const child =
	image === undefined
		? spawn("node", ["src/main.ts"], {
				cwd: instanceDir,
				stdio: ["ignore", "inherit", "inherit"],
				// Only what node needs and what is set here: the caller's
				// environment may hold settings (HTTP_*, KEYS_*, proxy variables)
				// that would change what is under test or refuse its boot.
				env: {
					PATH: process.env.PATH,
					HOME: process.env.HOME,
					APP_CONFIG: `${localConf},config/application.conf`,
					HTTP_HOST: "127.0.0.1",
					HTTP_PORT: String(port),
					...settings,
				},
			})
		: spawn(
				"docker",
				[
					"run",
					"--rm",
					"--name",
					containerName,
					"--add-host",
					"host.docker.internal:host-gateway",
					"-p",
					`127.0.0.1:${port}:8080`,
					"-v",
					`${localConf}:/app/config/local.conf:ro`,
					...Object.entries({
						APP_CONFIG: "config/local.conf,config/application.conf",
						HTTP_HOST: "0.0.0.0",
						HTTP_PORT: "8080",
						...settings,
					}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
					image,
				],
				{ stdio: ["ignore", "inherit", "inherit"], env: { PATH: process.env.PATH, HOME: process.env.HOME } },
			);
let childExited = false;
child.on("exit", () => {
	childExited = true;
});
const cleanup = () => {
	// SIGKILL: the exit handler cannot wait for a graceful shutdown, and a
	// lingering child would trip the next run's stale-port guard.
	child.kill("SIGKILL");
	if (image !== undefined) {
		spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
	}
	registry.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

// ── wait for health ──────────────────────────────────────────────────────────
const base = origin;
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
			grant_type: DID_GRANT_TYPE,
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

// The token as a consumer reads it: HS256 over the secret's UTF-8 bytes, for
// the DID, with the six claims dplaax.spec asks of a DID grant's token.
const [encHeader, encPayload, encSignature] = body.access_token.split(".");
const expected = crypto
	.createHmac("sha256", Buffer.from(SECRET, "utf8"))
	.update(`${encHeader}.${encPayload}`)
	.digest("base64url");
if (expected !== encSignature) {
	fail("access_token is not signed with the secret read as UTF-8");
	process.exit(1);
}
const claims = JSON.parse(Buffer.from(encPayload, "base64url").toString("utf8"));
if (claims.sub !== DID || claims.client_id !== CLIENT_ID || claims.iss !== origin) {
	fail(`unexpected sub/client_id/iss in ${JSON.stringify(claims)}`);
	process.exit(1);
}
for (const name of [
	"auth_contract_id",
	"verification_method",
	"did_document_snapshot",
	"lifecycle_state_ref",
	"lifecycle_freshness_ref",
	"authorization_scope",
]) {
	if (typeof claims[name] !== "string" || claims[name] === "") {
		fail(`access_token lacks the signed claim ${name}`);
		process.exit(1);
	}
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

// token-control: the metadata names both endpoints; introspection answers the
// token active to the confidential client and refuses the public one; the
// client the token was issued to revokes it, and introspection then answers it
// inactive. Revocation answers 200 for a token it does not revoke too, so only
// the second introspection shows the revocation held.
const metaRes = await fetch(`${base}/.well-known/oauth-authorization-server`, {
	signal: AbortSignal.timeout(10_000),
});
const meta = metaRes.status === 200 ? await metaRes.json() : {};
for (const [name, route] of [
	["revocation_endpoint", "/oauth/revoke"],
	["introspection_endpoint", "/oauth/introspect"],
]) {
	if (meta[name] !== `${origin}${route}`) {
		fail(`metadata ${name} = ${JSON.stringify(meta[name])}, want ${origin}${route} (HTTP ${metaRes.status})`);
		process.exit(1);
	}
}
const introspect = (token, authorization) =>
	fetch(`${base}/oauth/introspect`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", ...authorization },
		body: new URLSearchParams({ token, ...(authorization ? {} : { client_id: CLIENT_ID }) }),
		signal: AbortSignal.timeout(10_000),
	});
const asIntrospector = {
	authorization: `Basic ${Buffer.from(`${INTROSPECTOR_ID}:${INTROSPECTOR_SECRET}`).toString("base64")}`,
};
const activeBefore = await introspect(body.access_token, asIntrospector);
const before = activeBefore.status === 200 ? await activeBefore.json() : {};
if (before.active !== true || before.sub !== DID) {
	fail(`introspection before revocation: HTTP ${activeBefore.status} ${JSON.stringify(before)}, want active for ${DID}`);
	process.exit(1);
}
const asPublic = await introspect(body.access_token);
if (asPublic.status !== 401) {
	fail(`introspection by the public client returned HTTP ${asPublic.status}, want 401`);
	process.exit(1);
}
const revokeRes = await fetch(`${base}/oauth/revoke`, {
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ token: body.access_token, client_id: CLIENT_ID }),
	signal: AbortSignal.timeout(10_000),
});
if (revokeRes.status !== 200) {
	fail(`revocation returned HTTP ${revokeRes.status}, want 200 — body: ${await revokeRes.text()}`);
	process.exit(1);
}
const activeAfter = await introspect(body.access_token, asIntrospector);
const after = activeAfter.status === 200 ? await activeAfter.json() : {};
if (activeAfter.status !== 200 || after.active !== false) {
	fail(`introspection after revocation: HTTP ${activeAfter.status} ${JSON.stringify(after)}, want inactive`);
	process.exit(1);
}

console.log(
	`smoke-did-grant: OK — DID grant minted a Bearer token with the six signed claims on :${port} (tampered signature rejected with HTTP ${badRes.status}; introspected active, revoked, then inactive)`,
);
process.exit(0);
