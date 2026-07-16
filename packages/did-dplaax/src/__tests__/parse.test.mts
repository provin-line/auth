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

// Parser regression suite. Owned by this package so the guards travel
// with the parser when did-dplaax is consumed out-of-tree. Previously
// these cases lived in auth-provider-dplaax-module/resolver.test.mts;
// moved here as part of auth#19 (extract did:dplaax grammar package).

import { describe, expect, it } from "vitest";
import { parseDplaaxDid } from "../parse.mjs";

describe("parseDplaaxDid", () => {
    it("parses an owner DID", () => {
        const result = parseDplaaxDid("did:dplaax:registry.acme.com:org:acme");
        expect(result).toEqual({
            raw: "did:dplaax:registry.acme.com:org:acme",
            method: "dplaax",
            registry: "registry.acme.com",
            accountType: "org",
            accountId: "acme",
            resourcePath: [],
        });
    });

    // auth#24: raw is preserved so downstream error formatters
    // (requireOwner / requireKnownPattern) reflect the actual input rather
    // than reconstructing from individual fields.
    it("preserves the original input string on the parsed struct's raw field", () => {
        const input = "did:dplaax:r:org:acme:pipeline:p1:process:x1";
        const result = parseDplaaxDid(input);
        expect(result.raw).toBe(input);
    });

    it("parses a pipeline DID", () => {
        const result = parseDplaaxDid("did:dplaax:r:org:acme:pipeline:p1");
        expect(result.resourcePath).toEqual(["pipeline", "p1"]);
    });

    it("parses a process DID", () => {
        const result = parseDplaaxDid("did:dplaax:r:org:acme:pipeline:p1:process:x1");
        expect(result.resourcePath).toEqual(["pipeline", "p1", "process", "x1"]);
    });

    it("accepts arbitrary accountType (Parser does not enforce allow-list)", () => {
        const result = parseDplaaxDid("did:dplaax:r:user:alice");
        expect(result.accountType).toBe("user");
        expect(result.accountId).toBe("alice");
    });

    it("accepts arbitrary resourcePath pattern (Parser is permissive)", () => {
        const result = parseDplaaxDid("did:dplaax:r:org:acme:foo:bar");
        expect(result.resourcePath).toEqual(["foo", "bar"]);
    });

    it("throws on non-dplaax DID", () => {
        expect(() => parseDplaaxDid("did:key:z6Mk...")).toThrow(
            '"did:key:z6Mk..." is not a did:dplaax DID',
        );
    });

    it("throws on 4-segment DID (legacy bug format)", () => {
        // Regression guard for dd0e9bd: a 4-segment input like
        // `did:dplaax:org:abc123` previously slipped through with
        // accountType missing. Must throw `too few segments`.
        expect(() => parseDplaaxDid("did:dplaax:org:abc123")).toThrow(
            /too few segments/,
        );
    });

    it("throws on empty segments", () => {
        expect(() => parseDplaaxDid("did:dplaax::org:acme")).toThrow(/empty/);
        expect(() => parseDplaaxDid("did:dplaax:r::acme")).toThrow(/empty/);
        expect(() => parseDplaaxDid("did:dplaax:r:org:")).toThrow(/empty/);
        expect(() => parseDplaaxDid("did:dplaax:r:org:acme:pipeline:")).toThrow(/empty/);
    });

    it("throws on unsafe segments (path traversal)", () => {
        expect(() => parseDplaaxDid("did:dplaax:r:org:../etc")).toThrow(/unsafe/);
        expect(() => parseDplaaxDid("did:dplaax:r:org:acme/foo")).toThrow(/unsafe/);
        expect(() => parseDplaaxDid("did:dplaax:r:..:acme")).toThrow(/unsafe/);
        expect(() => parseDplaaxDid("did:dplaax:r:org:acme:pipeline:..")).toThrow(/unsafe/);
    });
});
