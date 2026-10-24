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

import { createHash } from "node:crypto";
import { clientAllowance } from "@o3co/auth-provider-oauth/client-allowance";
import type { Grant, GrantInput, GrantOutcome, Refused } from "@o3co/auth-provider-oauth/grants";
import type { DidDocuments, SpentNonces } from "./contract.mjs";
import { extractVerificationKey } from "./resolver/extractKey.mjs";
import { type RelationshipName, selectVerificationMethod } from "./resolver/selectMethod.mjs";
import {
	type AuthContractId,
	isOwnerContract,
	parseLoginTranscript,
	TranscriptError,
	validateOwnerLogin,
} from "./transcript.mjs";
import { detectAlgorithm } from "./verifiers/detect.mjs";
import type { VerifierFactory } from "./verifiers/factory.mjs";
import type { SignatureVerifier } from "./verifiers/types.mjs";

export const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";

/** The request parameters the verifiers read, every one a string. */
const MESSAGE_PARAMS = ["did", "algorithm", "message", "signature", "prehash", "jws"] as const;

/** Kept longer than a message is accepted by this much, so a store clock behind ours never lets a nonce back. */
const USED_ALLOWANCE_MS = 60_000;

export interface DidGrantSettings {
	readonly authContract: AuthContractId;
	readonly supportedAlgorithms: readonly string[];
	readonly messageMaxAgeMs: number;
	readonly accessTokenLifetimeSeconds: number;
	/** This provider's issuer URL. */
	readonly issuer: string;
	/** Where the token endpoint answers; an OWNER contract's transcript must name it. */
	readonly tokenEndpoint: string | undefined;
}

export interface DidGrantParts {
	readonly documents: DidDocuments;
	readonly nonces: SpentNonces;
	/** Every algorithm composed, built in and contributed, by name. */
	readonly algorithms: ReadonlyMap<string, VerifierFactory>;
	/** The kernel's clock, in epoch ms. */
	readonly now: () => number;
}

type Answer = GrantOutcome | Refused;

const error = (code: string, description?: string): Answer => ({
	kind: "error",
	error: code,
	...(description === undefined ? {} : { description }),
});

/**
 * The DID Document relationship an OWNER contract's key must be listed under:
 * `authentication` for `OWNER_AUTHENTICATION_LOGIN@1`, `assertionMethod` for
 * `OWNER_ASSERTION_CONTROL_LOGIN@1`.
 */
const relationshipFor = (contract: Exclude<AuthContractId, "LEGACY_DID_LOGIN@1">): RelationshipName =>
	contract === "OWNER_AUTHENTICATION_LOGIN@1" ? "authentication" : "assertionMethod";

/** A spent nonce's name: one per nonce, whatever DID signed it, and bounded whatever the nonce holds. */
const spentName = (nonce: string) =>
	createHash("sha256").update(JSON.stringify(["did-nonce", nonce])).digest("base64url");

