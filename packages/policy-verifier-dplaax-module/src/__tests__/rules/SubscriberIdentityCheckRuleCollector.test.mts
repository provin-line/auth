import { describe, expect, it } from "vitest";
import type { CollectorContext, VerifierPayload } from "@o3co/auth.policy-verifier.core";
import { SubscriberIdentityCheckRuleCollector } from "../../rules/SubscriberIdentityCheckRuleCollector.mjs";
import { ATTR_SUBJECT_DID, ATTR_SUBSCRIBER_DID } from "../../keys.mjs";

function makeContext(resource: string, action: string): CollectorContext {
  return {
    payload: { token: "dummy", tokenType: "Bearer" } satisfies VerifierPayload,
    resource: { raw: resource, resourceType: resource.split(".")[0] ?? resource },
    action,
    // intentionally omit requestContext and payload.sub — this RuleCollector
    // must not read either. Rules receive their data via attrs.
  };
}

// The resource/action strings used as fixture data below (e.g.
// "registry.chain.peer/subscribe") are arbitrary collector inputs for
// exercising dispatch logic — they are NOT deployment-config truth.
// ChainPeerService is L2-only per docs/requirements.md § 3; the deployment
// contract that no real registry.chain.peer.* rule is configured is
// pinned by __tests__/config/configFiles.test.mts against the actual
// HOCON files. This file tests collector behavior in isolation.
describe("SubscriberIdentityCheckRuleCollector", () => {
  const collector = new SubscriberIdentityCheckRuleCollector({
    rules: [
      { resource: "registry.chain.peer", action: "subscribe" },
      { resource: "registry.chain.peer", action: "publish" },
    ],
  });

  it("produces a rule for an exact resource+action match", async () => {
    const rules = await collector.collect(makeContext("registry.chain.peer", "subscribe"));
    expect(rules).toHaveLength(1);
    // The produced rule is the shared builtins AttrMatchRule comparing
    // ATTR_SUBJECT_DID and ATTR_SUBSCRIBER_DID.
    expect(rules[0].ruleType).toBe(`attr_match:${ATTR_SUBJECT_DID}:${ATTR_SUBSCRIBER_DID}`);
    expect(rules[0].code).toBe("attr_mismatch");
  });

  it("produces a rule for any action listed for the resource", async () => {
    const rules = await collector.collect(makeContext("registry.chain.peer", "publish"));
    expect(rules).toHaveLength(1);
  });

  it("produces no rules for an action that is not listed", async () => {
    // Operations that legitimately don't require subscriber identity check
    // (e.g. disconnect) must not be listed in `rules`.
    const rules = await collector.collect(makeContext("registry.chain.peer", "disconnect"));
    expect(rules).toHaveLength(0);
  });

  it("produces no rules when resource does not match", async () => {
    const rules = await collector.collect(makeContext("registry.chain.other", "subscribe"));
    expect(rules).toHaveLength(0);
  });

  it("supports wildcard action for resources where every action requires identity check", async () => {
    const wildcardCollector = new SubscriberIdentityCheckRuleCollector({
      rules: [{ resource: "private.chain.peer", action: "*" }],
    });
    const rules = await wildcardCollector.collect(makeContext("private.chain.peer", "anything"));
    expect(rules).toHaveLength(1);
  });

  it("prefers exact action match over wildcard regardless of config order", async () => {
    // Even though the emitted rule is identical in either case today,
    // dispatch must be deterministic so future per-entry options would
    // not depend on config order.
    const reversed = new SubscriberIdentityCheckRuleCollector({
      rules: [
        { resource: "private.chain.peer", action: "*" },
        { resource: "private.chain.peer", action: "subscribe" },
      ],
    });
    const rules = await reversed.collect(makeContext("private.chain.peer", "subscribe"));
    expect(rules).toHaveLength(1);
  });

  it("produced rule is context-free — its decision depends only on attrs", async () => {
    const rules = await collector.collect(makeContext("registry.chain.peer", "subscribe"));

    const matchingAttrs = new Map<string, unknown>([
      [ATTR_SUBJECT_DID, "did:dplaax:r1:org:alice"],
      [ATTR_SUBSCRIBER_DID, "did:dplaax:r1:org:alice"],
    ]);
    expect(rules[0].verify(matchingAttrs)).toBe(true);

    const mismatchingAttrs = new Map<string, unknown>([
      [ATTR_SUBJECT_DID, "did:dplaax:r1:org:alice"],
      [ATTR_SUBSCRIBER_DID, "did:dplaax:r1:org:bob"],
    ]);
    expect(rules[0].verify(mismatchingAttrs)).toBe(false);
  });
});
