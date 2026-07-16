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
 * dplaax DID validator (forward-compatible API).
 *
 * Currently checks accountType allow-list membership. Cross-field rules,
 * schema-driven validation, or accountType-specific resource rules can
 * be added here without changing the API or callers.
 */

import type { ParsedDplaaxDid } from "./parse.mjs";

/**
 * Internal allow-list. Intentionally NOT exported so external code cannot
 * mutate it (neither via direct assignment to an array element nor by
 * rebinding the module export). Use getSupportedAccountTypes() for
 * introspection.
 */
const supportedAccountTypes = Object.freeze(["org"] as const);
export type SupportedAccountType = (typeof supportedAccountTypes)[number];

/**
 * Returns the currently-supported accountType values. The returned array is
 * a defensive copy; modifications do not affect validation.
 */
export function getSupportedAccountTypes(): string[] {
    return [...supportedAccountTypes];
}

export function isSupportedAccountType(
    t: string,
): t is SupportedAccountType {
    return (supportedAccountTypes as readonly string[]).includes(t);
}

export function validateDplaaxDid(d: ParsedDplaaxDid): void {
    if (!isSupportedAccountType(d.accountType)) {
        throw new Error(
            `unsupported accountType: "${d.accountType}" (supported: ${supportedAccountTypes.join(", ")})`,
        );
    }
}

/**
 * Classifies a parsed dplaax DID by resource hierarchy shape.
 * accountType is orthogonal and does not affect classification.
 */
export function classifyDplaaxDid(
    d: ParsedDplaaxDid,
): "owner" | "pipeline" | "process" | null {
    const rp = d.resourcePath;
    if (rp.length === 0) return "owner";
    if (rp.length === 2 && rp[0] === "pipeline") return "pipeline";
    if (rp.length === 4 && rp[0] === "pipeline" && rp[2] === "process") {
        return "process";
    }
    return null;
}

/**
 * Throws if d is not a known DID hierarchy pattern (owner, pipeline, or
 * process). Forward-compat: new resource types are supported by extending
 * classifyDplaaxDid — caller code does not need changes.
 */
export function requireKnownPattern(d: ParsedDplaaxDid): void {
    if (classifyDplaaxDid(d) === null) {
        // auth#24: quote d.raw so the error reflects the actual parser
        // input. Earlier impl reconstructed the DID from registry +
        // accountType + accountId + resourcePath, which could "lie" if a
        // caller hand-constructed a ParsedDplaaxDid with mismatching
        // segments (e.g., registry containing ":"). raw is set by
        // parseDplaaxDid from the verbatim input it received.
        throw new Error(`unrecognized DID hierarchy pattern: "${d.raw}"`);
    }
}

/**
 * Throws if d is not an owner DID (resourcePath must be empty).
 * Use at entry points that must reject resource DIDs (e.g. OAuth identity
 * resolution: pipeline/process are Signer API concerns, not OAuth subjects).
 */
export function requireOwner(d: ParsedDplaaxDid): void {
    if (classifyDplaaxDid(d) !== "owner") {
        // auth#24: see requireKnownPattern above.
        throw new Error(`owner DID required, got: "${d.raw}"`);
    }
}
