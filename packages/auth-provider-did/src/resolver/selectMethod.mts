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
import type { DidDocument, VerificationMethod } from "./types.mjs";

/**
 * DID Document verification-relationship arrays this module can check a
 * method reference against. (The DID Core spec defines more relationships;
 * only the ones this codebase currently consumes are modeled here.)
 */
export type RelationshipName = "authentication" | "assertionMethod";

/**
 * Verification-method selection failure taxonomy. Every rejection from
 * `selectVerificationMethod` falls into exactly one of these — callers
 * branch on `reason`, not on message text.
 */
export class MethodSelectionError extends Error {
	constructor(
		readonly reason:
			| "invalid-method-id"
			| "duplicate-method-id"
			| "method-not-found"
			| "controller-mismatch"
			| "not-in-relationship"
			| "embedded-method-forbidden"
			| "ambiguous-legacy-selection",
		message?: string,
	) {
		super(message ?? `verification method selection failed: ${reason}`);
		this.name = "MethodSelectionError";
	}
}

export interface SelectedMethod {
	id: string;
	method: VerificationMethod;
}

/**
 * Select exactly one `verificationMethod` from a DID Document, fail-closed.
 *
 * A missing or non-string `id` on ANY entry in `verificationMethod[]` is
 * rejected (`"invalid-method-id"`) *always* — even when the caller's
 * `methodId`/controller-matching targets a different, well-formed entry —
 * checked before duplicate-id detection or selection. Silently skipping the
 * malformed entry and selecting a different one would let a document that
 * carries one broken method still authenticate via another, which is a
 * selection-ambiguity game (rule auth.token.signed-claims: a method with no
 * string `id` can never populate the minted token's required
 * `verification_method` claim). A duplicate `id` anywhere in
 * `verificationMethod[]` is likewise rejected (`"duplicate-method-id"`, rule
 * `auth.method.relationship`) *always* — even when the caller's `methodId`
 * targets a different, non-duplicated entry. A document that cannot
 * uniquely name its own methods is untrustworthy regardless of which method
 * was asked for.
 *
 * Two call shapes, chosen by whether `opts.methodId` is given:
 *
 * - **OWNER** (`methodId` given): exact string match on `id` (no
 *   normalization). The matched method's `controller` must equal
 *   `opts.did` (else `"controller-mismatch"`, rule
 *   `auth.grant.exact-method`). Not found at all → `"method-not-found"`.
 *   When `opts.relationship` is also given, that relationship array must
 *   exist and contain the **string** `methodId` (rule
 *   `auth.method.string-reference-only`): a same-id entry that is an
 *   embedded object rather than a string reference is rejected
 *   (`"embedded-method-forbidden"`) rather than silently trusted — this is
 *   what keeps an `authentication`/login relationship from being satisfied
 *   by a method smuggled in as an inline object (rule
 *   `auth.forky.authentication-login`). Non-string entries that don't
 *   match `methodId` are ignored; their mere presence is not an error. If
 *   `methodId` isn't referenced (as a string) anywhere in the relationship
 *   array — including when the array itself is absent — that's
 *   `"not-in-relationship"`.
 * - **LEGACY** (no `methodId`): controller-matched candidates are
 *   computed. Exactly one → selected. Zero → `"method-not-found"`. More
 *   than one → `"ambiguous-legacy-selection"` — this deliberately tightens
 *   the old first-match-in-array-order behavior; multi-key documents must
 *   use the OWNER path instead of relying on array order.
 */
export function selectVerificationMethod(
	doc: DidDocument,
	opts: { did: string; methodId?: string; relationship?: RelationshipName },
): SelectedMethod {
	const methods = doc.verificationMethod ?? [];
	rejectInvalidIds(methods);
	rejectDuplicateIds(methods);

	const { did, methodId, relationship } = opts;

	if (methodId !== undefined) {
		return selectByMethodId(doc, methods, did, methodId, relationship);
	}

	return selectLegacy(methods, did);
}

/**
 * Fail closed on any `verificationMethod` entry whose `id` is missing or
 * not a string — regardless of whether that entry is the one selection
 * would otherwise pick. A method with no string `id` has valid key material
 * but can never populate the minted token's required `verification_method`
 * claim (rule `auth.token.signed-claims`); silently skipping it in favor of
 * another controller-matched candidate would turn a malformed document into
 * a selection-ambiguity game rather than a rejection.
 */
