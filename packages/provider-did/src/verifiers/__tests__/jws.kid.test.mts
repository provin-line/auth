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
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import type { ExtractedKey } from "../../resolver/extractKey.mjs";
import { JwsVerifier } from "../jws.mjs";

/**
 * Helper: create a signed JWS for a DID message using a real key pair,
 * with control over the protected header (for `kid`) and payload
 * (for `verification_method`).
 */
async function createSignedJws(
	did: string,
	options: {
		headerKid?: string;
		verificationMethod?: string;
	} = {},
): Promise<{ jws: string; resolvedKey: ExtractedKey }> {
	const { privateKey, publicKey } = await generateKeyPair("EdDSA");
	const jwk = await exportJWK(publicKey);

	const payload = JSON.stringify({
		did,
		timestamp: new Date().toISOString(),
		nonce: crypto.randomUUID(),
		...(options.verificationMethod ? { verification_method: options.verificationMethod } : {}),
	});

	const header: { alg: "EdDSA"; kid?: string } = { alg: "EdDSA" };
	if (options.headerKid) {
		header.kid = options.headerKid;
	}

	const jws = await new CompactSign(new TextEncoder().encode(payload))
		.setProtectedHeader(header)
		.sign(privateKey);

	return {
		jws,
		resolvedKey: { format: "jwk", key: jwk, id: `${did}#key-1` },
	};
}

describe("JwsVerifier — kid surfacing", () => {
	const did = "did:dplaax:u:alice";
	const methodId = "did:dplaax:u:alice#key-1";

	it("surfaces headerKid and verificationMethod on ParsedMessage when present", async () => {
		const verifier = new JwsVerifier("EdDSA");
		const { jws, resolvedKey } = await createSignedJws(did, {
			headerKid: methodId,
			verificationMethod: methodId,
		});

		const result = await verifier.verify({
			body: { jws },
			did,
			resolvedKey,
		});

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.parsedMessage.headerKid).toBe(methodId);
			expect(result.parsedMessage.verificationMethod).toBe(methodId);
		}
	});

	it("yields headerKid: undefined and does not throw when the header has no kid", async () => {
		const verifier = new JwsVerifier("EdDSA");
		const { jws, resolvedKey } = await createSignedJws(did, {
			verificationMethod: methodId,
		});

		const result = await verifier.verify({
			body: { jws },
			did,
			resolvedKey,
		});

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.parsedMessage.headerKid).toBeUndefined();
			expect(result.parsedMessage.verificationMethod).toBe(methodId);
		}
	});
});