/** The DID grant: a client exchanges a login message a DID signed for an access token for that DID. */
export function didGrant(settings: DidGrantSettings, parts: DidGrantParts): Grant {
	// One verifier per algorithm, made when a request first names it.
	const verifiers = new Map<string, Promise<SignatureVerifier>>();
	const verifierFor = (algorithm: string, create: VerifierFactory): Promise<SignatureVerifier> => {
		const made = verifiers.get(algorithm) ?? create();
		verifiers.set(algorithm, made);
		return made;
	};

	return {
		grantType: DID_GRANT_TYPE,
		bodies: ["form", "json"],
		readsAmbient: "none",
		handle: async (input: GrantInput): Promise<Answer> => {
			const body: Record<string, string> = {};
			for (const name of MESSAGE_PARAMS) {
				const value = input.param(name);
				if (value !== undefined) body[name] = value;
			}
			const did = body.did;
			if (!did) return error("invalid_request", "did is required");

			// Resolve (rule auth.resolve.failure-mapping): a rejection is FAILED and
			// tells its reason; a resolver that cannot tell throws Unavailable (503).
			const resolved = await parts.documents.resolve(did);
			if (resolved.kind === "rejected") return error("invalid_grant", resolved.reason);
			const { resolution } = resolved;

			// The method selection's messages may carry document content: never echoed.
			let resolvedKey: Awaited<ReturnType<typeof extractVerificationKey>>;
			try {
				resolvedKey = await extractVerificationKey(resolution.document, did);
			} catch {
				return error("invalid_grant", "grant could not be processed");
			}

			const algorithm = detectAlgorithm(body);
			if (!algorithm) return error("invalid_request", "unable to detect signature algorithm from request body");
			const create = parts.algorithms.get(algorithm);
			if (!create || !settings.supportedAlgorithms.includes(algorithm)) {
				return error("invalid_request", `algorithm "${algorithm}" is not supported by this server`);
			}

			// Nonce and timestamp are checked after verification: the verifier owns
			// parsing the message, whose format is the algorithm's.
			const verification = await (await verifierFor(algorithm, create)).verify({ body, did, resolvedKey });
			// 400 for every failure: 401 would make the endpoint challenge for client authentication.
			if (!verification.valid) return error(verification.error, verification.errorDescription);
			const { parsedMessage } = verification;

			// OWNER contracts: the signed payload is a login transcript, checked
			// before the nonce is spent, so a refused transcript leaves it unused.
			const contract = settings.authContract;
			if (isOwnerContract(contract)) {
				try {
					const transcript = parseLoginTranscript(parsedMessage);
					const ownerSelected = selectVerificationMethod(resolution.document, {
						did,
						methodId: transcript.verification_method,
						relationship: relationshipFor(contract),
					});
					// The method the transcript certifies is the one that verified the signature.
					if (ownerSelected.id !== resolvedKey.id) {
						throw new TranscriptError(
							"verification_method",
							`OWNER-selected method "${ownerSelected.id}" does not match the crypto-verified method "${resolvedKey.id}"`,
						);
					}
					validateOwnerLogin({
						transcript,
						parsedMessage,
						selected: ownerSelected,
						did,
						expectedContract: contract,
						expectedIssuer: settings.issuer,
						// Boot refuses an OWNER contract without a located token endpoint.
						expectedTokenEndpoint: settings.tokenEndpoint ?? "",
						allowsAudience: (audience) =>
							clientAllowance.allowsAudience(input.client, audience, settings.issuer),
					});
				} catch {
					return error("invalid_grant", "grant could not be processed");
				}
			}

			if (!parsedMessage.nonce || !parsedMessage.timestamp) {
				return error("invalid_request", "message must include nonce and timestamp");
			}
			const now = parts.now();
			const messageTime = new Date(parsedMessage.timestamp).getTime();
			if (Number.isNaN(messageTime) || Math.abs(now - messageTime) > settings.messageMaxAgeMs) {
				return error("invalid_request", "message timestamp is expired or invalid");
			}

			// Spent before the allowance is asked, so a message is used once even when
			// it is refused: the safe side for a credential that cannot be withdrawn.
			// Kept until the message's own window closes, which a message stamped
			// ahead of the clock keeps open past now + message-max-age.
			const lifetimeMs = messageTime + settings.messageMaxAgeMs - now + USED_ALLOWANCE_MS;
			if ((await parts.nonces.save(spentName(parsedMessage.nonce), lifetimeMs)) === "exists") {
				return error("invalid_request", "nonce already used");
			}

			const allowed = clientAllowance.allowedIssuance(input.client, input.param("scope"), settings.issuer);
			if (allowed.kind === "error") return allowed;
			let audience = allowed.audience;
			if (verification.audience !== undefined) {
				if (!clientAllowance.allowsAudience(input.client, verification.audience, settings.issuer)) {
					return error("invalid_request", `audience "${verification.audience}" is not allowed`);
				}
				audience = [verification.audience];
			}

			const access = {
				subject: verification.subject,
				issuedTo: input.client.id,
				audience,
				scope: allowed.scope,
			};
			const admitted = await input.admits(access);
			if (admitted.kind === "refused") return admitted;
			const issued = await input.issue(access, { lifetimeSeconds: settings.accessTokenLifetimeSeconds });
			if (issued.kind === "refused") return issued;
			const { token, tokenType, expiresIn } = issued.access;
			return {
				kind: "issued",
				body: {
					access_token: token,
					token_type: tokenType,
					expires_in: expiresIn,
					...(allowed.scope.length > 0 ? { scope: allowed.scope.join(" ") } : {}),
				},
			};
		},
	};
}
