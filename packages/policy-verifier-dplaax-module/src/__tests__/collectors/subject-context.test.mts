import { describe, expect, it } from "vitest";
import type { CollectorContext } from "@o3co/auth.policy-verifier.core";
import * as core from "@o3co/auth.policy-verifier.core";
import { SubscriberDidCollector } from "../../collectors/SubscriberDidCollector.mjs";
import { SubjectDidCollector } from "../../collectors/SubjectDidCollector.mjs";
import { SubjectDidTypeCollector } from "../../collectors/SubjectDidTypeCollector.mjs";
import { ATTR_SUBJECT_DID, ATTR_SUBJECT_DID_TYPE, ATTR_SUBSCRIBER_DID } from "../../keys.mjs";

const mark = Reflect.get(core, "markUntrustedRequestContext") as
  ((raw: Record<string, unknown>) => unknown) | undefined;

describe("verified subject context compatibility", () => {
  it.skipIf(!mark)("reads a marked subscriber while refusing an unmarked record", async () => {
    const base = {
      subject: {},
      resource: { raw: "test", resourceType: "test" },
      action: "read",
      signal: new AbortController().signal,
    };
    const raw = { subscriber_did: "did:dplaax:r1:org:alice" };
    const collector = new SubscriberDidCollector();
    const marked = { ...base, requestContext: mark!(raw) } as unknown as CollectorContext;
    const unmarked = { ...base, requestContext: raw } as unknown as CollectorContext;
    expect((await collector.collect(marked)).get(ATTR_SUBSCRIBER_DID)).toBe(raw.subscriber_did);
    expect((await collector.collect(unmarked)).size).toBe(0);
  });

  it("reads current verified subject claims for both DID collectors", async () => {
    const context = {
      subject: { sub: "did:dplaax:r1:org:alice" },
      resource: { raw: "test", resourceType: "test" },
      action: "read",
      signal: new AbortController().signal,
    } as unknown as CollectorContext;
    expect((await new SubjectDidCollector().collect(context)).get(ATTR_SUBJECT_DID))
      .toBe("did:dplaax:r1:org:alice");
    expect((await new SubjectDidTypeCollector().collect(context)).get(ATTR_SUBJECT_DID_TYPE))
      .toBe("owner");
  });

  it("never falls back to a legacy payload when the subject is present", async () => {
    const context = {
      subject: {},
      payload: { sub: "did:dplaax:r1:org:spoofed" },
      resource: { raw: "test", resourceType: "test" },
      action: "read",
      signal: new AbortController().signal,
    } as unknown as CollectorContext;
    expect((await new SubjectDidCollector().collect(context)).size).toBe(0);
    expect((await new SubjectDidTypeCollector().collect(context)).size).toBe(0);
  });
});
