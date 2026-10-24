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

export interface ParsedMessage {
	did: string;
	timestamp: string;
	nonce: string;
	audience?: string;
	/**
	 * Signed payload's `verification_method` member, if present. The grant
	 * requires it to be the resolved method (rule `auth.grant.kid-match`).
	 */
	verificationMethod?: string;
	/**
	 * JWS protected header's `kid` member, if present. The grant requires it to
	 * be the resolved method (rule `auth.grant.kid-match`).
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

export interface SignatureVerifier {
	verify(ctx: VerificationContext): Promise<VerificationResult>;
}
