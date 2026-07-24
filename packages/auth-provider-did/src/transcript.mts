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
import type { SelectedMethod } from "./resolver/selectMethod.mjs";
import type { ParsedMessage } from "./verifiers/types.mjs";

/**
 * The versioned wire/signing-scope shape of the OWNER-path login transcript
 * (dplaax.spec P0 auth contract). Bumped whenever the signed shape
 * changes in a way that must not be silently accepted by an older verifier.
 */
export const TRANSCRIPT_VERSION = "login-transcript-v1";

/**
 * Binds a signed transcript to the login use case specifically, so a
 * transcript signed for a different purpose (e.g. a future delegation flow)
 * cannot be replayed here even if every other field happens to line up —
 * rule `auth.transcript.domain-separation`.
 */
export const DOMAIN_SEPARATION_TAG = "dplaax-owner-login-v1";

/**
 * The P0 auth contract taxonomy. `LEGACY_DID_LOGIN@1` is the pre-existing
 * message shape (no transcript); the two `OWNER_*` values are transcript-
 * bearing contracts distinguished by which DID Document relationship the
 * signing key must appear in (`authentication` vs `assertionMethod`).
 */
export type AuthContractId =
	| "OWNER_AUTHENTICATION_LOGIN@1"
	| "OWNER_ASSERTION_CONTROL_LOGIN@1"
	| "LEGACY_DID_LOGIN@1";

const AUTH_CONTRACT_IDS: readonly AuthContractId[] = [
	"OWNER_AUTHENTICATION_LOGIN@1",
	"OWNER_ASSERTION_CONTROL_LOGIN@1",
	"LEGACY_DID_LOGIN@1",
];

/**
 * The OWNER-path login transcript: the payload an OWNER_* grant request
 * signs. All ten members are required, non-empty strings; unknown extra
 * members are tolerated (`additionalProperties: true` in the spec schema)
 * and simply ride along on the parsed object.
 */
export interface LoginTranscript {
	transcript_version: typeof TRANSCRIPT_VERSION;
	domain_separation_tag: typeof DOMAIN_SEPARATION_TAG;
	auth_contract_id: AuthContractId;
	issuer: string;
	token_endpoint: string;
	audience: string;
	subject_did: string;
	verification_method: string;
	nonce: string;
	timestamp: string; // RFC3339 UTC string
}

const REQUIRED_STRING_FIELDS = [
	"transcript_version",
	"domain_separation_tag",
	"auth_contract_id",
	"issuer",
	"token_endpoint",
	"audience",
	"subject_did",
	"verification_method",
	"nonce",
	"timestamp",
] as const satisfies readonly (keyof LoginTranscript)[];

const TIMESTAMP_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|z)$/;

/**
 * `Date.parse` silently NORMALIZES an out-of-range calendar field instead
 * of rejecting it — e.g. `"2026-02-30T00:00:00Z"` (Feb 30 doesn't exist)
 * parses to a valid instant, `2026-03-02T00:00:00Z`. `TIMESTAMP_PATTERN`
 * only checks digit *shape*, not calendar validity, so shape-match +
 * `Date.parse`-ability alone both pass an impossible date through.
 *
 * Reconstructing the UTC calendar components from the parsed instant and
 * comparing them back against the regex-captured input components catches
 * the rollover: a valid date always round-trips to the exact same
 * year/month/day/hour/minute/second it was written as; an invalid one never
 * does (fractional seconds are intentionally excluded from the comparison —
 * they don't affect the round value of any other field).
 */
function timestampRoundTrips(ms: number, match: RegExpExecArray): boolean {
	const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
	const d = new Date(ms);
	return (
		d.getUTCFullYear() === Number(yearStr) &&
		d.getUTCMonth() + 1 === Number(monthStr) &&
		d.getUTCDate() === Number(dayStr) &&
		d.getUTCHours() === Number(hourStr) &&
		d.getUTCMinutes() === Number(minuteStr) &&
		d.getUTCSeconds() === Number(secondStr)
	);
}

/**
 * Every `parseLoginTranscript` / `validateOwnerLogin` rejection names the
 * offending field (one of the `LoginTranscript` member names, or `"payload"`
 * for a malformed envelope) — callers report which field failed without
 * parsing message text.
 */
export class TranscriptError extends Error {
	constructor(
		readonly field: string,
		readonly reason: string,
	) {
		super(`login transcript invalid: field "${field}" — ${reason}`);
		this.name = "TranscriptError";
	}
}

/**
 * Validates `payload` (already JSON-parsed by the caller — this does NOT
 * re-stringify or re-parse) against the `LoginTranscript` schema: all ten
 * fields present as non-empty strings, `transcript_version` and
 * `domain_separation_tag` equal to their pinned consts, `auth_contract_id`
 * in the `AuthContractId` enum, and `timestamp` both RFC3339-shaped and
 * `Date.parse`-able. Unknown extra members are preserved, not stripped.
 *
 * Throws `TranscriptError` naming the first field that fails.
 */
