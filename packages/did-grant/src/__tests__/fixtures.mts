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

import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { CompactSign } from "jose";
import type { DidDocument, Resolution } from "../contract.mjs";
import { AUDIENCE, clock } from "./harness.mjs";

/** A DID whose document holds one Ed25519 key, and the resolution a registry would answer. */
export interface DidKey {
	readonly did: string;
	readonly methodId: string;
	readonly privateKey: KeyObject;
	readonly document: DidDocument;
	readonly resolution: Resolution;
}

let serial = 0;

export function didKey(relationships: { authentication?: boolean; assertionMethod?: boolean } = {}): DidKey {
	const did = `did:dplaax:example:owner-${++serial}`;
	const methodId = `${did}#key-1`;
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
	const document: DidDocument = {
		id: did,
		verificationMethod: [
			{ id: methodId, type: "JsonWebKey2020", controller: did, publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x } },
		],
		...(relationships.authentication ? { authentication: [methodId] } : {}),
		...(relationships.assertionMethod ? { assertionMethod: [methodId] } : {}),
	};
	const canonicalBytes = new TextEncoder().encode(JSON.stringify(document));
	const digest = `sha256:${createHash("sha256").update(canonicalBytes).digest("hex")}`;
	return {
		did,
		methodId,
		privateKey,
		document,
		resolution: {
			document,
			canonicalBytes,
			digest,
			requestedDid: did,
			finalOrigin: "https://registry.example",
			snapshotRef: `registry:https://registry.example#${digest}`,
			retrievedAt: new Date(clock.at).toISOString(),
		},
	};
}

let nonces = 0;

/** The members of a LEGACY login message; each can be replaced or left out (undefined). */
export function legacyMessage(key: DidKey, over: Record<string, unknown> = {}): Record<string, unknown> {
	const message: Record<string, unknown> = {
		did: key.did,
		audience: AUDIENCE,
		timestamp: new Date(clock.at).toISOString(),
		nonce: `nonce-${++nonces}`,
		...over,
	};
	for (const [k, v] of Object.entries(message)) if (v === undefined) delete message[k];
	return message;
}

/** The parameters of an ed25519_raw request: the message as JSON, signed raw, the signature in base64. */
export function rawParams(key: DidKey, message: Record<string, unknown>, signer: KeyObject = key.privateKey) {
	const text = JSON.stringify(message);
	return { did: key.did, message: text, signature: sign(null, Buffer.from(text), signer).toString("base64") };
}

/** The parameters of an ed25519_jws request: the payload signed as a compact JWS. */
export async function jwsParams(
	key: DidKey,
	payload: Record<string, unknown>,
	header: Record<string, unknown> = { kid: key.methodId },
) {
	const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
		.setProtectedHeader({ alg: "EdDSA", ...header })
		.sign(key.privateKey);
	return { did: key.did, jws };
}
