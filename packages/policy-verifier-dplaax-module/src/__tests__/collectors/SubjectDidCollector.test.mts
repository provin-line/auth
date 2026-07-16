import { describe, expect, it } from "vitest";
import type { CollectorContext, VerifierPayload } from "@o3co/auth.policy-verifier.core";
import { SubjectDidCollector } from "../../collectors/SubjectDidCollector.mjs";
import { ATTR_SUBJECT_DID } from "../../keys.mjs";

function makeContext(sub?: string): CollectorContext {
  return {
    payload: { sub, token: "dummy", tokenType: "Bearer" } satisfies VerifierPayload,
    resource: { raw: "test:1", resourceType: "test", resourceId: "1" },
    action: "read",
  };
}

describe("SubjectDidCollector", () => {
  const collector = new SubjectDidCollector();

  it("emits payload.sub to ATTR_SUBJECT_DID when it is a DID (did: prefix)", async () => {
    const attrs = await collector.collect(makeContext("did:dplaax:r1:org:alice"));
    expect(attrs.get(ATTR_SUBJECT_DID)).toBe("did:dplaax:r1:org:alice");
  });

  it("emits for any W3C DID method, not only did:dplaax", async () => {
    // SubjectDidCollector asserts 'sub is a DID', it does not judge which method.
    const attrs = await collector.collect(makeContext("did:ethr:0xabc"));
    expect(attrs.get(ATTR_SUBJECT_DID)).toBe("did:ethr:0xabc");
  });

  it("emits nothing when sub is absent", async () => {
    const attrs = await collector.collect(makeContext());
    expect(attrs.size).toBe(0);
  });

  it("emits nothing when sub is not a DID (no did: prefix)", async () => {
    const attrs = await collector.collect(makeContext("user-123"));
    expect(attrs.size).toBe(0);
  });

  it("emits nothing when sub is an empty string", async () => {
    const attrs = await collector.collect(makeContext(""));
    expect(attrs.size).toBe(0);
  });

  it("rejects malformed DID with only 'did:' (no method)", async () => {
    // W3C DID syntax requires at least did:<method>:<method-specific-id>.
    // "did:" alone is not a valid DID.
    const attrs = await collector.collect(makeContext("did:"));
    expect(attrs.size).toBe(0);
  });
});