export function parseLoginTranscript(payload: unknown): LoginTranscript {
	if (typeof payload !== "object" || payload === null) {
		throw new TranscriptError("payload", "must be a JSON object");
	}
	const record = payload as Record<string, unknown>;

	for (const field of REQUIRED_STRING_FIELDS) {
		const value = record[field];
		if (typeof value !== "string" || value.length < 1) {
			throw new TranscriptError(field, "required, must be a non-empty string");
		}
	}

	if (record.transcript_version !== TRANSCRIPT_VERSION) {
		throw new TranscriptError("transcript_version", `must be "${TRANSCRIPT_VERSION}"`);
	}
	if (record.domain_separation_tag !== DOMAIN_SEPARATION_TAG) {
		throw new TranscriptError("domain_separation_tag", `must be "${DOMAIN_SEPARATION_TAG}"`);
	}
	if (!AUTH_CONTRACT_IDS.includes(record.auth_contract_id as AuthContractId)) {
		throw new TranscriptError(
			"auth_contract_id",
			`must be one of: ${AUTH_CONTRACT_IDS.join(", ")}`,
		);
	}

	const timestamp = record.timestamp as string;
	const timestampMatch = TIMESTAMP_PATTERN.exec(timestamp);
	const timestampMs = timestampMatch === null ? Number.NaN : Date.parse(timestamp);
	if (
		timestampMatch === null ||
		Number.isNaN(timestampMs) ||
		!timestampRoundTrips(timestampMs, timestampMatch)
	) {
		throw new TranscriptError("timestamp", "must be an RFC3339 UTC timestamp");
	}

	return record as unknown as LoginTranscript;
}

/**
 * Inputs to `validateOwnerLogin`. Deliberately flat/plain rather than the
 * full grant config object (which gains the `authContract` field selecting
 * this path in Task 8, and will keep changing shape) — this keeps the
 * function's contract stable across that later config work. `transcript`,
 * `parsedMessage`, and `selected` are the artifacts a caller has already
 * produced by this point: `parseLoginTranscript(rawPayload)`, the signature
 * verifier's `ParsedMessage`, and
 * `selectVerificationMethod(doc, { did, methodId: transcript.verification_method,
 * relationship: "authentication" })` (Fork Y) respectively.
 */
export interface ValidateOwnerLoginInput {
	transcript: LoginTranscript;
	parsedMessage: ParsedMessage;
	selected: SelectedMethod;
	/** The DID the grant request claims to authenticate as. */
	did: string;
	/** The contract configured for this grant handler (`config.authContract`, Task 8). */
	expectedContract: AuthContractId;
	/** The configured token issuer (`config.oauth.issuer` or equivalent). */
	expectedIssuer: string;
	/** The configured token endpoint (`config.tokenEndpoint`, Task 8). */
	expectedTokenEndpoint: string;
	/** The configured audience allowlist (`config.allowedAudiences`, Task 8). */
	allowedAudiences: readonly string[];
}

/**
 * OWNER-path login-transcript enforcement (dplaax.spec P0 auth
 * contract, `auth_contract_id` ∈ `OWNER_*`). Pure and side-effect-free:
 * callers own signature verification, verification-method selection, and
 * replay/freshness (the existing nonce/timestamp machinery, fed from
 * `transcript.nonce` / `transcript.timestamp`) before/after calling this —
 * none of that is stateful validation this function can own.
 *
 * Checks, in order: `domain_separation_tag` against the pinned const
 * (defense in depth — `LoginTranscript["domain_separation_tag"]` is typed as
 * the literal constant, so a transcript that reached here via
 * `parseLoginTranscript` already satisfies this; re-checked so the contract
 * holds even for a hand-constructed/cast `LoginTranscript` that bypassed the
 * parser — rule `auth.transcript.domain-separation`, closes login/delegation
 * cross-replay); `subject_did === did`; `auth_contract_id === expectedContract`;
 * `issuer === expectedIssuer`; `token_endpoint === expectedTokenEndpoint`;
 * `audience ∈ allowedAudiences`; and the three-way method match
 * `parsedMessage.headerKid === transcript.verification_method === selected.id`
 * (rule `auth.grant.kid-match`).
 *
 * Not yet wired into `createDidGrant`'s handler — the config field that
 * selects the OWNER path (`authContract`) lands in Task 8; Task 8/9 call
 * this once that gate exists.
 *
 * Throws `TranscriptError` naming the first field that fails. Returns
 * nothing on success.
 */
export function validateOwnerLogin(input: ValidateOwnerLoginInput): void {
	const {
		transcript,
		parsedMessage,
		selected,
		did,
		expectedContract,
		expectedIssuer,
		expectedTokenEndpoint,
		allowedAudiences,
	} = input;

	if (transcript.domain_separation_tag !== DOMAIN_SEPARATION_TAG) {
		throw new TranscriptError("domain_separation_tag", `must be "${DOMAIN_SEPARATION_TAG}"`);
	}

	if (transcript.subject_did !== did) {
		throw new TranscriptError("subject_did", `must equal the authenticating DID "${did}"`);
	}

	if (transcript.auth_contract_id !== expectedContract) {
		throw new TranscriptError(
			"auth_contract_id",
			`must equal the configured contract "${expectedContract}"`,
		);
	}

	if (transcript.issuer !== expectedIssuer) {
		throw new TranscriptError("issuer", `must equal the configured issuer "${expectedIssuer}"`);
	}

	if (transcript.token_endpoint !== expectedTokenEndpoint) {
		throw new TranscriptError(
			"token_endpoint",
			`must equal the configured token endpoint "${expectedTokenEndpoint}"`,
		);
	}

	if (!allowedAudiences.includes(transcript.audience)) {
		throw new TranscriptError(
			"audience",
			`"${transcript.audience}" is not in the allowed audience list`,
		);
	}

	if (
		parsedMessage.headerKid !== transcript.verification_method ||
		transcript.verification_method !== selected.id
	) {
		throw new TranscriptError(
			"verification_method",
			`three-way match failed: header kid "${parsedMessage.headerKid}", ` +
				`transcript verification_method "${transcript.verification_method}", ` +
				`selected method "${selected.id}"`,
		);
	}
}
