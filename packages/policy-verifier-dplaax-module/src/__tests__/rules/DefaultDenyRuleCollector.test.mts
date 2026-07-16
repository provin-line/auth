import { describe, expect, it } from "vitest";
import type { CollectorContext, VerifierPayload } from "@o3co/auth.policy-verifier.core";
import { evaluate } from "@o3co/auth.policy-verifier.core";
import { DefaultDenyRuleCollector } from "../../rules/DefaultDenyRuleCollector.mjs";

function makeContext(resource: string, action: string): CollectorContext {
  return {
    payload: { token: "dummy", tokenType: "Bearer" } satisfies VerifierPayload,
    resource: { raw: resource, resourceType: resource.split(".")[0] ?? resource },
    action,
  };
}

describe("DefaultDenyRuleCollector", () => {
  const collector = new DefaultDenyRuleCollector({
    surface: [
      { resource: "dids", action: "register" },
      { resource: "dids", action: "read" },
      { resource: "audit", action: "*" },
    ],
  });

  it("abstains (no rules) for a declared resource+action", async () => {
    const rules = await collector.collect(makeContext("dids", "register"));
    expect(rules).toHaveLength(0);
  });

  it("emits a deny rule for an undeclared action on a declared resource", async () => {
    const rules = await collector.collect(makeContext("dids", "revoke"));
    expect(rules).toHaveLength(1);
    expect(rules[0].verify(new Map())).toBe(false);
  });

  it("emits a deny rule for an undeclared resource", async () => {
    const rules = await collector.collect(makeContext("nonexistent", "read"));
    expect(rules).toHaveLength(1);
    expect(rules[0].verify(new Map())).toBe(false);
  });

  it("treats a wildcard surface entry as declaring every action on the resource", async () => {
    const rules = await collector.collect(makeContext("audit", "anything"));
    expect(rules).toHaveLength(0);
  });

  it("denies everything when the surface is empty (fail-closed)", async () => {
    const empty = new DefaultDenyRuleCollector({ surface: [] });
    const rules = await empty.collect(makeContext("dids", "read"));
    expect(rules).toHaveLength(1);
    expect(rules[0].verify(new Map())).toBe(false);
  });

  it("deny rule is unconditional — verify() is false for any attrs", async () => {
    const rules = await collector.collect(makeContext("nonexistent", "read"));
    const attrs = new Map<string, unknown>([
      ["scope", "dids:read"],
      ["subject_did", "did:dplaax:r:org:acme"],
    ]);
    expect(rules[0].verify(attrs)).toBe(false);
  });

  it("uses a dedicated ruleType so no other collector's rule can OR it away", async () => {
    const rules = await collector.collect(makeContext("nonexistent", "read"));
    expect(rules[0].ruleType).toBe("default_deny");
    expect(rules[0].code).toBe("undeclared_resource_action");
    // The message names the offending pair so a denied operator can see
    // exactly what to declare.
    expect(rules[0].message).toContain("nonexistent");
    expect(rules[0].message).toContain("read");
  });

  it("forces deny through core evaluate() even when other rule groups pass", async () => {
    const denyRules = await collector.collect(makeContext("nonexistent", "read"));
    const passingRule = {
      ruleType: "scope",
      code: "scope_missing",
      message: "scope check",
      verify: () => true,
    };
    const decision = evaluate(new Map(), [passingRule, ...denyRules]);
    expect(decision).toEqual({
      decision: "deny",
      code: "undeclared_resource_action",
      message: expect.stringContaining("nonexistent"),
    });
  });

  it("evaluate() allows a declared pair when the other groups pass (abstention)", async () => {
    const denyRules = await collector.collect(makeContext("dids", "read"));
    const passingRule = {
      ruleType: "scope",
      code: "scope_missing",
      message: "scope check",
      verify: () => true,
    };
    const decision = evaluate(new Map(), [passingRule, ...denyRules]);
    expect(decision).toEqual({ decision: "allow" });
  });
});

describe("dplaaxModule DefaultDenyRuleCollector registration", () => {
  async function initRegistries() {
    const { dplaaxModule } = await import("../../module.mjs");
    const ruleFactories = new Map<string, (config: unknown) => unknown>();
    const context = {
      attributeCollectorRegistry: { register: () => {} },
      ruleCollectorRegistry: {
        register: (name: string, factory: (config: unknown) => unknown) => {
          ruleFactories.set(name, factory);
        },
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal ModuleContext stub
    await dplaaxModule.init(context as any);
    return ruleFactories;
  }

  it("registers DefaultDenyRuleCollector and parses a valid config", async () => {
    const factories = await initRegistries();
    const factory = factories.get("DefaultDenyRuleCollector");
    expect(factory).toBeDefined();
    const instance = factory?.({
      surface: [{ resource: "dids", action: "read" }],
    });
    expect(instance).toBeInstanceOf(DefaultDenyRuleCollector);
  });

  it("rejects a config without a surface array", async () => {
    const factories = await initRegistries();
    const factory = factories.get("DefaultDenyRuleCollector");
    expect(() => factory?.({})).toThrow(/surface/);
    expect(() => factory?.({ surface: "everything" })).toThrow(/surface/);
  });

  it("rejects a surface entry missing resource or action", async () => {
    const factories = await initRegistries();
    const factory = factories.get("DefaultDenyRuleCollector");
    expect(() => factory?.({ surface: [{ resource: "dids" }] })).toThrow(/index 0/);
  });

  it("rejects a surface entry with an empty resource or action (fail loud at boot)", async () => {
    // An empty string can never match a real request (the server 400-rejects
    // empty resource/action before dispatch), so the entry the operator meant
    // to declare would silently stay denied. Reject at parse instead.
    const factories = await initRegistries();
    const factory = factories.get("DefaultDenyRuleCollector");
    expect(() => factory?.({ surface: [{ resource: "", action: "read" }] })).toThrow(/index 0/);
    expect(() => factory?.({ surface: [{ resource: "dids", action: "" }] })).toThrow(/index 0/);
  });
});
