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
import { describe, expect, it } from "vitest";

import type { SelectedMethod } from "../resolver/selectMethod.mjs";
import {
	DOMAIN_SEPARATION_TAG,
	type LoginTranscript,
	parseLoginTranscript,
	TranscriptError,
	TRANSCRIPT_VERSION,
	validateOwnerLogin,
	type ValidateOwnerLoginInput,
} from "../transcript.mjs";
import type { ParsedMessage } from "../verifiers/types.mjs";

const REQUIRED_FIELDS = [
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
] as const;

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		transcript_version: TRANSCRIPT_VERSION,
		domain_separation_tag: DOMAIN_SEPARATION_TAG,
		auth_contract_id: "OWNER_AUTHENTICATION_LOGIN@1",
		issuer: "https://issuer.example",
		token_endpoint: "https://issuer.example/token",
		audience: "https://relying-party.example",
		subject_did: "did:dplaax:u:alice",
		verification_method: "did:dplaax:u:alice#key-1",
		nonce: "nonce-abc-123",
		timestamp: "2026-07-16T12:00:00Z",
		...overrides,
	};
}

function expectTranscriptError(fn: () => void, field: string): void {
	try {
		fn();
		expect.fail(`expected TranscriptError(field="${field}") but no error was thrown`);
	} catch (err) {
		expect(err).toBeInstanceOf(TranscriptError);
		expect((err as TranscriptError).field).toBe(field);
	}
}

describe("parseLoginTranscript", () => {
	it("parses a valid transcript", () => {
		const payload = validPayload();
		const result = parseLoginTranscript(payload);
		expect(result).toEqual(payload);
	});

	describe.each(REQUIRED_FIELDS)("required field %s", (field) => {
		it("rejects when missing", () => {
			const payload = validPayload();
			delete payload[field];
			expectTranscriptError(() => parseLoginTranscript(payload), field);
		});

		it("rejects when blank", () => {
			const payload = validPayload({ [field]: "" });
			expectTranscriptError(() => parseLoginTranscript(payload), field);
		});
	});

	it("rejects transcript_version that does not equal the pinned const", () => {
		const payload = validPayload({ transcript_version: "login-transcript-v0" });
		expectTranscriptError(() => parseLoginTranscript(payload), "transcript_version");
	});

	it("rejects domain_separation_tag that does not equal the pinned const", () => {
		const payload = validPayload({ domain_separation_tag: "some-other-tag" });
		expectTranscriptError(() => parseLoginTranscript(payload), "domain_separation_tag");
	});

	it("rejects auth_contract_id outside the enum", () => {
		const payload = validPayload({ auth_contract_id: "SOMETHING_ELSE@1" });
		expectTranscriptError(() => parseLoginTranscript(payload), "auth_contract_id");
	});

	it("accepts every AuthContractId enum member", () => {
		for (const contract of [
			"OWNER_AUTHENTICATION_LOGIN@1",
			"OWNER_ASSERTION_CONTROL_LOGIN@1",
			"LEGACY_DID_LOGIN@1",
		]) {
			const payload = validPayload({ auth_contract_id: contract });
			expect(() => parseLoginTranscript(payload)).not.toThrow();
		}
	});

	it("rejects a numeric timestamp", () => {
		const payload = validPayload({ timestamp: 1752667200000 });
		expectTranscriptError(() => parseLoginTranscript(payload), "timestamp");
	});

	it("rejects a timestamp that does not match the RFC3339 pattern", () => {
		const payload = validPayload({ timestamp: "2026-07-16 12:00:00" });
		expectTranscriptError(() => parseLoginTranscript(payload), "timestamp");
	});

	it("rejects a timestamp that matches the pattern but is not Date.parse-able", () => {
		// Regex only checks digit shape, not calendar validity; month 13 passes
		// the pattern but Date.parse must still reject it.
		const payload = validPayload({ timestamp: "2026-13-01T00:00:00Z" });
		expectTranscriptError(() => parseLoginTranscript(payload), "timestamp");
	});

	it("accepts a timestamp with fractional seconds and lowercase z", () => {
		const payload = validPayload({ timestamp: "2026-07-16T12:00:00.123z" });
		expect(() => parseLoginTranscript(payload)).not.toThrow();
	});

	it("tolerates unknown extra members (additionalProperties: true)", () => {
		const payload = validPayload({ extra_field: "anything", another: 42 });
		expect(() => parseLoginTranscript(payload)).not.toThrow();
		const result = parseLoginTranscript(payload) as unknown as Record<string, unknown>;
		expect(result.extra_field).toBe("anything");
		expect(result.another).toBe(42);
	});

	it("rejects a non-object payload", () => {
		expect(() => parseLoginTranscript(null)).toThrow(TranscriptError);
		expect(() => parseLoginTranscript("not an object")).toThrow(TranscriptError);
		expect(() => parseLoginTranscript(42)).toThrow(TranscriptError);
	});
});

