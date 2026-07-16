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
import { ResolutionRejectedError, ResolutionUnavailableError } from "@provin-line/auth-provider-did";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DplaaxDidResolver } from "../../resolver/dplaax.mjs";

/**
 * Covers the `ResolutionResult` contract `resolve()` now returns (canonical
 * bytes / digest / origin / snapshot & freshness refs) and the two-class
 * error taxonomy (`ResolutionUnavailableError` -> INDETERMINATE,
 * `ResolutionRejectedError` -> FAILED) that later tasks build on.
 * `resolver.test.mts` keeps covering owner-only enforcement, registry
 * allow-list, and URL building — unaffected by this change apart from mock
 * plumbing (`.json()` -> `.text()`, bare result -> `result.document`).
 */
describe("DplaaxDidResolver — ResolutionResult", () => {
    const registryBaseUrl = "https://registry.example";
    const resolver = new DplaaxDidResolver(registryBaseUrl);

    // The brief's illustrative DID ("did:dplaax:u:alice") has only 4 segments
    // and fails parseDplaaxDid's `did:dplaax:{registry}:{accountType}:{accountId}`
    // grammar ("too few segments" — see packages/did-dplaax/src/parse.mts).
    // Adapted to a valid DID whose registry segment matches registryBaseUrl's
    // host; every other literal below (body, digest/snapshotRef shape,
    // finalOrigin) is verbatim from the task brief.
    const did = "did:dplaax:registry.example:u:alice";

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubFetchOnce(status: number, body: string): void {
        const bytes = new TextEncoder().encode(body);
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: status >= 200 && status < 300,
                status,
                text: async () => body,
                arrayBuffer: async () => bytes.buffer,
            }),
        );
    }

    // Mocks a response backed by raw wire bytes, with BOTH `text()` and
    // `arrayBuffer()` available — mirroring real fetch/undici, where
    // `text()` decodes via TextDecoder (BOM-stripping per WHATWG Encoding)
    // while `arrayBuffer()` hands back the untouched bytes. This lets the
    // test fail with a meaningful assertion (canonicalBytes missing the
    // BOM) against the current `res.text()`-based implementation, rather
    // than a TypeError from an incomplete mock.
    function stubFetchOnceBytes(status: number, bytes: Uint8Array): void {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: status >= 200 && status < 300,
                status,
                text: async () => new TextDecoder().decode(bytes),
                arrayBuffer: async () => bytes.buffer,
            }),
        );
    }

    it("returns canonical bytes, digest, origin, snapshot and freshness refs", async () => {
        const body = `{"id":"${did}","verificationMethod":[]}`;
        stubFetchOnce(200, body);

        const r = await resolver.resolve(did);

        expect(new TextDecoder().decode(r.canonicalBytes)).toBe(body);
        expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(r.requestedDid).toBe(did);
        expect(r.finalOrigin).toBe("https://registry.example");
        expect(r.snapshotRef).toBe(`registry:${r.finalOrigin}#${r.digest}`);
        expect(Date.parse(r.retrievedAt)).not.toBeNaN();
        expect(r.document.id).toBe(did);
    });

    it("preserves a leading UTF-8 BOM in canonicalBytes/digest (exact wire bytes, not text() round-trip)", async () => {
        // WHATWG Fetch's text() strips a leading BOM and replaces invalid
        // UTF-8 with U+FFFD before handing back a string — so encoding that
        // string back to bytes is NOT guaranteed to reproduce what the
        // registry served. canonicalBytes/digest must be computed over the
        // raw wire bytes (read via arrayBuffer()) to satisfy the
        // ResolutionResult contract ("the exact bytes the registry served").
        const body = `{"id":"${did}","verificationMethod":[]}`;
        const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
        const bodyBytes = new TextEncoder().encode(body);
        const wireBytes = new Uint8Array(bom.length + bodyBytes.length);
        wireBytes.set(bom, 0);
        wireBytes.set(bodyBytes, bom.length);

        stubFetchOnceBytes(200, wireBytes);

        const r = await resolver.resolve(did);

        expect(r.canonicalBytes).toEqual(wireBytes);

        const expectedDigestBuffer = await crypto.subtle.digest("SHA-256", wireBytes);
        const expectedDigest = `sha256:${Buffer.from(expectedDigestBuffer).toString("hex")}`;
        expect(r.digest).toBe(expectedDigest);

        // The parsed document is unaffected — TextDecoder().decode() (used
        // to derive the strictJsonParse input from canonicalBytes) also
        // strips a leading BOM by default, so parsing still succeeds; only
        // the provenance bytes must stay exact.
        expect(r.document.id).toBe(did);
    });

    it("maps HTTP >=500 to ResolutionUnavailableError with reason registry-5xx", async () => {
        stubFetchOnce(503, "");

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionUnavailableError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "registry-5xx" });
    });

    it("maps HTTP 404 to ResolutionRejectedError with reason did-not-found", async () => {
        stubFetchOnce(404, "");

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionRejectedError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "did-not-found" });
    });

    it("maps other HTTP 4xx to ResolutionRejectedError with reason registry-4xx", async () => {
        stubFetchOnce(400, "");

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionRejectedError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "registry-4xx" });
    });

    it("maps a network TypeError to ResolutionUnavailableError with reason network", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionUnavailableError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "network" });
    });

    // The brief's illustrative literals ("did:dplaax:u:alice" / "did:dplaax:u:mallory")
    // are 4-segment and fail parseDplaaxDid's grammar before reaching the code
    // under test (see the `did` const comment above) — adapted to 5-segment
    // DIDs whose registry segment matches registryBaseUrl's host, mismatch
    // semantics unchanged.
    it("rejects a document whose id differs from the requested DID (byte-exact)", async () => {
        const requestedDid = "did:dplaax:registry.example:u:alice";
        stubFetchOnce(200, `{"id":"did:dplaax:registry.example:u:mallory","verificationMethod":[]}`);

        await expect(resolver.resolve(requestedDid)).rejects.toThrow(ResolutionRejectedError);
        await expect(resolver.resolve(requestedDid)).rejects.toMatchObject({ reason: "id-mismatch" });
    });

    it("rejects a strict-JSON-invalid document body as malformed-document", async () => {
        stubFetchOnce(200, `{"id":"${did}","id":"dup"}`);

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionRejectedError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "malformed-document" });
    });

    it("rejects a document body that is not a JSON object as malformed-document", async () => {
        stubFetchOnce(200, `["not", "an", "object"]`);

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionRejectedError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "malformed-document" });
    });

    it("rejects a document with a non-string id as malformed-document", async () => {
        stubFetchOnce(200, `{"id":42,"verificationMethod":[]}`);

        await expect(resolver.resolve(did)).rejects.toBeInstanceOf(ResolutionRejectedError);
        await expect(resolver.resolve(did)).rejects.toMatchObject({ reason: "malformed-document" });
    });
});
