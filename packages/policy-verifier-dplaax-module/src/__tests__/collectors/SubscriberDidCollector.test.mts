import { describe, expect, it } from "vitest";
import type { CollectorContext, VerifierPayload } from "@o3co/auth.policy-verifier.core";
import { SubscriberDidCollector } from "../../collectors/SubscriberDidCollector.mjs";
import { ATTR_SUBSCRIBER_DID } from "../../keys.mjs";

function makeContext(requestContext?: Record<string, unknown>): CollectorContext {
  return {
    payload: { token: "dummy", tokenType: "Bearer" } satisfies VerifierPayload,
    resource: { raw: "test:1", resourceType: "test", resourceId: "1" },
    action: "read",
    requestContext,
  };
}

describe("SubscriberDidCollector", () => {
  const collector = new SubscriberDidCollector();

  it("emits requestContext.subscriber_did under ATTR_SUBSCRIBER_DID", async () => {
    const attrs = await collector.collect(
      makeContext({ subscriber_did: "did:dplaax:r1:org:alice" }),
    );
    expect(attrs.get(ATTR_SUBSCRIBER_DID)).toBe("did:dplaax:r1:org:alice");
  });

  it("returns empty attrs when requestContext is absent", async () => {
    const attrs = await collector.collect(makeContext());
    expect(attrs.size).toBe(0);
  });

  it("returns empty attrs when subscriber_did is missing from requestContext", async () => {
    const attrs = await collector.collect(makeContext({ other: "value" }));
    expect(attrs.size).toBe(0);
  });

  it("returns empty attrs when subscriber_did is not a string", async () => {
    const attrs = await collector.collect(makeContext({ subscriber_did: 12345 }));
    expect(attrs.size).toBe(0);
  });

  it("returns empty attrs when subscriber_did is an empty string", async () => {
    const attrs = await collector.collect(makeContext({ subscriber_did: "" }));
    expect(attrs.size).toBe(0);
  });
});
