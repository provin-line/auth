import { describe, it, expect } from "vitest";
import { parseDplaaxDid, type ParsedDplaaxDid } from "../parse.mjs";
import {
    classifyDplaaxDid,
    getSupportedAccountTypes,
    isSupportedAccountType,
    requireKnownPattern,
    requireOwner,
    validateDplaaxDid,
} from "../validate.mjs";

describe("getSupportedAccountTypes", () => {
    it("currently returns ['org']", () => {
        expect(getSupportedAccountTypes()).toEqual(["org"]);
    });

    it("returns a defensive copy (mutation does not affect validation)", () => {
        const list = getSupportedAccountTypes();
        list.push("hacked");
        expect(getSupportedAccountTypes()).toEqual(["org"]);
    });
});

describe("isSupportedAccountType", () => {
    it("returns true for 'org'", () => {
        expect(isSupportedAccountType("org")).toBe(true);
    });

    it("returns false for unsupported values", () => {
        expect(isSupportedAccountType("user")).toBe(false);
        expect(isSupportedAccountType("")).toBe(false);
        expect(isSupportedAccountType("ORG")).toBe(false);
    });
});

describe("validateDplaaxDid", () => {
    it("passes for supported accountType", () => {
        const d = parseDplaaxDid("did:dplaax:r:org:acme");
        expect(() => validateDplaaxDid(d)).not.toThrow();
    });

    it("throws for unsupported accountType", () => {
        const d = parseDplaaxDid("did:dplaax:r:user:alice");
        expect(() => validateDplaaxDid(d)).toThrow(/unsupported accountType/i);
    });
});

describe("classifyDplaaxDid", () => {
    it.each([
        ["did:dplaax:r:org:acme", "owner"],
        ["did:dplaax:r:foo:bob", "owner"], // accountType orthogonal
        ["did:dplaax:r:org:acme:pipeline:p1", "pipeline"],
        ["did:dplaax:r:org:acme:pipeline:p1:process:x1", "process"],
    ] as const)("classifies %s as %s", (input, expected) => {
        const d = parseDplaaxDid(input);
        expect(classifyDplaaxDid(d)).toBe(expected);
    });

    it("returns null for unknown resourcePath pattern", () => {
        const d = parseDplaaxDid("did:dplaax:r:org:acme:foo:bar");
        expect(classifyDplaaxDid(d)).toBeNull();
    });
});

describe("requireKnownPattern", () => {
    it.each([
        "did:dplaax:r:org:acme",
        "did:dplaax:r:org:acme:pipeline:p1",
        "did:dplaax:r:org:acme:pipeline:p1:process:x1",
    ])("accepts %s", (input) => {
        const d = parseDplaaxDid(input);
        expect(() => requireKnownPattern(d)).not.toThrow();
    });

    it("throws for unknown resourcePath pattern", () => {
        const d = parseDplaaxDid("did:dplaax:r:org:acme:foo:bar");
        expect(() => requireKnownPattern(d)).toThrow(
            /unrecognized DID hierarchy pattern/,
        );
    });

    // auth#24: error message must reflect the input parseDplaaxDid received
    // verbatim, NOT a reconstruction from `${d.registry}:${d.accountType}:…`.
    // Re-stringification was the source of error-message lying: a future
    // caller hand-constructing a ParsedDplaaxDid with unsafe segments could
    // get an error string that looks like a valid DID but isn't.
    it("error message uses the parsed struct's raw input verbatim", () => {
        // Hand-constructed: fields intentionally don't match raw. Today's
        // impl reconstructs from fields and would say
        // "did:dplaax:DIFFERENT:org:acme:foo:bar". The contract we want is
        // that the error reflects what was originally passed to the parser.
        const dShenanigan: ParsedDplaaxDid = {
            raw: "did:dplaax:r:org:acme:foo:bar",
            method: "dplaax",
            registry: "DIFFERENT",
            accountType: "org",
            accountId: "acme",
            resourcePath: ["foo", "bar"],
        };
        const thrown = () => requireKnownPattern(dShenanigan);
        expect(thrown).toThrow('"did:dplaax:r:org:acme:foo:bar"');
        // Lock the contract harder: the *reconstructed* (lying) form must
        // not appear in the error. Without this, an impl that emits both
        // raw and reconstructed would pass the first assertion.
        expect(thrown).not.toThrow(/DIFFERENT/);
    });
});

describe("requireOwner", () => {
    it("accepts an owner DID", () => {
        const d = parseDplaaxDid("did:dplaax:r:org:acme");
        expect(() => requireOwner(d)).not.toThrow();
    });

    it("throws for a pipeline DID", () => {
        const d = parseDplaaxDid("did:dplaax:r:org:acme:pipeline:p1");
        expect(() => requireOwner(d)).toThrow(/owner DID required/);
    });

    it("throws for a process DID", () => {
        const d = parseDplaaxDid(
            "did:dplaax:r:org:acme:pipeline:p1:process:x1",
        );
        expect(() => requireOwner(d)).toThrow(/owner DID required/);
    });

    it("throws for unknown resourcePath pattern", () => {
        const d = parseDplaaxDid("did:dplaax:r:org:acme:foo:bar");
        expect(() => requireOwner(d)).toThrow(/owner DID required/);
    });

    // auth#24: symmetry with requireKnownPattern above. Error message uses
    // the raw input verbatim, not a reconstruction.
    it("error message uses the parsed struct's raw input verbatim", () => {
        const dShenanigan: ParsedDplaaxDid = {
            raw: "did:dplaax:r:org:acme:pipeline:p1",
            method: "dplaax",
            registry: "DIFFERENT",
            accountType: "org",
            accountId: "acme",
            resourcePath: ["pipeline", "p1"],
        };
        const thrown = () => requireOwner(dShenanigan);
        expect(thrown).toThrow('"did:dplaax:r:org:acme:pipeline:p1"');
        expect(thrown).not.toThrow(/DIFFERENT/);
    });
});