describe("validateOwnerLogin", () => {
	function baseTranscript(): LoginTranscript {
		return parseLoginTranscript(validPayload());
	}

	function baseInput(): ValidateOwnerLoginInput {
		const transcript = baseTranscript();
		const parsedMessage: ParsedMessage = {
			did: transcript.subject_did,
			timestamp: transcript.timestamp,
			nonce: transcript.nonce,
			headerKid: transcript.verification_method,
			verificationMethod: transcript.verification_method,
		};
		const selected: SelectedMethod = {
			id: transcript.verification_method,
			method: {
				id: transcript.verification_method,
				type: "Ed25519VerificationKey2020",
				controller: transcript.subject_did,
			},
		};
		return {
			transcript,
			parsedMessage,
			selected,
			did: transcript.subject_did,
			expectedContract: transcript.auth_contract_id,
			expectedIssuer: transcript.issuer,
			expectedTokenEndpoint: transcript.token_endpoint,
			allowedAudiences: [transcript.audience],
		};
	}

	it("does not throw on a fully consistent OWNER login", () => {
		expect(() => validateOwnerLogin(baseInput())).not.toThrow();
	});

	it("rejects when transcript.subject_did does not equal the authenticating did", () => {
		const input = { ...baseInput(), did: "did:dplaax:u:mallory" };
		expectTranscriptError(() => validateOwnerLogin(input), "subject_did");
	});

	it("rejects when transcript.auth_contract_id does not equal the configured contract", () => {
		const input: ValidateOwnerLoginInput = {
			...baseInput(),
			expectedContract: "LEGACY_DID_LOGIN@1",
		};
		expectTranscriptError(() => validateOwnerLogin(input), "auth_contract_id");
	});

	it("rejects when transcript.issuer does not equal the configured issuer", () => {
		const input = { ...baseInput(), expectedIssuer: "https://evil.example" };
		expectTranscriptError(() => validateOwnerLogin(input), "issuer");
	});

	it("rejects when transcript.token_endpoint does not equal the configured token endpoint", () => {
		const input = { ...baseInput(), expectedTokenEndpoint: "https://evil.example/token" };
		expectTranscriptError(() => validateOwnerLogin(input), "token_endpoint");
	});

	it("rejects when transcript.audience is not in allowedAudiences", () => {
		const input = { ...baseInput(), allowedAudiences: ["https://someone-else.example"] };
		expectTranscriptError(() => validateOwnerLogin(input), "audience");
	});

	it("rejects a three-way method mismatch (headerKid differs from transcript.verification_method)", () => {
		const base = baseInput();
		const input: ValidateOwnerLoginInput = {
			...base,
			parsedMessage: { ...base.parsedMessage, headerKid: "did:dplaax:u:alice#key-2" },
		};
		expectTranscriptError(() => validateOwnerLogin(input), "verification_method");
	});

	it("rejects a three-way method mismatch (selected.id differs from transcript.verification_method)", () => {
		const base = baseInput();
		const input: ValidateOwnerLoginInput = {
			...base,
			selected: { ...base.selected, id: "did:dplaax:u:alice#key-2" },
		};
		expectTranscriptError(() => validateOwnerLogin(input), "verification_method");
	});

	it("rejects a domain_separation_tag mismatch even on a hand-constructed transcript (defense in depth)", () => {
		const base = baseInput();
		const tampered: LoginTranscript = {
			...base.transcript,
			domain_separation_tag: "dplaax-delegation-v1",
		} as unknown as LoginTranscript;
		const input: ValidateOwnerLoginInput = { ...base, transcript: tampered };
		expectTranscriptError(() => validateOwnerLogin(input), "domain_separation_tag");
	});
});
