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
import { selectVerificationMethod } from "./selectMethod.mjs";
import type { DidDocument, JsonWebKey } from "./types.mjs";

export type ExtractedKey =
	| { format: "jwk"; key: JsonWebKey; id: string }
	| { format: "multibase"; key: string; id: string };

/**
 * @deprecated One-line delegate to the LEGACY branch of
 * `selectVerificationMethod` (called without `methodId`) — kept for
 * existing callers. Selection is now fail-closed: it inherits
 * `selectVerificationMethod`'s duplicate-id rejection and its
 * `ambiguous-legacy-selection` reason when more than one verificationMethod
 * has a matching `controller`, replacing the old array-order first-match.
 * New callers should use `selectVerificationMethod` directly so they can
 * pass `methodId`/`relationship`.
 *
 * Extract a verification key from a DID Document for the given DID.
 *
 * @throws {MethodSelectionError} if no controller-matched verificationMethod
 *         is found, more than one is found, or the document has a duplicate
 *         verificationMethod id — see `selectVerificationMethod`.
 * @throws if the selected method has no key material.
 */
export async function extractVerificationKey(doc: DidDocument, did: string): Promise<ExtractedKey> {
	const { id, method } = selectVerificationMethod(doc, { did });

	if (method.publicKeyJwk !== undefined) {
		return { format: "jwk", key: method.publicKeyJwk, id };
	}

	if (method.publicKeyMultibase !== undefined) {
		return { format: "multibase", key: method.publicKeyMultibase, id };
	}

	throw new Error(
		`verificationMethod ${id} has no key material (publicKeyJwk or publicKeyMultibase)`,
	);
}
