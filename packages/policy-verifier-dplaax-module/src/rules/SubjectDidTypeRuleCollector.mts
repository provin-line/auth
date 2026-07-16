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
import { AttrLiteralIn } from "@o3co/auth.policy-verifier.builtins";
import type { CollectorContext, Rule, RuleCollector } from "@o3co/auth.policy-verifier.core";
import type { DIDType } from "../collectors/SubjectDidTypeCollector.mjs";
import { ATTR_SUBJECT_DID_TYPE } from "../keys.mjs";
import { resolveResourceActionMatch } from "./_dispatch.mjs";

interface RuleConfig {
  resource: string;
  action: string;
  allowedTypes: DIDType[];
}

export interface SubjectDidTypeRuleCollectorConfig {
  rules: RuleConfig[];
}

/**
 * RuleCollector that produces an AttrLiteralIn rule when the request's
 * resource+action matches one of the configured entries.
 *
 * Reads only `context.resource` and `context.action` for dispatch; does
 * not read payload or requestContext. The produced rule is a pure
 * predicate over attrs — the DID type is collected upstream by
 * SubjectDidTypeCollector from payload.sub and stored under
 * ATTR_SUBJECT_DID_TYPE.
 *
 * Exact-before-wildcard precedence (via resolveResourceActionMatch): an
 * entry with an exact action match wins over an entry with `action = "*"`,
 * regardless of config order. This avoids a subtle footgun where a
 * wildcard listed first would silently shadow more specific rules.
 *
 * The emitted rule is a stock `AttrLiteralIn({ a: ATTR_SUBJECT_DID_TYPE,
 * values: allowedTypes })`. No wrapper class — the shared builtin does
 * exactly what we need here, and adopting it directly keeps the dplaax
 * vocabulary layer thin.
 */
export class SubjectDidTypeRuleCollector implements RuleCollector {
  constructor(private readonly config: SubjectDidTypeRuleCollectorConfig) {}

  async collect(context: CollectorContext): Promise<Rule[]> {
    const chosen = resolveResourceActionMatch(
      this.config.rules,
      context.resource.raw,
      context.action,
    );
    if (!chosen) return [];
    return [new AttrLiteralIn({ a: ATTR_SUBJECT_DID_TYPE, values: chosen.allowedTypes })];
  }
}
