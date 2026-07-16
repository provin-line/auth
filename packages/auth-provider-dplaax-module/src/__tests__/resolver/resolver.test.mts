import { ResolutionRejectedError } from "@provin-line/auth-provider-did";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DplaaxDidResolver } from "../../resolver/dplaax.mjs";

// Parser regression suite was moved to @provin-line/did-dplaax alongside
// the parser source (auth#19). This file now covers only the resolver
// behaviour (owner-only enforcement, registry allow-list, URL building,
// HTTP error mapping). The resolver paths through parseDplaaxDid
// indirectly via the test cases below.
//
// `resolve()` now returns a `ResolutionResult` (canonical bytes / digest /
// origin / snapshot refs), not a bare `DidDocument` — mocks below stub
// `.text()` instead of `.json()`, and assertions read `result.document`.
// The full `ResolutionResult` contract and the error taxonomy
// (`ResolutionUnavailableError` / `ResolutionRejectedError`) are covered in
// dplaax.result.test.mts; the 404 case here is kept as a regression pin for
// this file's existing "HTTP error mapping" coverage.

describe("DplaaxDidResolver", () => {
    const registryBaseUrl = "https://registry.dplaax.dev";
    // DID's registry segment must match baseUrl host by default.
    const ownerDid = "did:dplaax:registry.dplaax.dev:org:acme";

    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("resolves an owner DID via HTTP (accountType-namespaced URL)", async () => {
        const didDoc = { id: ownerDid, verificationMethod: [] };
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(didDoc),
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(didDoc)).buffer,
        });

        const resolver = new DplaaxDidResolver(registryBaseUrl);
        const result = await resolver.resolve(ownerDid);

        expect(result.document).toEqual(didDoc);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${registryBaseUrl}/did/org/acme/did.json`,
        );
    });

    it("rejects pipeline DID (Resolver is owner-only)", async () => {
        const resolver = new DplaaxDidResolver(registryBaseUrl);
        await expect(
            resolver.resolve("did:dplaax:registry.dplaax.dev:org:acme:pipeline:p1"),
        ).rejects.toThrow(/owner DID/i);
    });

    it("rejects process DID (Resolver is owner-only)", async () => {
        const resolver = new DplaaxDidResolver(registryBaseUrl);
        await expect(
            resolver.resolve(
                "did:dplaax:registry.dplaax.dev:org:acme:pipeline:p1:process:x1",
            ),
        ).rejects.toThrow(/owner DID/i);
    });

    it("resolves a non-org accountType owner DID (allow-list is the registry's responsibility)", async () => {
        // requirements.md §2: the provider MUST accept any syntactically valid
        // accountType from the parser; which accountTypes exist is enforced by
        // the DID Registry at registration time. A type the registry never
        // minted simply fails resolution (404), so the provider gains no
        // safety from duplicating the allow-list — it only breaks first when
        // the registry legitimately adds a new accountType.
        const did = "did:dplaax:registry.dplaax.dev:user:alice";
        const didDoc = { id: did, verificationMethod: [] };
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(didDoc),
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(didDoc)).buffer,
        });

        const resolver = new DplaaxDidResolver(registryBaseUrl);
        const result = await resolver.resolve(did);
        expect(result.document).toEqual(didDoc);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${registryBaseUrl}/did/user/alice/did.json`,
        );
    });

    it("still rejects an unsafe accountType segment (parser guarantee)", async () => {
        // Relaxing the allow-list must not relax segment safety: the URL is
        // built from accountType, so the parser's SAFE_SEGMENT grammar is the
        // remaining (and sufficient) guard against path injection.
        const resolver = new DplaaxDidResolver(registryBaseUrl);
        await expect(
            resolver.resolve("did:dplaax:registry.dplaax.dev:u%2Fser:alice"),
        ).rejects.toThrow(/unsafe accountType segment/i);
    });

    it("rejects DID whose registry segment does not match baseUrl host (default)", async () => {
        const resolver = new DplaaxDidResolver(registryBaseUrl);
        await expect(
            resolver.resolve("did:dplaax:other-registry.example.com:org:acme"),
        ).rejects.toThrow(/registry "other-registry\.example\.com" not in allow-list/);
    });

    it("matches registry segment case-insensitively", async () => {
        // Hostnames are case-insensitive per RFC 3986. A DID with mixed-case
        // registry segment should still resolve against a lowercase baseUrl host.
        const didDoc = {
            id: "did:dplaax:Registry.Dplaax.dev:org:acme",
            verificationMethod: [],
        };
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(didDoc),
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(didDoc)).buffer,
        });

        const resolver = new DplaaxDidResolver(registryBaseUrl);
        const result = await resolver.resolve("did:dplaax:Registry.Dplaax.dev:org:acme");
        expect(result.document).toEqual(didDoc);
    });

    it("accepts DID whose registry is in allowedRegistries (migration support)", async () => {
        // Scenario: migrated from a HUB registry to our own registry.
        // Legacy DIDs still carry the old registry name — we accept them by
        // adding it to the allow-list. Callers only need to list additional
        // registries; baseHost is always included automatically.
        const didDoc = {
            id: "did:dplaax:legacy-hub.example.com:org:acme",
            verificationMethod: [],
        };
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(didDoc),
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(didDoc)).buffer,
        });

        const resolver = new DplaaxDidResolver(registryBaseUrl, {
            allowedRegistries: ["legacy-hub.example.com"],
        });
        const result = await resolver.resolve(
            "did:dplaax:legacy-hub.example.com:org:acme",
        );

        expect(result.document).toEqual(didDoc);
        // URL is built from registryBaseUrl (where the registry actually
        // lives now), not from the legacy registry name in the DID.
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${registryBaseUrl}/did/org/acme/did.json`,
        );
    });

    it("still accepts DIDs at registryBaseUrl's host when allowedRegistries is provided", async () => {
        // Regression guard: if a caller supplies only legacy hosts in
        // allowedRegistries, baseHost should still be accepted (union, not
        // substitution).
        const didDoc = {
            id: "did:dplaax:registry.dplaax.dev:org:acme",
            verificationMethod: [],
        };
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(didDoc),
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(didDoc)).buffer,
        });

        const resolver = new DplaaxDidResolver(registryBaseUrl, {
            allowedRegistries: ["legacy-hub.example.com"],
        });
        const result = await resolver.resolve("did:dplaax:registry.dplaax.dev:org:acme");
        expect(result.document).toEqual(didDoc);
    });

    it("normalizes trailing slash on registryBaseUrl", async () => {
        // Regression guard: a baseUrl configured with a trailing slash
        // should not produce a double-slash in the fetched URL.
        const didDoc = {
            id: "did:dplaax:registry.dplaax.dev:org:acme",
            verificationMethod: [],
        };
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(didDoc),
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(didDoc)).buffer,
        });

        const resolver = new DplaaxDidResolver("https://registry.dplaax.dev/");
        await resolver.resolve("did:dplaax:registry.dplaax.dev:org:acme");
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://registry.dplaax.dev/did/org/acme/did.json",
        );
    });

    it("throws on HTTP 404 error", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            status: 404,
        });

        const resolver = new DplaaxDidResolver(registryBaseUrl);
        const notFoundDid = "did:dplaax:registry.dplaax.dev:org:notfound";
        await expect(resolver.resolve(notFoundDid)).rejects.toBeInstanceOf(
            ResolutionRejectedError,
        );
        await expect(resolver.resolve(notFoundDid)).rejects.toMatchObject({
            reason: "did-not-found",
            message: `DID resolution failed for "${notFoundDid}": HTTP 404`,
        });
    });

    it("throws on non-dplaax DID", async () => {
        const resolver = new DplaaxDidResolver(registryBaseUrl);
        await expect(resolver.resolve("did:key:z6Mk...")).rejects.toThrow(
            '"did:key:z6Mk..." is not a did:dplaax DID',
        );
    });
});
