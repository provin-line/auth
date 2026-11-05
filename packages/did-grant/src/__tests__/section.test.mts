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

import { BootRefused, defineModule } from "@o3co/auth-provider-foundation/kernel";
import { describe, expect, it } from "vitest";
import { type SignatureVerifier, signatureAlgorithms } from "../contract.mjs";
import { compose, minimalSection } from "./harness.mjs";

/** The refusals of a refused boot, or a failure when it boots. */
async function refusalsOf(boot: Promise<unknown>): Promise<{ where: string; reason: string }[]> {
	try {
		await boot;
	} catch (err) {
		if (BootRefused.is(err)) return err.refusals.map(({ where, reason }) => ({ where, reason }));
		throw err;
	}
	throw new Error("booted");
}

/** The places a refused boot names, or a failure when it boots. */
async function refusedAt(boot: Promise<unknown>): Promise<string[]> {
	return (await refusalsOf(boot)).map((r) => r.where);
}

const owner = {
	...minimalSection,
	"auth-contract": "OWNER_AUTHENTICATION_LOGIN@1",
	"owner-migration-ratified": true,
	"supported-algorithms": ["ed25519_jws"],
};

const refusing: SignatureVerifier = {
	verify: async () => ({ valid: false, error: "invalid_grant", errorDescription: "no" }),
};

const customAlgorithm = (
	algorithm: string,
	options: { headerBearing?: true; create?: () => Promise<SignatureVerifier> } = {},
) =>
	defineModule({ name: `algorithm-${algorithm}`, replicaSafe: true, takes: [] }, (m) => [
		m.contribute(signatureAlgorithms).by(() => ({
			algorithm,
			create: options.create ?? (async () => refusing),
			...(options.headerBearing ? { headerBearing: true as const } : {}),
		})),
	]);

describe("did-grant section", () => {
	it("boots on a LEGACY section naming the revocation latency bound alone", async () => {
		await expect(compose({ section: minimalSection })).resolves.toBeDefined();
	});

	it("refuses a section without revocation-latency-bound, which has no default", async () => {
		expect(await refusedAt(compose({ section: {} }))).toEqual([expect.stringContaining("revocation-latency-bound")]);
	});

	it("refuses access-token-lifetime as a key the section does not hold, tokens.access-token-lifetime setting it", async () => {
		const section = { ...minimalSection, "access-token-lifetime": "10m" };
		expect(await refusalsOf(compose({ section }))).toEqual([
			{ where: "did-grant", reason: expect.stringContaining('Unrecognized key: "access-token-lifetime"') },
		]);
	});

	it("takes a tokens lifetime equal to the revocation latency bound", async () => {
		await expect(compose({ section: { "revocation-latency-bound": "10m" }, lifetimeSeconds: 600 })).resolves.toBeDefined();
	});

	it("refuses a tokens lifetime above the revocation latency bound, naming both settings by key", async () => {
		const refusals = await refusalsOf(compose({ section: { "revocation-latency-bound": "5m" }, lifetimeSeconds: 600 }));
		expect(refusals).toEqual([
			{
				where: "did-grant.revocation-latency-bound",
				reason: "tokens.access-token-lifetime is over it: lower that, or raise this (rule auth.token.lifetime-bound)",
			},
		]);
	});

	it("refuses a LEGACY tokens lifetime above legacy-max-ttl", async () => {
		const refusals = await refusalsOf(compose({ section: { "revocation-latency-bound": "1h" }, lifetimeSeconds: 1200 }));
		expect(refusals).toEqual([
			{
				where: "did-grant.legacy-max-ttl",
				reason:
					"tokens.access-token-lifetime is over it under LEGACY_DID_LOGIN@1: lower that, or raise this (rule auth.legacy.did-login)",
			},
		]);
	});

	it("takes a LEGACY tokens lifetime equal to legacy-max-ttl", async () => {
		await expect(compose({ section: { "revocation-latency-bound": "1h" }, lifetimeSeconds: 900 })).resolves.toBeDefined();
	});

	it("refuses LEGACY on tokens' own default lifetime, an hour, over the default legacy-max-ttl", async () => {
		const boot = compose({ section: { "revocation-latency-bound": "1h" }, lifetimeSeconds: null, realTokens: true });
		expect(await refusedAt(boot)).toEqual(["did-grant.legacy-max-ttl"]);
	});

	it("takes an OWNER tokens lifetime above legacy-max-ttl, which bounds LEGACY alone", async () => {
		const section = { ...owner, "revocation-latency-bound": "1h" };
		await expect(compose({ section, lifetimeSeconds: 1200 })).resolves.toBeDefined();
	});

	it("refuses an OWNER contract the operator has not ratified", async () => {
		const section = { ...owner, "owner-migration-ratified": false };
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining("owner-migration-ratified")]);
	});

	it("refuses an OWNER contract with an algorithm that has no protected header", async () => {
		const section = { ...owner, "supported-algorithms": ["ed25519_jws", "ed25519_raw"] };
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining("supported-algorithms")]);
	});

	it("refuses an OWNER contract where the token endpoint has no public location", async () => {
		expect(await refusedAt(compose({ section: owner, location: null }))).toEqual([
			expect.stringContaining("did-grant"),
		]);
	});

	it("boots an OWNER contract with a header-bearing algorithm and a located token endpoint", async () => {
		await expect(compose({ section: owner })).resolves.toBeDefined();
	});

	it("refuses an algorithm neither built in nor contributed", async () => {
		const section = { ...minimalSection, "supported-algorithms": ["rs256_jws"] };
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining("supported-algorithms")]);
	});

	it("takes an algorithm another module contributes", async () => {
		const section = { ...minimalSection, "supported-algorithms": ["custom_sig"] };
		await expect(compose({ section, extra: [customAlgorithm("custom_sig")] })).resolves.toBeDefined();
	});

	it("refuses a contributed algorithm that takes a built-in name", async () => {
		expect(await refusedAt(compose({ extra: [customAlgorithm("ed25519_raw")] }))).toEqual([
			expect.stringContaining("did-grant"),
		]);
	});

	it("refuses a key the section does not hold", async () => {
		const section = { ...minimalSection, "allowed-audiences": ["https://rs.example"] };
		expect(await refusedAt(compose({ section }))).toContainEqual(expect.stringContaining("did-grant"));
	});

	it("refuses es256k_jws, which no built-in verifier can check", async () => {
		const section = { ...minimalSection, "supported-algorithms": ["es256k_jws"] };
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining("supported-algorithms")]);
	});

	it("refuses boot when a configured algorithm's verifier cannot be made", async () => {
		const broken = customAlgorithm("broken_sig", {
			create: async () => {
				throw new Error("no key material");
			},
		});
		const section = { ...minimalSection, "supported-algorithms": ["broken_sig"] };
		expect(await refusedAt(compose({ section, extra: [broken] }))).toEqual([
			expect.stringContaining("supported-algorithms"),
		]);
	});

	it("boots an OWNER contract on a contributed algorithm that carries a JWS header", async () => {
		const section = { ...owner, "supported-algorithms": ["custom_jws"] };
		const extra = [customAlgorithm("custom_jws", { headerBearing: true })];
		await expect(compose({ section, extra })).resolves.toBeDefined();
	});

	it("refuses an OWNER contract on a contributed algorithm that does not say it carries one", async () => {
		const section = { ...owner, "supported-algorithms": ["custom_sig"] };
		expect(await refusedAt(compose({ section, extra: [customAlgorithm("custom_sig")] }))).toEqual([
			expect.stringContaining("supported-algorithms"),
		]);
	});
});
