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
import type { ExtractedKey } from "../resolver/extractKey.mjs";

/**
 * The signed message as a verifier read it. The two method references feed
 * rule `auth.grant.kid-match`: the grant refuses a request where either is
 * present and is not, as an exact string, the resolved method's absolute id.
 * Nothing resolves a relative reference or normalises one.
 */
export interface ParsedMessage {
	did: string;
	timestamp: string;
	nonce: string;
	audience?: string;
	/**
	 * The signed payload's `verification_method` member. A verifier sets it
	 * whenever the message carries one, and leaves it unset only when the
	 * message names no method: left unset, the grant has nothing to match.
	 */
	verificationMethod?: string;
	/**
	 * The JWS protected header's `kid`. Set only from a protected header, never
	 * from the payload, and unset for an envelope without one.
	 */
	headerKid?: string;
}

/** The request parameters a verifier reads, as the client sent them; every one a string, and any may be missing. */
export type DidGrantParams = Partial<
	Record<"did" | "algorithm" | "message" | "signature" | "prehash" | "jws", string>
>;

export interface VerificationContext {
	body: DidGrantParams;
	did: string;
	resolvedKey: ExtractedKey;
}

/**
 * A valid result names the subject, which the grant requires to be the DID
 * the request names, as it requires of `parsedMessage.did`. A failure is a
 * malformed request or a credential that does not hold; the grant answers
 * either with 400.
 */
export type VerificationResult =
	| { valid: true; subject: string; audience?: string; parsedMessage: ParsedMessage }
	| { valid: false; error: "invalid_request" | "invalid_grant"; errorDescription: string };

/**
 * Checks a request's signature against the resolved key and reads its message.
 * It takes `parsedMessage`'s values from signed data only, and refuses a
 * method reference that is not a string (`invalid_request`).
 */
export interface SignatureVerifier {
	verify(ctx: VerificationContext): Promise<VerificationResult>;
}
