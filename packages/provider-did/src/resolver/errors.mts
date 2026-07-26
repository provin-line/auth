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

/**
 * DID resolution error taxonomy.
 *
 * Every `DidDocumentResolver.resolve()` failure falls into exactly one of
 * two classes, so callers can decide how to react without parsing message
 * text:
 *
 * - `ResolutionUnavailableError` — the registry could not be reached, or
 *   reached but failing transiently (network error, HTTP 5xx). The DID
 *   itself may still be perfectly valid — treat this as INDETERMINATE
 *   (retry, or fail without concluding the DID is bad).
 * - `ResolutionRejectedError` — the registry was reached and definitively
 *   rejected the request (DID not found, malformed request). Treat this as
 *   FAILED — the DID is invalid/unresolvable as requested.
 *
 * `reason` is a short machine-readable code (e.g. `"registry-5xx"`,
 * `"did-not-found"`, `"network"`) that later tasks match on to decide
 * behaviour (retry policy, HTTP status mapping, etc.).
 */
export class ResolutionUnavailableError extends Error {
	/** Discriminant for the two-class DID resolution error taxonomy → INDETERMINATE. */
	readonly kind = "unavailable";

	constructor(
		readonly reason: string,
		message?: string,
	) {
		super(message ?? `DID resolution unavailable: ${reason}`);
		this.name = "ResolutionUnavailableError";
	}
}

/**
 * See `ResolutionUnavailableError` doc comment for the taxonomy this class
 * is one half of. `kind: "rejected"` → FAILED.
 */
export class ResolutionRejectedError extends Error {
	/** Discriminant for the two-class DID resolution error taxonomy → FAILED. */
	readonly kind = "rejected";

	constructor(
		readonly reason: string,
		message?: string,
	) {
		super(message ?? `DID resolution rejected: ${reason}`);
		this.name = "ResolutionRejectedError";
	}
}
