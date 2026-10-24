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

import { contract, extensionPoint } from "@o3co/auth-provider-foundation/kernel";
import type { Resolution } from "./resolver/types.mjs";
import type { SignatureVerifier } from "./verifiers/types.mjs";

export type { ExtractedKey } from "./resolver/extractKey.mjs";
export type { DidDocument, JsonWebKey, Resolution, VerificationMethod } from "./resolver/types.mjs";
export type {
	ParsedMessage,
	SignatureVerifier,
	VerificationContext,
	VerificationResult,
} from "./verifiers/types.mjs";

/**
 * Resolves the DID a grant request names to its document, with the
 * provenance of the bytes served. Rejected when the DID does not resolve to
 * a document the grant may use; the reason is shown to the client. Throws
 * Unavailable when it cannot tell, and the request is answered 503.
 */
export interface DidDocuments {
	resolve(
		did: string,
	): Promise<
		| { readonly kind: "resolved"; readonly resolution: Resolution }
		| { readonly kind: "rejected"; readonly reason: string }
	>;
}
export const didDocuments = contract<DidDocuments>("did-grant.did-documents");

/**
 * Where the nonces of the signed login messages already used are kept, by a
 * name derived from the nonce. Throws Unavailable when it cannot tell.
 */
export interface SpentNonces {
	/** Keeps the name for its lifetime, unless it is kept already. */
	save(name: string, lifetimeMs: number): Promise<"created" | "exists">;
}
export const spentNonces = contract<SpentNonces>("did-grant.spent-nonces");
/** A nonce whose use was lost could log in again, by whoever saw the signed message. */
export const spentNoncesNeeds = {
	neverEvicted: true,
	survivesCrash: true,
	survivesFailover: true,
} as const;

/** One signature algorithm a request may name, beside the ones the grant always takes. */
export interface SignatureAlgorithm {
	/** The name a request uses (`algorithm`), unique among the composed ones. */
	readonly algorithm: string;
	/** Creates the verifier, once, when a request first names the algorithm. */
	create(): Promise<SignatureVerifier>;
}
export const signatureAlgorithms = extensionPoint<SignatureAlgorithm>("did-grant.signature-algorithms", {
	multiplicity: "keyed",
	keyOf: (a) => a.algorithm,
});
