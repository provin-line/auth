/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// This module wires the DID grant's ed25519_raw signature verifier (from
// @provin-line/auth-provider-did), which declares @noble/ed25519 only as an
// OPTIONAL peerDependency — so it is NOT pulled into a consumer install
// transitively. This module is the one that turns that verifier ON, so it must
// declare @noble/ed25519 as a real runtime dependency; otherwise a generated
// auth.provider boots (the scaffold smoke only hits /_healthcheck) but the DID
// grant throws "signature verification error" at request time because the noble
// import fails. Regression pin: keep it in `dependencies`.
//
// Discovered by the provin.oss deploy/quickstart real-provider e2e (a scaffolded
// instance's DID grant failed for exactly this reason).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
	readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { dependencies?: Record<string, string> };

describe("auth-provider-dplaax-module runtime dependencies", () => {
	it("declares @noble/ed25519 so the ed25519_raw DID grant resolves it in a consumer install", () => {
		expect(
			pkg.dependencies?.["@noble/ed25519"],
			"@noble/ed25519 must be a runtime dependency — auth-provider-did declares it only as an optional peer, so a scaffolded instance won't get it otherwise and the DID grant fails at runtime",
		).toBeTruthy();
	});
});
