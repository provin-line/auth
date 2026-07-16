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
import type {
  AttributeCollector,
  Attributes,
  CollectorContext,
} from "@o3co/auth.policy-verifier.core";
import { ATTR_SUBJECT_DID } from "../keys.mjs";

/**
 * AttributeCollector that promotes `payload.sub` to ATTR_SUBJECT_DID when
 * it conforms to the W3C DID syntax: `did:<method>:<method-specific-id>`.
 *
 * If `sub` is absent, empty, or not a DID, nothing is emitted. Downstream
 * rules that read ATTR_SUBJECT_DID can therefore treat its absence as
 * "this request is not DID-authenticated" without inspecting payload.
 *
 * This collector does not restrict the DID method — any `did:<method>:...`
 * is accepted. Method-specific semantics (e.g. did:dplaax structure) are
 * the responsibility of separate collectors like SubjectDidTypeCollector.
 */
export class SubjectDidCollector implements AttributeCollector {
  async collect(context: CollectorContext): Promise<Attributes> {
    const attrs: Attributes = new Map();
    const sub = context.payload.sub;
    if (typeof sub !== "string" || sub.length === 0) return attrs;
    if (!isDid(sub)) return attrs;
    attrs.set(ATTR_SUBJECT_DID, sub);
    return attrs;
  }
}

/**
 * W3C DID syntax (minimal check): starts with `did:`, has a non-empty
 * method, and has a non-empty method-specific-id. Full ABNF validation
 * from the W3C DID Core specification is intentionally not attempted here.
 */
function isDid(value: string): boolean {
  if (!value.startsWith("did:")) return false;
  const [, method, ...rest] = value.split(":");
  if (!method) return false;
  const methodSpecificId = rest.join(":");
  return methodSpecificId.length > 0;
}
