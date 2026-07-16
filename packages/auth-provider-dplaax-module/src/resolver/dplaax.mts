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
} from "@provin-line/auth-provider-did";
import { parseDplaaxDid, requireOwner } from "@provin-line/did-dplaax";

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

        // Fetch itself is untouched here (redirect/retry/TLS behaviour is
        // Task 3's job) — only what happens to the response is restructured:
        // network failures and non-2xx statuses map onto the two-class error
        // taxonomy (errors.mts) instead of throwing a bare Error.
        let res: Awaited<ReturnType<typeof fetch>>;
        try {
            res = await fetch(url);
        } catch (err) {
            if (err instanceof TypeError) {
                throw new ResolutionUnavailableError(
                    "network",
                    `DID resolution failed for "${did}": network error (${err.message})`,
                );
            }
            throw err;
        }

        if (!res.ok) {
            if (res.status >= 500) {
                throw new ResolutionUnavailableError(
                    "registry-5xx",
                    `DID resolution failed for "${did}": HTTP ${res.status}`,
                );
            }
            if (res.status === 404) {
                throw new ResolutionRejectedError(
                    "did-not-found",
                    `DID resolution failed for "${did}": HTTP ${res.status}`,
                );
            }
            throw new ResolutionRejectedError(
                "registry-4xx",
                `DID resolution failed for "${did}": HTTP ${res.status}`,
            );
        }

        // Read the body exactly once, as raw bytes — canonicalBytes/digest
        // must be the exact bytes the registry served (ResolutionResult
        // contract), and res.text() does not guarantee that: per WHATWG
        // Fetch, text() strips a leading UTF-8 BOM and replaces invalid
        // UTF-8 with U+FFFD before returning a string, so re-encoding that
        // string can silently diverge from the wire bytes. arrayBuffer()
        // has no such normalization. The JSON.parse input is decoded from
        // these same canonicalBytes below, so `document` and the integrity
        // fields can never drift apart (parsing goes strict in Task 2, but
        // this invariant holds regardless of parser).
        const canonicalBytes = new Uint8Array(await res.arrayBuffer());
        const digestBuffer = await crypto.subtle.digest("SHA-256", canonicalBytes);
        const digest = `sha256:${Buffer.from(digestBuffer).toString("hex")}`;
        const retrievedAt = new Date().toISOString();
        const text = new TextDecoder().decode(canonicalBytes);
        const document = JSON.parse(text) as DidDocument;

        // `res.url` reflects the actual connection fetch() served the bytes
        // from (e.g. after a redirect); fall back to the requested URL's
        // origin for fetch mocks/environments that leave it unset.
        const finalOrigin = new URL(res.url || url).origin;
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
