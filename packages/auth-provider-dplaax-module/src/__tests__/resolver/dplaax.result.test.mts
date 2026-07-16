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
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: status >= 200 && status < 300,
                status,
                text: async () => body,
            }),
        );
    }

    it("returns canonical bytes, digest, origin, snapshot and freshness refs", async () => {
        const body = `{"id":"did:dplaax:u:alice","verificationMethod":[]}`;
        stubFetchOnce(200, body);

        const r = await resolver.resolve(did);

        expect(new TextDecoder().decode(r.canonicalBytes)).toBe(body);
        expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(r.requestedDid).toBe(did);
        expect(r.finalOrigin).toBe("https://registry.example");
        expect(r.snapshotRef).toBe(`registry:${r.finalOrigin}#${r.digest}`);
        expect(Date.parse(r.retrievedAt)).not.toBeNaN();
        expect(r.document.id).toBe("did:dplaax:u:alice");
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
});