function rejectInvalidIds(methods: VerificationMethod[]): void {
	for (const vm of methods) {
		if (typeof vm.id !== "string" || vm.id.length === 0) {
			throw new MethodSelectionError(
				"invalid-method-id",
				`verificationMethod has a missing or non-string "id" (got ${JSON.stringify(vm.id)}); ` +
					"every entry must carry a non-empty string id",
			);
		}
	}
}

function rejectDuplicateIds(methods: VerificationMethod[]): void {
	const seenIds = new Set<string>();
	for (const vm of methods) {
		if (seenIds.has(vm.id)) {
			throw new MethodSelectionError(
				"duplicate-method-id",
				`verificationMethod id "${vm.id}" appears more than once in the DID Document`,
			);
		}
		seenIds.add(vm.id);
	}
}

function selectByMethodId(
	doc: DidDocument,
	methods: VerificationMethod[],
	did: string,
	methodId: string,
	relationship: RelationshipName | undefined,
): SelectedMethod {
	const method = methods.find((vm) => vm.id === methodId);
	if (!method) {
		throw new MethodSelectionError("method-not-found", `no verificationMethod with id "${methodId}"`);
	}
	if (method.controller !== did) {
		throw new MethodSelectionError(
			"controller-mismatch",
			`verificationMethod "${methodId}" controller "${method.controller}" does not match DID "${did}"`,
		);
	}
	if (relationship !== undefined) {
		assertStringReferenced(doc, relationship, methodId);
	}
	return { id: method.id, method };
}

/**
 * Rule `auth.method.string-reference-only`: a relationship array member is
 * only trusted as a reference to `methodId` when it is the bare string
 * `methodId` itself. An embedded object whose own `id` happens to equal
 * `methodId` is a forbidden self-assertion, not a reference — rule
 * `auth.forky.authentication-login` (an `authentication` entry must point
 * at a verificationMethod, not smuggle one in inline). Other non-string
 * entries that don't match `methodId` are ignored: their presence alone is
 * not an error.
 *
 * `DidDocument`'s index signature (`[k: string]: unknown`) means a
 * resolved-but-unvalidated document can carry a non-array value under
 * `relationship` at runtime even though the type says `unknown[]` — a
 * bare `for...of` over that would throw a raw (untyped) `TypeError`
 * instead of a `MethodSelectionError`. Treated the same as an absent
 * array: no entries to check, so `methodId` ends up `not-in-relationship`
 * rather than escaping the taxonomy.
 */
function assertStringReferenced(
	doc: DidDocument,
	relationship: RelationshipName,
	methodId: string,
): void {
	const rawEntries = doc[relationship];
	const entries = Array.isArray(rawEntries) ? rawEntries : [];
	let embedded = false;
	let referenced = false;

	for (const entry of entries) {
		if (typeof entry === "string") {
			if (entry === methodId) referenced = true;
			continue;
		}
		const embeddedId =
			entry !== null && typeof entry === "object"
				? (entry as Record<string, unknown>).id
				: undefined;
		if (embeddedId === methodId) embedded = true;
	}

	if (embedded) {
		throw new MethodSelectionError(
			"embedded-method-forbidden",
			`"${methodId}" appears as an embedded verificationMethod object in "${relationship}"; ` +
				"only string references are trusted",
		);
	}
	if (!referenced) {
		throw new MethodSelectionError(
			"not-in-relationship",
			`"${methodId}" is not string-referenced in relationship "${relationship}"`,
		);
	}
}

function selectLegacy(methods: VerificationMethod[], did: string): SelectedMethod {
	const candidates = methods.filter((vm) => vm.controller === did);

	if (candidates.length === 0) {
		throw new MethodSelectionError(
			"method-not-found",
			`no verificationMethod with controller "${did}"`,
		);
	}
	if (candidates.length > 1) {
		throw new MethodSelectionError(
			"ambiguous-legacy-selection",
			`${candidates.length} verificationMethod entries have controller "${did}"; ` +
				"pass methodId to disambiguate",
		);
	}

	const method = candidates[0];
	return { id: method.id, method };
}
