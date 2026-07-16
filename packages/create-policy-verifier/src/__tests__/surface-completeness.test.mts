/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The generated policy-verifier's DefaultDenyRuleCollector `surface` is the
// deployment's declared L1 request surface: any (resource, action) not in it
// is denied unconditionally (see application.conf.tmpl SECURITY NOTE). It must
// therefore cover EVERY L1-gated request the provin.oss network node makes,
// or that request is deny-all'd at the PDP and the node cannot serve it.
//
// The source of truth for that set is provin.oss:
//   - the o3co.authz.v1.policy method options in
//     api/protobuf/dplaax/**/v1/*.proto, and
//   - the one HTTP-only PEP call not carried by a proto option:
//     cmd/standalone/push.go — verifier.Verify(ctx, "ingest", "push").
//
// This test pins that the scaffold's declared surface is a SUPERSET of that
// set, so a missing pair — which otherwise breaks a real deployment only at
// request time — fails CI at build time instead. It reads the template source
// directly (the surface lines carry no `__TOKEN__`, so generation copies them
// byte-for-byte; token-invariants.test.mts pins that). It is a literal pin;
// the mechanical proto<->snapshot guard on the provin.oss side is
// network/pkg/auth/surface_guard_test.go (TestPDPSurfaceSnapshot), whose
// testdata/pdp-surface.snapshot mirrors this list — the two pins bracket the
// cross-repo contract from both ends. Adding a new L1 RPC means
// adding its pair to provin.oss AND to application.conf.tmpl AND here, by
// design: the coupling is the point.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONF_TMPL = fileURLToPath(
	new URL("../template/config/application.conf.tmpl", import.meta.url),
);

// The complete L1 request surface the provin.oss node enforces (SoT above).
const EXPECTED_SURFACE: ReadonlyArray<readonly [string, string]> = [
	["schemas", "register"],
	["schemas", "read"],
	["schemas", "deprecate"],
	["dids", "register"],
	["dids", "issue"],
	["dids", "read"],
	["dids", "revoke"],
	["signer", "sign-vc"],
	["signer", "sign-wire"],
	["vc", "store"],
	["vc", "read"],
	["chain", "subscribe"],
	["chain", "unsubscribe"],
	["chain", "read"],
	["chain", "update-allowlist"],
	["chain", "read-allowlist"],
	["audit", "read"],
	["tlog", "read"],
	["ingest", "push"],
];

// Matches one surface entry `{ resource = "R", action = "A" }`, tying resource
// and action together on the same entry (a bare `"tlog"` and a stray `"read"`
// elsewhere must not satisfy the pair). Tolerant of whitespace only.
function entryRe(resource: string, action: string): RegExp {
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`\\{\\s*resource\\s*=\\s*"${esc(resource)}"\\s*,\\s*action\\s*=\\s*"${esc(action)}"\\s*\\}`,
	);
}

describe("generated policy-verifier DefaultDenyRuleCollector surface", () => {
	it.each(EXPECTED_SURFACE)(
		"declares the L1 pair (%s, %s) so the node's RPC is not deny-all'd at the PDP",
		async (resource, action) => {
			const conf = await readFile(CONF_TMPL, "utf8");
			expect(
				entryRe(resource, action).test(conf),
				`application.conf.tmpl surface is missing { resource = "${resource}", action = "${action}" } — the provin.oss node calls it but the generated policy-verifier would deny it`,
			).toBe(true);
		},
	);
});
