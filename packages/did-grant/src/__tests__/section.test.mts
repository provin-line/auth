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
import { signatureAlgorithms } from "../contract.mjs";
import { compose, minimalSection } from "./harness.mjs";

/** The places a refused boot names, or a failure when it boots. */
async function refusedAt(boot: Promise<unknown>): Promise<string[]> {
	try {
		await boot;
	} catch (err) {
		if (BootRefused.is(err)) return err.refusals.map((r) => r.where);
		throw err;
	}
	throw new Error("booted");
}

const owner = {
	...minimalSection,
	"auth-contract": "OWNER_AUTHENTICATION_LOGIN@1",
	"owner-migration-ratified": true,
	"supported-algorithms": ["ed25519_jws"],
};

const customAlgorithm = (algorithm: string) =>
	defineModule({ name: `algorithm-${algorithm}` }, (m) => [
		m.contribute(signatureAlgorithms).by(() => ({
			algorithm,
			create: async () => ({ verify: async () => ({ valid: false, error: "invalid_grant", errorDescription: "no" }) }),
		})),
	]);

describe("did-grant section", () => {
	it("boots on a LEGACY section naming the two lifetimes alone", async () => {
		await expect(compose({ section: minimalSection })).resolves.toBeDefined();
	});

	it.each([
		["revocation-latency-bound", { "access-token-lifetime": "10m" }],
		["access-token-lifetime", { "revocation-latency-bound": "15m" }],
	])("refuses a section without %s, which has no default", async (key, section) => {
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining(key)]);
	});

	it("refuses an access-token lifetime above the revocation latency bound", async () => {
		const section = { "revocation-latency-bound": "5m", "access-token-lifetime": "10m" };
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining("access-token-lifetime")]);
	});

	it("refuses a LEGACY access-token lifetime above legacy-max-ttl", async () => {
		const section = { "revocation-latency-bound": "1h", "access-token-lifetime": "20m" };
		expect(await refusedAt(compose({ section }))).toEqual([expect.stringContaining("access-token-lifetime")]);
	});

	it("takes an OWNER lifetime above legacy-max-ttl, which bounds LEGACY alone", async () => {
		const section = { ...owner, "revocation-latency-bound": "1h", "access-token-lifetime": "20m" };
		await expect(compose({ section })).resolves.toBeDefined();
	});

	it("refuses a lifetime above a day", async () => {
		const section = { "revocation-latency-bound": "2d", "access-token-lifetime": "25h" };
		expect(await refusedAt(compose({ section }))).toContainEqual(expect.stringContaining("access-token-lifetime"));
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
});
