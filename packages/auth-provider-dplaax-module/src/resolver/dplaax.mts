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

import {
    type DidDocument,
    type DidDocumentResolver,
    ResolutionRejectedError,
    type ResolutionResult,
    ResolutionUnavailableError,
    StrictJsonError,
    strictJsonParse,
} from "@provin-line/auth-provider-did";
import { parseDplaaxDid, requireOwner } from "@provin-line/did-dplaax";
import {
    type BoundedFetch,
    type BoundedFetchOptions,
    createBoundedFetch,
    DEFAULT_BOUNDS,
} from "./boundedFetch.mjs";

export interface DplaaxDidResolverOptions {
    /**
     * Additional `parsed.registry` values to accept beyond the hostname of
     * `registryBaseUrl`. The hostname of `registryBaseUrl` is always in the
     * allow-list — these entries are appended, not substituted.
     *
     * Use case: migrations where DIDs preserve a legacy registry identifier
     * but are served by a new registry (e.g., HUB-managed registry →
     * independent self-hosted registry). The new registry operator adds the
     * legacy registry name here so existing DIDs remain resolvable without
     * rewriting, while DIDs minted under the new registry name also work.
     *
     * Matching is case-insensitive (hostnames per RFC 3986); entries are
     * lowercased + trimmed + deduped internally.
     */
    allowedRegistries?: string[];
    /**
     * Resource-floor bounds for the transport (timeout / body-size cap /
     * concurrency). Merged over `DEFAULT_BOUNDS` — callers only need to
     * override the fields they care about.
     */
    bounds?: Partial<BoundedFetchOptions>;
    /**
     * Injectable `fetch` implementation, primarily for tests. Defaults to
     * the global `fetch`.
     */
    fetchImpl?: typeof fetch;
}

/**
 * Resolves did:dplaax DIDs via HTTP against a DID Registry.
 *
 * Accepts only owner DIDs; pipeline/process DIDs are rejected with an error.
 * Rationale: auth.provider is an OAuth identity authentication provider, and
 * the authenticated subject is limited to owner DIDs. Pipeline/process DIDs
 * are handled via the Signer API and are out of scope for this resolver.
 *
 * Accepts any syntactically valid accountType (requirements.md §2): which
 * accountTypes exist is the DID Registry's registration-time responsibility,
 * and a type the registry never minted simply fails resolution. The parser's
 * SAFE_SEGMENT grammar remains the guard for URL construction. Deployments
 * that need a local accountType allow-list can wrap resolve() with
 * `validateDplaaxDid` (still exported from @provin-line/did-dplaax).
 *
 * Validates the DID's registry segment (must be in allowedRegistries, which
 * defaults to the hostname of registryBaseUrl only).
 */
export class DplaaxDidResolver implements DidDocumentResolver {
    private readonly registryBaseUrl: string;
    private readonly allowedRegistries: Set<string>;
    private readonly boundedFetch: BoundedFetch;

    constructor(
        registryBaseUrl: string,
        options: DplaaxDidResolverOptions = {},
    ) {
        // Strip a trailing slash so fetch URL construction produces a single
        // separator regardless of how the caller configured baseUrl.
        this.registryBaseUrl = registryBaseUrl.replace(/\/+$/, "");

        // Use hostname (not host) because the DID's registry segment is
        // colon-delimited and cannot carry a port; matching against host
        // would incorrectly reject DIDs whenever registryBaseUrl contains
        // an explicit port (e.g. "127.0.0.1:8080" in dev/test).
        // URL.hostname is already lowercased. Normalize explicit
        // allowedRegistries entries the same way so comparison is
        // case-insensitive (hostnames per RFC 3986), and dedupe via Set.
        //
        // baseHost is ALWAYS included in the allow-list, even when the caller
        // supplies options.allowedRegistries — otherwise a caller configuring
        // only legacy registry names (migration scenario) would accidentally
        // exclude the registry hosted at registryBaseUrl itself and cause
        // otherwise-valid DIDs to be rejected.
        const baseHost = new URL(registryBaseUrl).hostname;
        const extra = options.allowedRegistries ?? [];
        this.allowedRegistries = new Set(
            [baseHost, ...extra].map((r) => r.trim().toLowerCase()),
        );

        // Built once per instance (not per resolve() call) so the
        // maxConcurrent semaphore is shared across every request this
        // resolver makes, per the "resource floor" the transport enforces.
        this.boundedFetch = createBoundedFetch(
            { ...DEFAULT_BOUNDS, ...options.bounds },
            options.fetchImpl,
        );
    }

