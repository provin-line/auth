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
import { type DidKey, didKey, jwsParams, legacyMessage, rawParams } from "./fixtures.mjs";
import { AUDIENCE, clock, compose, ISSUER, minimalSection, stands, TOKEN_ENDPOINT } from "./harness.mjs";

/** The six claims rule auth.token.signed-claims asks of a DID token, for this key's resolution. */
const signedClaims = (key: DidKey, contract: string) => ({
	auth_contract_id: contract,
	verification_method: key.methodId,
	did_document_snapshot: key.resolution.digest,
	lifecycle_state_ref: key.resolution.snapshotRef,
	lifecycle_freshness_ref: key.resolution.retrievedAt,
	authorization_scope: "AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1",
});

async function registered(options: Parameters<typeof compose>[0] = {}, relationships = {}) {
	const s = stands();
	const key = didKey(relationships);
	s.answers.set(key.did, { kind: "resolved", resolution: key.resolution });
	return { key, ...(await compose({ ...options, stands: s })) };
}

const accessToken = (outcome: Awaited<ReturnType<Awaited<ReturnType<typeof compose>>["call"]>>) => {
	if (outcome.kind !== "issued") throw new Error(JSON.stringify(outcome));
	return String(outcome.body.access_token);
};

describe("did-grant signed claims (rule auth.token.signed-claims)", () => {
	it("adds the six claims under LEGACY_DID_LOGIN@1", async () => {
		const { key, call, verify } = await registered();
		const token = accessToken(await call(rawParams(key, legacyMessage(key))));
		expect(await verify(token)).toMatchObject({ grant: { claims: signedClaims(key, "LEGACY_DID_LOGIN@1") } });
	});

	it("names the OWNER contract and the method the transcript certified", async () => {
		const section = {
			...minimalSection,
			"auth-contract": "OWNER_AUTHENTICATION_LOGIN@1",
			"owner-migration-ratified": true,
			"supported-algorithms": ["ed25519_jws"],
		};
		const { key, call, verify } = await registered({ section }, { authentication: true });
		const payload = {
			transcript_version: "login-transcript-v1",
			domain_separation_tag: "dplaax-owner-login-v1",
			auth_contract_id: "OWNER_AUTHENTICATION_LOGIN@1",
			issuer: ISSUER,
			token_endpoint: TOKEN_ENDPOINT,
			audience: AUDIENCE,
			did: key.did,
			subject_did: key.did,
			verification_method: key.methodId,
			nonce: "claims-owner",
			timestamp: new Date(clock.at).toISOString(),
		};
		const token = accessToken(await call(await jwsParams(key, payload)));
		expect(await verify(token)).toMatchObject({
			grant: { claims: signedClaims(key, "OWNER_AUTHENTICATION_LOGIN@1") },
		});
	});

	it("signs them into the JWT payload, beside client_id and without azp", async () => {
		const { key, call, verify } = await registered({ realTokens: true });
		const token = accessToken(await call(rawParams(key, legacyMessage(key))));
		const [, body] = token.split(".");
		const payload = JSON.parse(Buffer.from(String(body), "base64url").toString("utf8")) as Record<string, unknown>;
		expect(payload).toMatchObject({ ...signedClaims(key, "LEGACY_DID_LOGIN@1"), sub: key.did, client_id: "app" });
		expect(payload).not.toHaveProperty("azp");
		expect(await verify(token)).toMatchObject({ kind: "valid", grant: { claims: signedClaims(key, "LEGACY_DID_LOGIN@1") } });
	});
});
