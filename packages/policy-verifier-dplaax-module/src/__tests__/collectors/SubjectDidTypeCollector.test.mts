import { describe, expect, it } from "vitest";
import type { CollectorContext, VerifierPayload } from "@o3co/auth.policy-verifier.core";
import { SubjectDidTypeCollector } from "../../collectors/SubjectDidTypeCollector.mjs";
import { ATTR_SUBJECT_DID_TYPE } from "../../keys.mjs";

function makeContext(sub?: string): CollectorContext {
  return {
    payload: { sub, token: "dummy", tokenType: "Bearer" } satisfies VerifierPayload,
    resource: { raw: "test:1", resourceType: "test", resourceId: "1" },
    action: "read",
  };
}

describe("SubjectDidTypeCollector", () => {
  const collector = new SubjectDidTypeCollector();

  // --- backward-compatible: org accountType still works ---

  it("emits 'owner' for an org-accountType owner DID", async () => {
    const attrs = await collector.collect(makeContext("did:dplaax:r1:org:alice"));
    expect(attrs.get(ATTR_SUBJECT_DID_TYPE)).toBe("owner");
  });

  it("emits 'pipeline' for an org-accountType pipeline DID", async () => {
    const attrs = await collector.collect(makeContext("did:dplaax:r1:org:alice:pipeline:p1"));
    expect(attrs.get(ATTR_SUBJECT_DID_TYPE)).toBe("pipeline");
  });

  it("emits 'process' for an org-accountType process DID", async () => {
    const attrs = await collector.collect(
      makeContext("did:dplaax:r1:org:alice:pipeline:p1:process:x1"),
    );
    expect(attrs.get(ATTR_SUBJECT_DID_TYPE)).toBe("process");
  });

  // --- accountType-independent classification (new requirement) ---

  it("emits 'owner' for an arbitrary accountType owner DID", async () => {
    // accountType 'foo' is not 'org', but resource hierarchy is owner (no resourcePath)
    const attrs = await collector.collect(makeContext("did:dplaax:r1:foo:bob"));
    expect(attrs.get(ATTR_SUBJECT_DID_TYPE)).toBe("owner");
  });

  it("emits 'pipeline' for an arbitrary accountType pipeline DID", async () => {
    const attrs = await collector.collect(makeContext("did:dplaax:r1:foo:bob:pipeline:p1"));
    expect(attrs.get(ATTR_SUBJECT_DID_TYPE)).toBe("pipeline");
  });

  it("emits 'process' for an arbitrary accountType process DID", async () => {
    const attrs = await collector.collect(
      makeContext("did:dplaax:r1:foo:bob:pipeline:p1:process:x1"),
    );
    expect(attrs.get(ATTR_SUBJECT_DID_TYPE)).toBe("process");
  });

  // --- unknown resourcePath pattern: parser accepts, classifier rejects ---

  it("emits nothing for an unknown resourcePath pattern (foo:bar)", async () => {
    // Parser accepts this (valid structure), but 'foo:bar' is not owner/pipeline/process
    const attrs = await collector.collect(makeContext("did:dplaax:r1:org:acme:foo:bar"));
    expect(attrs.size).toBe(0);
  });

  // --- structural rejection by parser ---

  it("emits nothing when sub is absent", async () => {
    const attrs = await collector.collect(makeContext());
    expect(attrs.size).toBe(0);
  });

  it("emits nothing for a sub that is not a did:dplaax DID", async () => {
    const attrs = await collector.collect(makeContext("did:example:alice"));
    expect(attrs.size).toBe(0);
  });

  it("emits nothing for a 4-segment legacy-format DID (parser rejects: < 5 segments)", async () => {
    // did:dplaax:org:abc123 is only 4 segments — parser requires at least 5
    const attrs = await collector.collect(makeContext("did:dplaax:org:abc123"));
    expect(attrs.size).toBe(0);
  });

  it("emits nothing for a process-shaped DID missing the pipeline marker", async () => {
    // resourcePath 'foo:p1:process:x1' does not match any known pattern
    const attrs = await collector.collect(makeContext("did:dplaax:r1:org:alice:foo:p1:process:x1"));
    expect(attrs.size).toBe(0);
  });

  it("emits nothing for a DID with empty segments", async () => {
    // account ID must be non-empty — isSafeSegment rejects empty strings
    const attrs = await collector.collect(makeContext("did:dplaax:r1:org:"));
    expect(attrs.size).toBe(0);
  });
});
