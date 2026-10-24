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

import { generateKeyPairSync } from "node:crypto";
import { isUnavailable } from "@o3co/auth-provider-foundation/kernel";
import { describe, expect, it } from "vitest";
import { didKey, jwsParams, legacyMessage, rawParams } from "./fixtures.mjs";
import { AUDIENCE, clock, compose, DID_GRANT_TYPE, ISSUER, stands } from "./harness.mjs";

/** A composition whose resolver knows one DID, with that DID's key. */
async function registered(options: Parameters<typeof compose>[0] = {}) {
	const s = options.stands ?? stands();
	const key = didKey();
	s.answers.set(key.did, { kind: "resolved", resolution: key.resolution });
	return { key, ...(await compose({ ...options, stands: s })) };
}

describe("did-grant LEGACY_DID_LOGIN@1 (ed25519_raw)", () => {
	it("issues an access token for the DID that signed the message, to the audience it signed", async () => {
		const { key, call, verify } = await registered();
		const outcome = await call(rawParams(key, legacyMessage(key)));
		expect(outcome).toMatchObject({ kind: "issued", body: { token_type: "Bearer", expires_in: 600 } });
		if (outcome.kind !== "issued") return;
		expect(outcome.body).not.toHaveProperty("scope");
		const checked = await verify(String(outcome.body.access_token));
		expect(checked).toMatchObject({
			kind: "valid",
			grant: { subject: key.did, issuedTo: "app", audience: [AUDIENCE], scope: [] },
		});
		if (checked.kind === "valid") expect(checked.expiresAt).toBe(clock.at + 600_000);
	});

	it("takes the same parameters in a JSON body", async () => {
		const { key, callJson } = await registered();
		await expect(callJson(rawParams(key, legacyMessage(key)))).resolves.toMatchObject({ kind: "issued" });
	});

	it("issues to the client's first allowed audience when the message names none", async () => {
		const { key, call, verify } = await registered();
		const outcome = await call(rawParams(key, legacyMessage(key, { audience: undefined })));
		if (outcome.kind !== "issued") throw new Error(JSON.stringify(outcome));
		expect(await verify(String(outcome.body.access_token))).toMatchObject({ grant: { audience: [AUDIENCE] } });
	});

	it("issues to the issuer when the message names no audience and the client is allowed none", async () => {
		const allowances = { grants: [DID_GRANT_TYPE], scopes: [], "default-scopes": [], audiences: [] };
		const { key, call, verify } = await registered({ allowances });
		const outcome = await call(rawParams(key, legacyMessage(key, { audience: undefined })));
		if (outcome.kind !== "issued") throw new Error(JSON.stringify(outcome));
		expect(await verify(String(outcome.body.access_token))).toMatchObject({ grant: { audience: [ISSUER] } });
	});

	it("refuses an audience the client is not allowed", async () => {
		const { key, call } = await registered();
		const outcome = await call(rawParams(key, legacyMessage(key, { audience: "https://other.example" })));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("issues the scope asked within the client's allowance, and names it in the answer", async () => {
		const { key, call, verify } = await registered();
		const outcome = await call({ ...rawParams(key, legacyMessage(key)), scope: "read" });
		if (outcome.kind !== "issued") throw new Error(JSON.stringify(outcome));
		expect(outcome.body.scope).toBe("read");
		expect(await verify(String(outcome.body.access_token))).toMatchObject({ grant: { scope: ["read"] } });
	});

	it("issues the client's default scopes when none is asked", async () => {
		const allowances = { grants: [DID_GRANT_TYPE], scopes: ["read"], "default-scopes": ["read"], audiences: [AUDIENCE] };
		const { key, call } = await registered({ allowances });
		await expect(call(rawParams(key, legacyMessage(key)))).resolves.toMatchObject({
			kind: "issued",
			body: { scope: "read" },
		});
	});

	it("refuses a scope outside the client's allowance", async () => {
		const { key, call } = await registered();
		const outcome = await call({ ...rawParams(key, legacyMessage(key)), scope: "write" });
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_scope" });
	});

	it("refuses a message whose nonce was used, kept until the message's window closes", async () => {
		const { key, call, stands: s } = await registered();
		const params = rawParams(key, legacyMessage(key, { nonce: "once" }));
		await expect(call(params)).resolves.toMatchObject({ kind: "issued" });
		await expect(call(params)).resolves.toMatchObject({ kind: "error", error: "invalid_request" });
		// The message's window (5m) and the allowance for a store clock behind ours (1m).
		expect([...s.spent.values()]).toEqual([clock.at + 360_000]);
	});

	it("refuses a message whose timestamp is further from the clock than message-max-age", async () => {
		const { key, call } = await registered();
		const stale = new Date(clock.at - 301_000).toISOString();
		const outcome = await call(rawParams(key, legacyMessage(key, { timestamp: stale })));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("refuses a message without a nonce", async () => {
		const { key, call } = await registered();
		const outcome = await call(rawParams(key, legacyMessage(key, { nonce: undefined })));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("answers a signature by another key with 400 invalid_grant, never a client-authentication 401", async () => {
		const { key, call } = await registered();
		const stranger = generateKeyPairSync("ed25519").privateKey;
		const outcome = await call(rawParams(key, legacyMessage(key), stranger));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_grant" });
		if (outcome.kind === "error") expect(outcome.status ?? 400).toBe(400);
	});

	it("refuses a request without did", async () => {
		const { key, call } = await registered();
		const { did: _, ...params } = rawParams(key, legacyMessage(key));
		await expect(call(params)).resolves.toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("refuses an algorithm the section does not support", async () => {
		const { key, call } = await registered();
		const outcome = await call(await jwsParams(key, legacyMessage(key)));
		expect(outcome).toMatchObject({ kind: "error", error: "invalid_request" });
	});

	it("answers a DID the resolver rejects with invalid_grant and the resolver's reason", async () => {
		const s = stands();
		const { key, call } = await registered({ stands: s });
		s.answers.set(key.did, { kind: "rejected", reason: "DID is revoked" });
		await expect(call(rawParams(key, legacyMessage(key)))).resolves.toMatchObject({
			kind: "error",
			error: "invalid_grant",
			description: "DID is revoked",
		});
	});

	it("throws Unavailable when the resolver cannot tell, which the endpoint answers 503", async () => {
		const s = stands();
		const { key, call } = await registered({ stands: s });
		s.answers.set(key.did, "unavailable");
		await expect(call(rawParams(key, legacyMessage(key)))).rejects.toSatisfy(isUnavailable);
	});

	it("throws Unavailable when the nonce store cannot tell", async () => {
		const s = stands();
		const { key, call } = await registered({ stands: s });
		s.nonceStoreDown = true;
		await expect(call(rawParams(key, legacyMessage(key)))).rejects.toSatisfy(isUnavailable);
	});

	it("issues tokens that live access-token-lifetime", async () => {
		const section = { "revocation-latency-bound": "15m", "access-token-lifetime": "90s" };
		const { key, call } = await registered({ section });
		await expect(call(rawParams(key, legacyMessage(key)))).resolves.toMatchObject({
			kind: "issued",
			body: { expires_in: 90 },
		});
	});
});
