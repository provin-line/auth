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
// Minimal subset of the Web Crypto API JsonWebKey interface (public key fields only).
// Defined locally to avoid a DOM lib dependency in this Node.js package.
export interface JsonWebKey {
	kty?: string;
	crv?: string;
	x?: string;
	y?: string;
}

export interface VerificationMethod {
	id: string;
	type: string;
	controller: string;
	publicKeyJwk?: JsonWebKey;
	publicKeyMultibase?: string;
}

export interface DidDocument {
	id: string;
	verificationMethod?: VerificationMethod[];
	authentication?: unknown[];
	assertionMethod?: unknown[];
	// Unknown members are preserved rather than stripped (auth.resolve.unknown-member):
	// a resolver must not silently drop DID Document fields it doesn't model yet.
	[k: string]: unknown;
}

/**
 * The full outcome of resolving a DID: the parsed document plus enough
 * provenance to prove — later, to a third party — exactly which bytes were
 * served, by whom, and when.
 */
export interface ResolutionResult {
	/** The parsed DID Document. */
	document: DidDocument;
	/** The exact bytes the registry served, before JSON parsing. */
	canonicalBytes: Uint8Array;
	/** `sha256:<64-hex>` digest computed over `canonicalBytes`. */
	digest: string;
	/** The DID string passed to `resolve()`. */
	requestedDid: string;
	/** Origin of the connection that served `canonicalBytes`. */
	finalOrigin: string;
	/** `registry:<finalOrigin>#<digest>` — a stable pointer to this exact snapshot. */
	snapshotRef: string;
	/** RFC 3339 UTC instant at which this resolution was performed. */
	retrievedAt: string;
}

export interface DidDocumentResolver {
	resolve(did: string): Promise<ResolutionResult>;
}
