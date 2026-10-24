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
import { Ed25519PrehashVerifier } from "./ed25519Prehash.mjs";
import { Ed25519RawVerifier } from "./ed25519Raw.mjs";
import { JwsVerifier } from "./jws.mjs";
import type { SignatureVerifier } from "./types.mjs";

/** One algorithm the grant always takes. */
export interface BuiltinAlgorithm {
	/** Makes the verifier, once, at boot. */
	readonly create: () => Promise<SignatureVerifier>;
	/**
	 * Whether its envelope carries a JWS protected header, the only place a
	 * `kid` can come from: an OWNER contract's three-way kid match (rule
	 * `auth.grant.kid-match`) needs one.
	 */
	readonly headerBearing: boolean;
}

/**
 * Makes a verifier that needs the optional peer `@noble/ed25519`, and tells
 * the operator how to get it when it is missing.
 */
async function withNoble(algorithm: string, load: () => Promise<SignatureVerifier>): Promise<SignatureVerifier> {
	try {
		return await load();
	} catch (err) {
		const code =
			typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
		const message = err instanceof Error ? err.message : String(err);
		if ((code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") && message.includes("@noble/ed25519")) {
			throw new Error(
				`${algorithm} requires the @noble/ed25519 package: install it, or use a JWS algorithm (ed25519_jws, es256_jws)`,
			);
		}
		throw err;
	}
}

/**
 * The algorithms the grant always takes, by the name a request uses.
 * `es256k_jws` is not among them: jose does not verify ES256K on Node, so a
 * deployment that needs it contributes a verifier at `signatureAlgorithms`.
 */
export const BUILTIN_ALGORITHMS: ReadonlyMap<string, BuiltinAlgorithm> = new Map<string, BuiltinAlgorithm>([
	["ed25519_raw", { create: () => withNoble("ed25519_raw", () => Ed25519RawVerifier.load()), headerBearing: false }],
	[
		"ed25519_prehash",
		{ create: () => withNoble("ed25519_prehash", () => Ed25519PrehashVerifier.load()), headerBearing: false },
	],
	["ed25519_jws", { create: async () => new JwsVerifier("EdDSA"), headerBearing: true }],
	["es256_jws", { create: async () => new JwsVerifier("ES256"), headerBearing: true }],
]);
