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
import { BUILTIN_ALGORITHMS, createVerifier } from "../factory.mjs";
import { JwsVerifier } from "../jws.mjs";

describe("createVerifier", () => {
	it("returns Ed25519RawVerifier for ed25519_raw", async () => {
		const verifier = await createVerifier("ed25519_raw");
		expect(verifier).toBeInstanceOf(Ed25519RawVerifier);
	});

	it("returns JwsVerifier for ed25519_jws", async () => {
		const verifier = await createVerifier("ed25519_jws");
		expect(verifier).toBeInstanceOf(JwsVerifier);
	});

	it("returns JwsVerifier for es256_jws", async () => {
		const verifier = await createVerifier("es256_jws");
		expect(verifier).toBeInstanceOf(JwsVerifier);
	});

	it("returns JwsVerifier for es256k_jws", async () => {
		const verifier = await createVerifier("es256k_jws");
		expect(verifier).toBeInstanceOf(JwsVerifier);
	});

	it("returns Ed25519PrehashVerifier for ed25519_prehash", async () => {
		const verifier = await createVerifier("ed25519_prehash");
		expect(verifier).toBeInstanceOf(Ed25519PrehashVerifier);
	});

	it("refuses an algorithm it does not hold, naming the ones it does", async () => {
		await expect(createVerifier("rs256_jws")).rejects.toThrow(/Unsupported algorithm: "rs256_jws"/);
	});
});

describe("BUILTIN_ALGORITHMS", () => {
	it("names the five algorithms the grant always takes", () => {
		expect([...BUILTIN_ALGORITHMS.keys()].sort()).toEqual([
			"ed25519_jws",
			"ed25519_prehash",
			"ed25519_raw",
			"es256_jws",
			"es256k_jws",
		]);
	});
});
