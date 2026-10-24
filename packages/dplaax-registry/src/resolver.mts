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
import { Unavailable } from "@o3co/auth-provider-foundation/kernel";
import {
	DestinationRefused,
	isOutboundUnavailable,
	type Narrower,
	type Outbound,
} from "@o3co/auth-provider-foundation/outbound";
import type { DidDocument, DidDocuments } from "@provin-line/auth-did-grant";
import { parseDplaaxDid, requireOwner } from "@provin-line/did-dplaax";
import { StrictJsonError, strictJsonParse } from "./strictJson.mjs";

export interface RegistryResolverOptions {
	/** The registry's base URL, as the operator configured it. */
	readonly url: string;
	/** Registry names a DID may carry beyond the URL's host. */
	readonly allowedRegistries: readonly string[];
	/** How outbound is narrowed for each fetch: the operator's own URL, a timeout and a size. */
	readonly narrower: Narrower;
	readonly outbound: Outbound;
	/** The kernel's clock, in epoch ms. */
	readonly now: () => number;
}

type Resolved = Awaited<ReturnType<DidDocuments["resolve"]>>;

const rejected = (reason: string): Resolved => ({ kind: "rejected", reason });

/**
 * Resolves did:dplaax owner DIDs at `<url>/did/<accountType>/<accountId>/did.json`.
 * Pipeline and process DIDs are refused: the grant authenticates owners, and
 * the others are the Signer API's. A DID's registry segment must be the URL's
 * host or one `allowedRegistries` names, in any case.
 *
 * Failures follow rule auth.resolve.failure-mapping: a registry that cannot
 * be reached or answers 5xx is INDETERMINATE (`Unavailable`); a DID it does
 * not hold, or bytes that are no document for it, are FAILED (rejected).
 */
export function registryResolver(options: RegistryResolverOptions): DidDocuments {
	const base = options.url.replace(/\/+$/, "");
	const origin = new URL(options.url).origin;
	// The DID's registry segment carries no port: compare against the hostname.
	const allowed = new Set(
		[new URL(options.url).hostname, ...options.allowedRegistries].map((r) => r.trim().toLowerCase()),
	);

	return {
		async resolve(did) {
			let parsed: ReturnType<typeof parseDplaaxDid>;
			try {
				parsed = parseDplaaxDid(did);
				requireOwner(parsed);
			} catch {
				return rejected(`not a did:dplaax owner DID: ${did}`);
			}
			if (!allowed.has(parsed.registry.toLowerCase())) {
				return rejected(`registry ${parsed.registry} is not one this provider resolves`);
			}

			const url = `${base}/did/${parsed.accountType}/${parsed.accountId}/did.json`;
			let answer: Awaited<ReturnType<Outbound["fetch"]>>;
			try {
				answer = await options.outbound.fetch(
					url,
					{ method: "GET", headers: { accept: "application/did+json, application/json" } },
					options.narrower,
				);
			} catch (err) {
				if (isOutboundUnavailable(err) && err.failure === "too-large") {
					return rejected(`the registry's document for ${did} is larger than this provider takes`);
				}
				// A refused destination (a redirect, an address the policy leaves out)
				// says nothing of the DID: indeterminate.
				if (DestinationRefused.is(err)) throw new Unavailable(`dplaax registry: ${err.reason}`);
				throw err;
			}

			if (answer.status >= 500) throw new Unavailable(`dplaax registry: HTTP ${answer.status}`);
			if (answer.status === 404) return rejected(`DID not found: ${did}`);
			if (answer.status < 200 || answer.status > 299) {
				return rejected(`DID resolution failed for ${did}: HTTP ${answer.status}`);
			}

			// The digest and the document come from the same bytes the registry served.
			const canonicalBytes = answer.body;
			const digest = `sha256:${createHash("sha256").update(canonicalBytes).digest("hex")}`;
			let body: unknown;
			try {
				// Strict: a duplicate key or trailing data could smuggle an ambiguous document.
				body = strictJsonParse(new TextDecoder().decode(canonicalBytes));
			} catch (err) {
				if (err instanceof StrictJsonError) return rejected(`malformed document for ${did} (${err.reason})`);
				throw err;
			}
			if (
				typeof body !== "object" ||
				body === null ||
				Array.isArray(body) ||
				typeof (body as Record<string, unknown>).id !== "string"
			) {
				return rejected(`the document for ${did} is not an object with a string id`);
			}
			const document = body as DidDocument;
			// Byte-exact (rule auth.resolve.id-equality).
			if (document.id !== did) return rejected(`the document served for ${did} names another DID`);

			return {
				kind: "resolved",
				resolution: {
					document,
					canonicalBytes,
					digest,
					requestedDid: did,
					// outbound never follows a redirect, so the bytes came from the URL's origin.
					finalOrigin: origin,
					snapshotRef: `registry:${origin}#${digest}`,
					retrievedAt: new Date(options.now()).toISOString(),
				},
			};
		},
	};
}
