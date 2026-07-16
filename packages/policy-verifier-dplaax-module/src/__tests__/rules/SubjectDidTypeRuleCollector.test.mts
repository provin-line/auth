import { describe, expect, it } from "vitest";
import type { CollectorContext, VerifierPayload } from "@o3co/auth.policy-verifier.core";
import { SubjectDidTypeRuleCollector } from "../../rules/SubjectDidTypeRuleCollector.mjs";
import { ATTR_SUBJECT_DID_TYPE } from "../../keys.mjs";

function makeContext(resource: string, action: string): CollectorContext {
  return {
    payload: { token: "dummy", tokenType: "Bearer" } satisfies VerifierPayload,
    resource: { raw: resource, resourceType: resource.split(".")[0] ?? resource },
    action,
  };
}

describe("SubjectDidTypeRuleCollector", () => {
  const collector = new SubjectDidTypeRuleCollector({
    rules: [
      {
        resource: "registry.chain.peer",
        action: "create",
        allowedTypes: ["owner"],
      },
      {
        resource: "registry.chain.peer",
        action: "*",
        allowedTypes: ["owner", "pipeline"],
      },
    ],
  });

  it("produces a rule for an exact resource+action match", async () => {
    const rules = await collector.collect(makeContext("registry.chain.peer", "create"));
    expect(rules).toHaveLength(1);
    // The emitted rule is a builtins AttrLiteralIn over ATTR_SUBJECT_DID_TYPE.
    // Its default ruleType follows the builtins scheme:
    //   attr_literal_in:{a}:{type}:{count}:{hashPrefix}
    expect(rules[0].ruleType).toMatch(
      /^attr_literal_in:subjectDidType:string:\d+:[0-9a-f]{8}$/,
    );
    expect(rules[0].code).toBe("attr_not_in_set");
  });

  it("produces a rule for a wildcard action match when no exact entry exists", async () => {
    const rules = await collector.collect(makeContext("registry.chain.peer", "read"));
    expect(rules).toHaveLength(1);
  });

  it("produces no rules when resource does not match", async () => {
    const rules = await collector.collect(makeContext("registry.chain.other", "create"));
    expect(rules).toHaveLength(0);
  });

  it("produced rule is context-free — its decision depends only on attrs", async () => {
    const rules = await collector.collect(makeContext("registry.chain.peer", "create"));
    expect(rules[0].verify(new Map([[ATTR_SUBJECT_DID_TYPE, "owner"]]))).toBe(true);
    expect(rules[0].verify(new Map([[ATTR_SUBJECT_DID_TYPE, "pipeline"]]))).toBe(false);
  });

  it("prefers exact action match over wildcard regardless of config order", async () => {
    // Exact entry produces allowedTypes=["owner"].
    // The wildcard entry listed right after would produce allowedTypes=["owner", "pipeline"].
    // For action="create", the exact entry must win (deny for "pipeline"), even though
    // the wildcard would also match.
    const rules = await collector.collect(makeContext("registry.chain.peer", "create"));
    expect(rules).toHaveLength(1);
    expect(rules[0].verify(new Map([[ATTR_SUBJECT_DID_TYPE, "pipeline"]]))).toBe(false);
  });

  it("prefers exact action match even when wildcard is listed before exact in config", async () => {
    // Same rules as above but reversed order. The exact entry must still win.
    const reversed = new SubjectDidTypeRuleCollector({
      rules: [
        {
          resource: "registry.chain.peer",
          action: "*",
          allowedTypes: ["owner", "pipeline"],
        },
        {
          resource: "registry.chain.peer",
          action: "create",
          allowedTypes: ["owner"],
        },
      ],
    });
    const rules = await reversed.collect(makeContext("registry.chain.peer", "create"));
    expect(rules).toHaveLength(1);
    // Exact entry should win → pipeline denied.
    expect(rules[0].verify(new Map([[ATTR_SUBJECT_DID_TYPE, "pipeline"]]))).toBe(false);
  });

  it("falls back to wildcard when no exact entry matches the action", async () => {
    const reversed = new SubjectDidTypeRuleCollector({
      rules: [
        {
          resource: "registry.chain.peer",
          action: "*",
          allowedTypes: ["owner", "pipeline"],
        },
        {
          resource: "registry.chain.peer",
          action: "create",
          allowedTypes: ["owner"],
        },
      ],
    });
    const rules = await reversed.collect(makeContext("registry.chain.peer", "read"));
    expect(rules).toHaveLength(1);
    // No exact "read" entry → wildcard applies → pipeline allowed.
    expect(rules[0].verify(new Map([[ATTR_SUBJECT_DID_TYPE, "pipeline"]]))).toBe(true);
  });
});
