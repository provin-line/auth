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
import { MethodSelectionError, selectVerificationMethod } from "../../resolver/selectMethod.mjs";
import type { DidDocument, VerificationMethod } from "../../resolver/types.mjs";

const did = "did:example:123";

function vm(idSuffix: string, controller: string): VerificationMethod {
	return {
		id: `${did}#${idSuffix}`,
		type: "Ed25519VerificationKey2020",
		controller,
		publicKeyMultibase: `z6Mk${idSuffix}`,
	};
}

function expectReason(fn: () => void, reason: MethodSelectionError["reason"]): void {
	try {
		fn();
		expect.fail(`expected MethodSelectionError("${reason}") but no error was thrown`);
	} catch (err) {
		expect(err).toBeInstanceOf(MethodSelectionError);
		expect((err as MethodSelectionError).reason).toBe(reason);
	}
}

describe("selectVerificationMethod", () => {
	describe("duplicate-method-id (auth.method.relationship — always rejected)", () => {
		it("throws duplicate-method-id when methodId targets a non-duplicated entry but another id in the array is duplicated", () => {
			const dup1 = vm("dup", did);
			const dup2 = { ...vm("dup", "did:example:other") }; // same id, different controller
			const target = vm("target", did);
			const doc: DidDocument = { id: did, verificationMethod: [dup1, dup2, target] };

			expectReason(
				() => selectVerificationMethod(doc, { did, methodId: target.id }),
				"duplicate-method-id",
			);
		});

		it("throws duplicate-method-id in the LEGACY path (no methodId) before ambiguity is even considered", () => {
			const dup1 = vm("dup", did);
			const dup2 = { ...vm("dup", did) };
			const doc: DidDocument = { id: did, verificationMethod: [dup1, dup2] };

			expectReason(() => selectVerificationMethod(doc, { did }), "duplicate-method-id");
		});
	});

	describe("invalid-method-id (missing/non-string id — always rejected, fail-closed)", () => {
		it("throws invalid-method-id when the controller-matching method (LEGACY path) has no id", () => {
			const { id: _omit, ...withoutId } = vm("key-1", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [withoutId as unknown as VerificationMethod],
			};

			expectReason(() => selectVerificationMethod(doc, { did }), "invalid-method-id");
		});

		it("throws invalid-method-id when the controller-matching method (LEGACY path) has a non-string id", () => {
			const method = { ...vm("key-1", did), id: 42 as unknown as string };
			const doc: DidDocument = { id: did, verificationMethod: [method] };

			expectReason(() => selectVerificationMethod(doc, { did }), "invalid-method-id");
		});

		it("throws invalid-method-id on the OWNER path (methodId given) when a document method has no id, even though methodId targets a different, valid entry", () => {
			const { id: _omit, ...brokenMethod } = vm("broken", "did:example:other");
			const target = vm("target", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [brokenMethod as unknown as VerificationMethod, target],
			};

			expectReason(
				() => selectVerificationMethod(doc, { did, methodId: target.id }),
				"invalid-method-id",
			);
		});

		it("fails closed with invalid-method-id even though the invalid-id entry shares its controller with a second, valid entry — pre-fix, selectLegacy still throws here too (ambiguous-legacy-selection, since both entries share the controller), just under the wrong taxonomy reason, not a silent success (no selection-ambiguity game)", () => {
			const { id: _omit, ...brokenMethod } = vm("broken", did);
			const valid = vm("valid", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [brokenMethod as unknown as VerificationMethod, valid],
			};

			expectReason(() => selectVerificationMethod(doc, { did }), "invalid-method-id");
		});

		it("is checked before duplicate-id detection (invalid-method-id, not duplicate-method-id, when both conditions are present)", () => {
			const { id: _omit, ...brokenMethod } = vm("broken", did);
			const dup1 = vm("dup", did);
			const dup2 = vm("dup", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [brokenMethod as unknown as VerificationMethod, dup1, dup2],
			};

			expectReason(() => selectVerificationMethod(doc, { did }), "invalid-method-id");
		});
	});

	describe("OWNER path (methodId given)", () => {
		it("selects the exact method matching methodId, order-independent of controller-matching order (auth.grant.exact-method)", () => {
			const first = vm("key-1", did); // also controller-matches — must NOT be picked
			const second = vm("key-2", did);
			const doc: DidDocument = { id: did, verificationMethod: [first, second] };

			const result = selectVerificationMethod(doc, { did, methodId: second.id });

			expect(result).toEqual({ id: second.id, method: second });
		});

		it("throws method-not-found when methodId does not match any verificationMethod id", () => {
			const doc: DidDocument = { id: did, verificationMethod: [vm("key-1", did)] };

			expectReason(
				() => selectVerificationMethod(doc, { did, methodId: `${did}#nope` }),
				"method-not-found",
			);
		});

		it("throws controller-mismatch when the matched method's controller differs from the requested DID", () => {
			const method = vm("key-1", "did:example:other");
			const doc: DidDocument = { id: did, verificationMethod: [method] };

			expectReason(
				() => selectVerificationMethod(doc, { did, methodId: method.id }),
				"controller-mismatch",
			);
		});

		it("succeeds with methodId alone (no relationship requested)", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = { id: did, verificationMethod: [method] };

			const result = selectVerificationMethod(doc, { did, methodId: method.id });

			expect(result).toEqual({ id: method.id, method });
		});
	});

	describe("OWNER path + relationship", () => {
		it("succeeds when methodId is string-referenced in the requested relationship array", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [method],
				authentication: [method.id],
			};

			const result = selectVerificationMethod(doc, {
				did,
				methodId: method.id,
				relationship: "authentication",
			});

			expect(result).toEqual({ id: method.id, method });
		});

		it("ignores non-matching embedded entries and still succeeds via the string reference", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [method],
				authentication: [{ id: `${did}#other`, type: "SomeType", controller: did }, method.id],
			};

			const result = selectVerificationMethod(doc, {
				did,
				methodId: method.id,
				relationship: "authentication",
			});

			expect(result).toEqual({ id: method.id, method });
		});

		it("throws not-in-relationship when methodId is only present in a different relationship array (auth.forky.authentication-login)", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [method],
				assertionMethod: [method.id],
				// no `authentication` entry for this method
			};

			expectReason(
				() =>
					selectVerificationMethod(doc, {
						did,
						methodId: method.id,
						relationship: "authentication",
					}),
				"not-in-relationship",
			);
		});

		it("throws not-in-relationship (not a raw TypeError) when the relationship value is a non-iterable plain object", () => {
			// A plain object `{}` is NOT iterable in JS -- unlike a string, which
			// iterates over its characters and would make this fixture vacuous.
			// Pre-fix code (`doc[relationship] ?? []` followed by a bare
			// `for...of`) throws a raw, untyped `TypeError` ("{} is not
			// iterable") for a plain-object fixture, NOT a `MethodSelectionError`
			// -- so `expectReason`'s `toBeInstanceOf(MethodSelectionError)` check
			// genuinely fails pre-fix. Only the `Array.isArray` guard in
			// `assertStringReferenced` normalizes a non-array to the taxonomy's
			// `not-in-relationship` reason (treated the same as an absent array).
			const method = vm("key-1", did);
			const doc = {
				id: did,
				verificationMethod: [method],
				authentication: {} as unknown,
			} as unknown as DidDocument;

			expectReason(
				() =>
					selectVerificationMethod(doc, {
						did,
						methodId: method.id,
						relationship: "authentication",
					}),
				"not-in-relationship",
			);
		});

		it("throws not-in-relationship (not a raw TypeError) when the relationship value is a non-iterable number", () => {
			// Same non-iterable-value regression guard as the plain-object case
			// above, with a different primitive: `42` is also not iterable, so
			// pre-fix `for...of` throws a raw TypeError here too.
			const method = vm("key-1", did);
			const doc = {
				id: did,
				verificationMethod: [method],
				authentication: 42 as unknown,
			} as unknown as DidDocument;

			expectReason(
				() =>
					selectVerificationMethod(doc, {
						did,
						methodId: method.id,
						relationship: "authentication",
					}),
				"not-in-relationship",
			);
		});

		it("throws not-in-relationship when the relationship array is absent entirely", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = { id: did, verificationMethod: [method] };

			expectReason(
				() =>
					selectVerificationMethod(doc, {
						did,
						methodId: method.id,
						relationship: "authentication",
					}),
				"not-in-relationship",
			);
		});

		it("throws embedded-method-forbidden when the relationship array embeds a matching-id object instead of a string reference (auth.method.string-reference-only)", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = {
				id: did,
				verificationMethod: [method],
				authentication: [
					{ id: method.id, type: method.type, controller: method.controller, publicKeyMultibase: method.publicKeyMultibase },
				],
			};

			expectReason(
				() =>
					selectVerificationMethod(doc, {
						did,
						methodId: method.id,
						relationship: "authentication",
					}),
				"embedded-method-forbidden",
			);
		});
	});

	describe("LEGACY path (no methodId)", () => {
		it("selects the sole controller-matched method", () => {
			const method = vm("key-1", did);
			const doc: DidDocument = { id: did, verificationMethod: [method] };

			const result = selectVerificationMethod(doc, { did });

			expect(result).toEqual({ id: method.id, method });
		});

		it("throws ambiguous-legacy-selection when more than one verificationMethod matches the DID's controller (fail-closed tightening of the old first-match behavior)", () => {
			const first = vm("key-1", did);
			const second = vm("key-2", did);
			const doc: DidDocument = { id: did, verificationMethod: [first, second] };

			expectReason(() => selectVerificationMethod(doc, { did }), "ambiguous-legacy-selection");
		});

		it("throws method-not-found when no verificationMethod matches the DID's controller", () => {
			const doc: DidDocument = {
				id: did,
				verificationMethod: [vm("key-1", "did:example:other")],
			};

			expectReason(() => selectVerificationMethod(doc, { did }), "method-not-found");
		});

		it("throws method-not-found when verificationMethod is absent entirely", () => {
			const doc: DidDocument = { id: did };

			expectReason(() => selectVerificationMethod(doc, { did }), "method-not-found");
		});
	});
});
