/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { CollectorContext, Rule, RuleCollector } from "@o3co/auth.policy-verifier.core";
import { resolveResourceActionMatch } from "./_dispatch.mjs";

interface SurfaceEntry {
  resource: string;
  action: string;
}

export interface DefaultDenyRuleCollectorConfig {
  /**
   * The deployment's declared request surface: every `(resource, action)`
   * pair the deployment intends to serve, with `action: "*"` declaring all
   * actions on a resource. Requests matching an entry are ABSTAINED on (this
   * collector emits no rule — the other rule groups still decide); requests
   * matching nothing are denied unconditionally. An empty surface therefore
   * denies every request.
   *
   * Entries match the RAW resource string as sent by the PEP — instance ids
   * are not stripped (a request for `dids:did-123` does not match a `dids`
   * entry), and `resource: "*"` is a literal, never a wildcard. Both fall on
   * the fail-closed side: an unmatched form denies rather than allows.
   */
  surface: SurfaceEntry[];
}

/**
 * RuleCollector imposing a fail-closed default over the request surface:
 * any `(resource, action)` not declared in `surface` is denied.
 *
 * Why this exists: the core `evaluate()` allows when zero rules are
 * collected, so a deployment whose rule collectors are all dispatch-scoped
 * (they abstain on unknown resource/action) silently ALLOWS requests nobody
 * configured a policy for. This collector inverts that default — an
 * unconfigured request fails closed, and extending the surface is a
 * deliberate config change reviewed next to the policy rules themselves.
 *
 * The emitted rule carries the dedicated ruleType `default_deny` and always
 * verifies false. Rule groups are OR-combined per ruleType and AND-combined
 * across ruleTypes, so no rule from another GROUP can neutralize the deny.
 * CONTRACT: the ruleType `default_deny` is reserved for this collector — the
 * core does not reserve ruleType strings, so a custom collector emitting a
 * passing rule under the same ruleType would OR the deny away. Do not emit
 * `default_deny` from any other collector.
 *
 * Declared-surface matching reuses the shared dispatch: exact action match
 * or wildcard (`"*"`), exact-before-wildcard precedence. Matching an entry
 * is an abstention, not a grant — authorization still comes from the other
 * rule groups (scope gate, subscriber identity, DID type).
 */
export class DefaultDenyRuleCollector implements RuleCollector {
  constructor(private readonly config: DefaultDenyRuleCollectorConfig) {}

  async collect(context: CollectorContext): Promise<Rule[]> {
    const resource = context.resource.raw;
    const action = context.action;
    const declared = resolveResourceActionMatch(this.config.surface, resource, action);
    if (declared) return [];
    return [
      {
        ruleType: "default_deny",
        code: "undeclared_resource_action",
        message: `resource "${resource}" action "${action}" is not declared in the policy-verifier surface (default deny)`,
        verify: () => false,
      },
    ];
  }
}
