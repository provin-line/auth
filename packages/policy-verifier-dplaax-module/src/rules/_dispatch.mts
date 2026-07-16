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
/**
 * Shared resource+action dispatch for dplaax RuleCollectors.
 *
 * All dplaax RuleCollectors (SubscriberIdentityCheckRuleCollector,
 * SubjectDidTypeRuleCollector) follow the same pattern:
 *   1. Filter config entries whose `resource` exactly matches the request.
 *   2. Among those, prefer an exact `action` match over a wildcard (`"*"`).
 *   3. Return the chosen entry, or undefined if nothing matches.
 *
 * Exact-before-wildcard precedence is enforced regardless of config order —
 * a wildcard listed earlier must not shadow a more specific entry.
 */
export function resolveResourceActionMatch<T extends { resource: string; action: string }>(
  entries: T[],
  resource: string,
  action: string,
): T | undefined {
  const resourceMatches = entries.filter((e) => e.resource === resource);
  const exact = resourceMatches.find((e) => e.action === action);
  return exact ?? resourceMatches.find((e) => e.action === "*");
}
