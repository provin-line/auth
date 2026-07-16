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
import { AttrMatchRule } from "@o3co/auth.policy-verifier.builtins";
import type { CollectorContext, Rule, RuleCollector } from "@o3co/auth.policy-verifier.core";
import { ATTR_SUBJECT_DID, ATTR_SUBSCRIBER_DID } from "../keys.mjs";
import { resolveResourceActionMatch } from "./_dispatch.mjs";

interface RuleConfig {
  resource: string;
  action: string;
}

export interface SubscriberIdentityCheckRuleCollectorConfig {
  // Resource+action entries for which the authenticated subject DID must
  // equal the declared subscriber DID. "*" in action matches any action.
  rules: RuleConfig[];
}

/**
 * RuleCollector that enforces "the authenticated subject is the same
 * party as the declared subscriber".
 *
 * When the request's resource+action matches one of the configured
 * entries, this emits an AttrMatchRule that compares ATTR_SUBJECT_DID
 * (populated by SubjectDidCollector from payload.sub when it is a DID)
 * against ATTR_SUBSCRIBER_DID (populated by SubscriberDidCollector from
 * requestContext.subscriber_did).
 *
 * The dispatch reads only resource and action. The emitted rule is
 * pure: both attributes must be present and equal — if the request is
 * not DID-authenticated (no ATTR_SUBJECT_DID) or the subscriber DID is
 * missing, the rule denies. Operations that legitimately omit one side
 * (e.g. actions that don't require subscriber verification) must not
 * be listed in `rules`.
 *
 * Exact-before-wildcard precedence (via resolveResourceActionMatch): an
 * entry with an exact action match wins over an entry with `action = "*"`
 * for the same resource, regardless of config order. The emitted rule
 * is identical in either case today, but keeping dispatch deterministic
 * avoids surprises if future rule config grows per-entry options.
 */
export class SubscriberIdentityCheckRuleCollector implements RuleCollector {
  constructor(private readonly config: SubscriberIdentityCheckRuleCollectorConfig) {}

  async collect(context: CollectorContext): Promise<Rule[]> {
    const chosen = resolveResourceActionMatch(
      this.config.rules,
      context.resource.raw,
      context.action,
    );
    if (!chosen) return [];
    return [new AttrMatchRule({ a: ATTR_SUBJECT_DID, b: ATTR_SUBSCRIBER_DID })];
  }
}