    async resolve(did: string): Promise<ResolutionResult> {
        const parsed = parseDplaaxDid(did);

        requireOwner(parsed);

        if (!this.allowedRegistries.has(parsed.registry.toLowerCase())) {
            throw new Error(
                `registry "${parsed.registry}" not in allow-list for DID: "${did}"`,
            );
        }

        const url = `${this.registryBaseUrl}/did/${parsed.accountType}/${parsed.accountId}/did.json`;

        // The bounded transport (timeout / body cap / redirect refusal /
        // concurrency — Task 3's job) already turned network failures,
        // timeouts, and an oversized body into the two-class error taxonomy
        // (errors.mts); it either throws or returns bytes it fully read, so
        // there's no separate fetch/network try-catch here anymore.
        const { status, bytes: canonicalBytes, finalOrigin } = await this.boundedFetch(url);

        if (status < 200 || status >= 300) {
            if (status >= 500) {
                throw new ResolutionUnavailableError(
                    "registry-5xx",
                    `DID resolution failed for "${did}": HTTP ${status}`,
                );
            }
            if (status === 404) {
                throw new ResolutionRejectedError(
                    "did-not-found",
                    `DID resolution failed for "${did}": HTTP ${status}`,
                );
            }
            throw new ResolutionRejectedError(
                "registry-4xx",
                `DID resolution failed for "${did}": HTTP ${status}`,
            );
        }

        // canonicalBytes/digest must be the exact bytes the registry served
        // (ResolutionResult contract) — boundedFetch hands back the raw
        // bytes it read off the stream (never a res.text() round-trip: per
        // WHATWG Fetch, text() strips a leading UTF-8 BOM and replaces
        // invalid UTF-8 with U+FFFD before returning a string, so
        // re-encoding that string could silently diverge from the wire
        // bytes). strictJsonParse's input is decoded from these same
        // canonicalBytes below, so `document` and the integrity fields can
        // never drift apart.
        const digestBuffer = await crypto.subtle.digest("SHA-256", canonicalBytes);
        const digest = `sha256:${Buffer.from(digestBuffer).toString("hex")}`;
        const retrievedAt = new Date().toISOString();
        const text = new TextDecoder().decode(canonicalBytes);

        // Strict decode: `JSON.parse` silently keeps the last of a duplicate
        // key and ignores trailing data, either of which could smuggle a
        // tampered/ambiguous document past this resolver. Both are
        // definitive-rejection outcomes (`ResolutionRejectedError`), not
        // transient ones — the registry served bytes that were reached, just
        // not a valid document.
        let parsedBody: unknown;
        try {
            parsedBody = strictJsonParse(text);
        } catch (err) {
            if (err instanceof StrictJsonError) {
                throw new ResolutionRejectedError(
                    "malformed-document",
                    `DID resolution failed for "${did}": malformed document (${err.reason}: ${err.message})`,
                );
            }
            throw err;
        }

        if (
            typeof parsedBody !== "object" ||
            parsedBody === null ||
            Array.isArray(parsedBody) ||
            typeof (parsedBody as Record<string, unknown>).id !== "string"
        ) {
            throw new ResolutionRejectedError(
                "malformed-document",
                `DID resolution failed for "${did}": document is not an object with a string "id"`,
            );
        }
        const document = parsedBody as DidDocument;

        // Byte-exact comparison — no normalization (rule auth.resolve.id-equality).
        // A document whose `id` doesn't match the requested DID is a
        // definitive rejection: either the registry served the wrong
        // document, or something upstream tampered with routing/content.
        if (document.id !== did) {
            throw new ResolutionRejectedError(
                "id-mismatch",
                `DID resolution failed for "${did}": document id "${document.id}" does not match requested DID`,
            );
        }

        // finalOrigin came back from boundedFetch (derived from res.url,
        // falling back to the requested URL's origin for fetch mocks/
        // environments that leave res.url unset).
        const snapshotRef = `registry:${finalOrigin}#${digest}`;

        return {
            document,
            canonicalBytes,
            digest,
            requestedDid: did,
            finalOrigin,
            snapshotRef,
            retrievedAt,
        };
    }
}
