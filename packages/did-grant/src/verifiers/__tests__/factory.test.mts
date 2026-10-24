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
import { Ed25519PrehashVerifier } from "../ed25519Prehash.mjs";
import { Ed25519RawVerifier } from "../ed25519Raw.mjs";
import { BUILTIN_ALGORITHMS } from "../factory.mjs";
import { JwsVerifier } from "../jws.mjs";

const made = (name: string) => {
	const algorithm = BUILTIN_ALGORITHMS.get(name);
	if (!algorithm) throw new Error(`no built-in ${name}`);
	return algorithm.create();
};

describe("BUILTIN_ALGORITHMS", () => {
	it("names the four algorithms the grant always takes", () => {
		expect([...BUILTIN_ALGORITHMS.keys()].sort()).toEqual(["ed25519_jws", "ed25519_prehash", "ed25519_raw", "es256_jws"]);
	});

	it.each([
		["ed25519_raw", Ed25519RawVerifier],
		["ed25519_prehash", Ed25519PrehashVerifier],
		["ed25519_jws", JwsVerifier],
		["es256_jws", JwsVerifier],
	] as const)("makes %s's verifier", async (name, kind) => {
		expect(await made(name)).toBeInstanceOf(kind);
	});

	it("marks the JWS algorithms, and those alone, as carrying a protected header", () => {
		const bearing = [...BUILTIN_ALGORITHMS].filter(([, a]) => a.headerBearing).map(([name]) => name);
		expect(bearing.sort()).toEqual(["ed25519_jws", "es256_jws"]);
	});
});
