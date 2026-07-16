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
import type { Module } from "@o3co/auth.policy-verifier.core";
import {
  DID_TYPES,
  type DIDType,
  SubjectDidTypeCollector,
} from "./collectors/SubjectDidTypeCollector.mjs";
import { SubjectDidCollector } from "./collectors/SubjectDidCollector.mjs";
import { SubscriberDidCollector } from "./collectors/SubscriberDidCollector.mjs";
import {
  DefaultDenyRuleCollector,
  type DefaultDenyRuleCollectorConfig,
} from "./rules/DefaultDenyRuleCollector.mjs";
import {
  SubjectDidTypeRuleCollector,
  type SubjectDidTypeRuleCollectorConfig,
} from "./rules/SubjectDidTypeRuleCollector.mjs";
import {
  SubscriberIdentityCheckRuleCollector,
  type SubscriberIdentityCheckRuleCollectorConfig,
} from "./rules/SubscriberIdentityCheckRuleCollector.mjs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSubscriberIdentityCheckRuleCollectorConfig(
  config: unknown,
): SubscriberIdentityCheckRuleCollectorConfig {
  if (!isRecord(config) || !Array.isArray(config.rules)) {
    throw new Error(
      'Invalid config for SubscriberIdentityCheckRuleCollector: expected { rules: Array<{resource, action}> }.',
    );
  }
  const rules = config.rules.map((r, i) => {
    if (!isRecord(r) || typeof r.resource !== "string" || typeof r.action !== "string") {
      throw new Error(
        `Invalid rule at index ${i} in SubscriberIdentityCheckRuleCollector config: expected { resource: string, action: string }.`,
      );
    }
    return { resource: r.resource, action: r.action };
  });
  return { rules };
}

function parseSubjectDidTypeRuleCollectorConfig(config: unknown): SubjectDidTypeRuleCollectorConfig {
  if (!isRecord(config) || !Array.isArray(config.rules)) {
    throw new Error(
      'Invalid config for SubjectDidTypeRuleCollector: expected { rules: Array<{resource, action, allowedTypes}> }.',
    );
  }
  const rules = config.rules.map((r, i) => {
    if (
      !isRecord(r) ||
      typeof r.resource !== "string" ||
      typeof r.action !== "string" ||
      !Array.isArray(r.allowedTypes)
    ) {
      throw new Error(
        `Invalid rule at index ${i} in SubjectDidTypeRuleCollector config: expected { resource, action, allowedTypes: DIDType[] }.`,
      );
    }
    const allowedTypes = r.allowedTypes.map((t, j) => {
      if (typeof t !== "string" || !DID_TYPES.includes(t as DIDType)) {
        throw new Error(
          `Invalid DID type at rules[${i}].allowedTypes[${j}] in SubjectDidTypeRuleCollector config: expected one of ${DID_TYPES.join("|")}.`,
        );
      }
      return t as DIDType;
    });
    return { resource: r.resource, action: r.action, allowedTypes };
  });
  return { rules };
}

function parseDefaultDenyRuleCollectorConfig(config: unknown): DefaultDenyRuleCollectorConfig {
  if (!isRecord(config) || !Array.isArray(config.surface)) {
    throw new Error(
      "Invalid config for DefaultDenyRuleCollector: expected { surface: Array<{resource, action}> }.",
    );
  }
  const surface = config.surface.map((e, i) => {
    // Empty strings are rejected too: the server 400-rejects empty
    // resource/action before dispatch, so an empty entry can never match and
    // the pair the operator meant to declare would silently stay denied.
    if (
      !isRecord(e) ||
      typeof e.resource !== "string" ||
      e.resource === "" ||
      typeof e.action !== "string" ||
      e.action === ""
    ) {
      throw new Error(
        `Invalid surface entry at index ${i} in DefaultDenyRuleCollector config: expected { resource: string, action: string } (non-empty).`,
      );
    }
    return { resource: e.resource, action: e.action };
  });
  return { surface };
}

export const dplaaxModule: Module = {
  name: "dplaax",
  async init(context) {
    // Attribute collectors
    context.attributeCollectorRegistry.register(
      "SubjectDidCollector",
      () => new SubjectDidCollector(),
    );
    context.attributeCollectorRegistry.register(
      "SubscriberDidCollector",
      () => new SubscriberDidCollector(),
    );
    context.attributeCollectorRegistry.register(
      "SubjectDidTypeCollector",
      () => new SubjectDidTypeCollector(),
    );

    // Rule collectors
    context.ruleCollectorRegistry.register(
      "SubscriberIdentityCheckRuleCollector",
      (config) =>
        new SubscriberIdentityCheckRuleCollector(
          parseSubscriberIdentityCheckRuleCollectorConfig(config),
        ),
    );
    context.ruleCollectorRegistry.register(
      "SubjectDidTypeRuleCollector",
      (config) => new SubjectDidTypeRuleCollector(parseSubjectDidTypeRuleCollectorConfig(config)),
    );
    context.ruleCollectorRegistry.register(
      "DefaultDenyRuleCollector",
      (config) => new DefaultDenyRuleCollector(parseDefaultDenyRuleCollectorConfig(config)),
    );
  },
};
