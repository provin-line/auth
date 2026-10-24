/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from "vitest";
import { type DidKey, didKey, jwsParams } from "./fixtures.mjs";
import { AUDIENCE, clock, compose, ISSUER, minimalSection, stands, TOKEN_ENDPOINT } from "./harness.mjs";

const ownerSection = {
	...minimalSection,
	"auth-contract": "OWNER_AUTHENTICATION_LOGIN@1",
	"owner-migration-ratified": true,
	"supported-algorithms": ["ed25519_jws"],
};

let nonces = 0;

/** A login transcript (login-transcript-v1) for the key's DID; each member can be replaced. */
function transcript(key: DidKey, over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		transcript_version: "login-transcript-v1",
		domain_separation_tag: "dplaax-owner-login-v1",
		auth_contract_id: "OWNER_AUTHENTICATION_LOGIN@1",
		issuer: ISSUER,
		token_endpoint: TOKEN_ENDPOINT,
		audience: AUDIENCE,
		did: key.did,
		subject_did: key.did,
		verification_method: key.methodId,
		nonce: `owner-nonce-${++nonces}`,
		timestamp: new Date(clock.at).toISOString(),
		...over,
	};
}

/** A composition whose resolver knows one DID, its key listed under authentication unless told not to. */
async function registered(authentication = true) {
	const s = stands();
	const key = didKey({ authentication });
	s.answers.set(key.did, { kind: "resolved", resolution: key.resolution });
	return { key, ...(await compose({ section: ownerSection, stands: s })) };
}

describe("did-grant OWNER_AUTHENTICATION_LOGIN@1 (ed25519_jws)", () => {
	it("issues for a transcript naming this issuer, token endpoint, an allowed audience and the signing key", async () => {
		const { key, call, verify } = await registered();
		const outcome = await call(await jwsParams(key, transcript(key)));
		if (outcome.kind !== "issued") throw new Error(JSON.stringify(outcome));
		expect(await verify(String(outcome.body.access_token))).toMatchObject({
			grant: { subject: key.did, audience: [AUDIENCE] },
		});
	});

	it.each([
		["issuer", { issuer: "https://other-as.example" }],
		["token_endpoint", { token_endpoint: "https://other-as.example/oauth/token" }],
		["audience", { audience: "https://other-rs.example" }],
		["auth_contract_id", { auth_contract_id: "OWNER_ASSERTION_CONTROL_LOGIN@1" }],
		["subject_did", { subject_did: "did:dplaax:example:someone-else" }],
	])("refuses a transcript whose %s is not this deployment's, without spending its nonce", async (_, over) => {
		const { key, call, stands: s } = await registered();
		const outcome = await call(await jwsParams(key, transcript(key, over)));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_grant" });
		expect(s.spent.size).toBe(0);
	});

	it("refuses a transcript used once already", async () => {
		const { key, call } = await registered();
		const params = await jwsParams(key, transcript(key));
		await expect(call(params)).resolves.toMatchObject({ kind: "issued" });
		await expect(call(params)).resolves.toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("refuses a transcript stamped further from the clock than message-max-age", async () => {
		const { key, call } = await registered();
		const stale = new Date(clock.at - 301_000).toISOString();
		const outcome = await call(await jwsParams(key, transcript(key, { timestamp: stale })));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("refuses a header kid that names another method than the transcript", async () => {
		const { key, call } = await registered();
		const outcome = await call(await jwsParams(key, transcript(key), { kid: `${key.did}#key-2` }));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_grant" });
	});

	it("refuses a key the document does not list under the contract's relationship", async () => {
		const { key, call } = await registered(false);
		const outcome = await call(await jwsParams(key, transcript(key)));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_grant" });
	});

	it("refuses a LEGACY-shaped message, which carries no transcript", async () => {
		const { key, call } = await registered();
		const legacy = { did: key.did, audience: AUDIENCE, nonce: "n", timestamp: new Date(clock.at).toISOString() };
		const outcome = await call(await jwsParams(key, legacy));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_grant" });
	});
});

describe("did-grant OWNER_ASSERTION_CONTROL_LOGIN@1 (ed25519_jws)", () => {
	const assertionSection = { ...ownerSection, "auth-contract": "OWNER_ASSERTION_CONTROL_LOGIN@1" };

	it.each([
		["issues for a key listed under assertionMethod", { assertionMethod: true }, "issued"],
		["refuses a key listed under authentication alone", { authentication: true }, "error"],
	] as const)("%s", async (_, relationships, kind) => {
		const s = stands();
		const key = didKey(relationships);
		s.answers.set(key.did, { kind: "resolved", resolution: key.resolution });
		const { call } = await compose({ section: assertionSection, stands: s });
		const payload = transcript(key, { auth_contract_id: "OWNER_ASSERTION_CONTROL_LOGIN@1" });
		await expect(call(await jwsParams(key, payload))).resolves.toMatchObject({ kind });
	});
});
