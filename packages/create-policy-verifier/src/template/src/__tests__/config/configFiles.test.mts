import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFile } from "@o3co/ts.hocon";
import { describe, expect, it } from "vitest";

// ChainPeerService is L2-only per provin-line/auth docs/requirements.md § 3 ("Pipeline Chain
// connection authentication does NOT go through L1") and provin-line/oss#74.
// L1 policy-verifier rules referencing registry.chain.peer.* therefore can
// never match a real request — and a future contributor might re-add such a
// rule by analogy to the (now-removed) chain_peer_service.proto policy
// options. Pin the absence here.
//
// All HOCON files under config/ are checked, not just application.conf:
// development.conf / production.conf are env overlays loaded via
// withFallback in main.mts, and a contributor could in principle declare
// `rule.collectors` in an overlay to override the base. Walking every
// *.conf catches that vector.
//
// ChainService routes (registry.chain.{subscribe,unsubscribe}, etc.) remain
// internal-network and L1-gated, so this test does NOT forbid every
// registry.chain.* rule — only the .peer. namespace.

const CONFIG_DIR_URL = new URL("../../../config/", import.meta.url);

interface RuleEntry {
  resource?: unknown;
  action?: unknown;
}

interface CollectorEntry {
  collector?: unknown;
  rules?: unknown;
}

// rules is treated as `unknown[] | undefined` here on purpose: shape
// validation (resource/action present and string-typed) is enforced at
// runtime by module.mts; this test only pins the .peer. namespace
// absence and is intentionally tolerant of other shape errors so they
// surface from the validator with their richer messages.
function rulesOf(collector: CollectorEntry): RuleEntry[] {
  const rules = collector.rules;
  return Array.isArray(rules) ? (rules as RuleEntry[]) : [];
}

function configFilePaths(): string[] {
  const dir = fileURLToPath(CONFIG_DIR_URL);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".conf"))
    .map((name) => fileURLToPath(new URL(name, CONFIG_DIR_URL)));
}

describe("config/*.conf", () => {
  const paths = configFilePaths();

  // Sanity: if the directory ever ends up empty, the it.each loop below
  // would silently produce no assertions. Surface that fast.
  it("discovers at least one .conf file", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)("%s does not declare any orphan registry.chain.peer.* rule", (path) => {
    const conf = parseFile(path);

    // A file that does not declare rule.collectors at all (env overlays
    // that override nothing — getList throws on missing path) is trivially
    // safe: it cannot introduce an orphan.
    let collectors: CollectorEntry[];
    try {
      collectors = conf.getList("rule.collectors") as CollectorEntry[];
    } catch {
      return;
    }

    const offenders: string[] = [];
    for (const collector of collectors) {
      for (const rule of rulesOf(collector)) {
        const resource = typeof rule.resource === "string" ? rule.resource : "";
        if (resource.startsWith("registry.chain.peer")) {
          const collectorName =
            typeof collector.collector === "string" ? collector.collector : "<unknown>";
          const action = typeof rule.action === "string" ? rule.action : "<unknown>";
          offenders.push(`${collectorName}: ${resource}/${action}`);
        }
      }
    }

    expect(offenders, `orphan registry.chain.peer.* rules in ${path}`).toEqual([]);
  });
});
