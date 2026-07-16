import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFile } from "@o3co/ts.hocon";
import { describe, expect, it } from "vitest";

// SECURITY pin (dPLaaX D-1): the upstream evaluator ALLOWS a request when
// zero rules are collected, so a deployment without a fail-closed default
// silently allows every (resource, action) nobody wrote a policy for. The
// scaffold therefore ships DefaultDenyRuleCollector enabled with a non-empty
// declared surface, and this test pins that. Removing the collector or
// emptying its surface is a deliberate, security-relevant act — if you are
// editing this test to make that pass, stop and read the SECURITY NOTE in
// config/application.conf and docs/requirements.md first.
//
// Like configFiles.test.mts (same directory), every config/*.conf is
// checked, not just application.conf: env overlays are loaded via
// withFallback and HOCON replaces a list wholesale, so an overlay declaring
// `rule.collectors` WITHOUT the collector would defeat the fail-closed
// default in that environment while an application.conf-only pin stayed
// green.

const CONFIG_DIR_URL = new URL("../../../config/", import.meta.url);

interface CollectorEntry {
  collector?: unknown;
  surface?: unknown;
}

function configFilePaths(): string[] {
  const dir = fileURLToPath(CONFIG_DIR_URL);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".conf"))
    .map((name) => fileURLToPath(new URL(name, CONFIG_DIR_URL)));
}

function collectorsOf(path: string): CollectorEntry[] | undefined {
  const conf = parseFile(path);
  try {
    return conf.getList("rule.collectors") as CollectorEntry[];
  } catch {
    // The file does not declare rule.collectors at all (typical overlay) —
    // withFallback keeps application.conf's list, so it cannot remove the
    // collector.
    return undefined;
  }
}

function findDefaultDeny(collectors: CollectorEntry[]): CollectorEntry | undefined {
  return collectors.find((c) => c.collector === "DefaultDenyRuleCollector");
}

describe("config/*.conf DefaultDenyRuleCollector", () => {
  it("application.conf declares DefaultDenyRuleCollector with a non-empty surface", () => {
    const path = fileURLToPath(new URL("application.conf", CONFIG_DIR_URL));
    const collectors = collectorsOf(path);
    expect(collectors, "application.conf must declare rule.collectors").toBeDefined();

    const defaultDeny = findDefaultDeny(collectors ?? []);
    expect(
      defaultDeny,
      "DefaultDenyRuleCollector must stay enabled in the scaffold (fail-closed default)",
    ).toBeDefined();

    const surface = defaultDeny?.surface;
    expect(Array.isArray(surface)).toBe(true);
    expect(
      (surface as unknown[]).length,
      "the declared surface must not be empty — an empty surface denies everything, including the deployment's own RPCs",
    ).toBeGreaterThan(0);
  });

  it.each(configFilePaths())(
    "%s does not override rule.collectors away from the fail-closed default",
    (path) => {
      const collectors = collectorsOf(path);
      if (collectors === undefined) return; // declares nothing — cannot remove it

      const defaultDeny = findDefaultDeny(collectors);
      expect(
        defaultDeny,
        `${path} declares rule.collectors (HOCON replaces the list wholesale) but drops DefaultDenyRuleCollector — the fail-closed default would be lost in this environment`,
      ).toBeDefined();
      expect(Array.isArray(defaultDeny?.surface)).toBe(true);
      expect((defaultDeny?.surface as unknown[]).length).toBeGreaterThan(0);
    },
  );
});
