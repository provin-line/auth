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
import { JwsVerifier } from "./jws.mjs";
import type { SignatureVerifier } from "./types.mjs";

/** Creates the verifier of one algorithm, once, when a request first names it. */
export type VerifierFactory = () => Promise<SignatureVerifier>;

const JWS_ALG_MAP = {
	ed25519_jws: "EdDSA",
	es256_jws: "ES256",
	es256k_jws: "ES256K",
} as const;

/**
 * Loads a verifier that needs the optional peer `@noble/ed25519`, and tells
 * the operator how to get it when it is missing.
 */
async function withNoble(
	algorithm: string,
	load: () => Promise<SignatureVerifier>,
): Promise<SignatureVerifier> {
	try {
		return await load();
	} catch (err) {
		const code =
			typeof err === "object" && err !== null && "code" in err
				? (err as { code: unknown }).code
				: undefined;
		const message = err instanceof Error ? err.message : String(err);
		if (
			(code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
			message.includes("@noble/ed25519")
		) {
			throw new Error(
				`${algorithm} algorithm requires @noble/ed25519 package. ` +
					"Install @noble/ed25519 with your package manager (npm/pnpm/yarn) — or switch to a JWS algorithm (ed25519_jws, es256_jws, es256k_jws).",
			);
		}
		throw err;
	}
}

/** The algorithms the grant always takes, by the name a request uses. */
export const BUILTIN_ALGORITHMS: ReadonlyMap<string, VerifierFactory> = new Map<string, VerifierFactory>([
	[
		"ed25519_raw",
		() =>
			withNoble("ed25519_raw", async () => {
				const { Ed25519RawVerifier } = await import("./ed25519Raw.mjs");
				return new Ed25519RawVerifier();
			}),
	],
	[
		"ed25519_prehash",
		() =>
			withNoble("ed25519_prehash", async () => {
				const { Ed25519PrehashVerifier } = await import("./ed25519Prehash.mjs");
				return new Ed25519PrehashVerifier();
			}),
	],
	["ed25519_jws", async () => new JwsVerifier(JWS_ALG_MAP.ed25519_jws)],
	["es256_jws", async () => new JwsVerifier(JWS_ALG_MAP.es256_jws)],
	["es256k_jws", async () => new JwsVerifier(JWS_ALG_MAP.es256k_jws)],
]);

export async function createVerifier(algorithm: string): Promise<SignatureVerifier> {
	const factory = BUILTIN_ALGORITHMS.get(algorithm);
	if (!factory) {
		throw new Error(
			`Unsupported algorithm: "${algorithm}". Supported: ${[...BUILTIN_ALGORITHMS.keys()].join(", ")}`,
		);
	}
	return factory();
}
