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
 * did:dplaax parser.
 *
 * Format: did:dplaax:{registry}:{accountType}:{accountId}[:{resourcePath}]
 * Parser responsibility: structural decomposition + segment-safety check.
 * accountType allow-list enforcement belongs to the validator (validate.mts).
 * Resource hierarchy classification belongs to caller (e.g. policy-verifier).
 */

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const DOT_ONLY = /^\.+$/;

function isSafeSegment(s: string): boolean {
    return SAFE_SEGMENT.test(s) && !DOT_ONLY.test(s);
}

export interface ParsedDplaaxDid {
    /**
     * The original input string passed to `parseDplaaxDid`. Preserved so
     * downstream error formatters (`requireOwner` / `requireKnownPattern`)
     * can quote the actual input verbatim instead of re-stringifying from
     * individual fields — re-stringification could "lie" if a caller hand-
     * constructed a `ParsedDplaaxDid` with mismatching segments (auth#24).
     *
     * Contract: `raw` is **authoritative for diagnostic output**. The other
     * fields are the parser's view of `raw` at parse time. For values
     * returned by `parseDplaaxDid` the two views are consistent — and
     * `parseDplaaxDid(d.raw)` round-trips to a deep-equal struct. For
     * hand-constructed values the two views may diverge; `raw` wins in
     * error messages, the other fields are NOT re-validated against it.
     */
    raw: string;
    method: "dplaax";
    registry: string;
    accountType: string;
    accountId: string;
    resourcePath: string[];
}

export function parseDplaaxDid(did: string): ParsedDplaaxDid {
    const parts = did.split(":");

    if (parts[1] !== "dplaax") {
        throw new Error(`"${did}" is not a did:dplaax DID`);
    }
    if (parts[0] !== "did") {
        throw new Error(`malformed did:dplaax DID: "${did}"`);
    }
    if (parts.length < 5) {
        throw new Error(`malformed did:dplaax DID: too few segments: "${did}"`);
    }

    const [, , registry, accountType, accountId, ...rest] = parts;

    if (!registry) throw new Error(`empty registry segment: "${did}"`);
    if (!accountType) throw new Error(`empty accountType segment: "${did}"`);
    if (!accountId) throw new Error(`empty accountId segment: "${did}"`);
    if (!isSafeSegment(registry)) throw new Error(`unsafe registry segment: "${did}"`);
    if (!isSafeSegment(accountType)) throw new Error(`unsafe accountType segment: "${did}"`);
    if (!isSafeSegment(accountId)) throw new Error(`unsafe accountId segment: "${did}"`);

    for (const seg of rest) {
        if (!seg) throw new Error(`empty resourcePath segment: "${did}"`);
        if (!isSafeSegment(seg)) throw new Error(`unsafe resourcePath segment: "${did}"`);
    }

    return {
        raw: did,
        method: "dplaax",
        registry,
        accountType,
        accountId,
        resourcePath: rest,
    };
}
