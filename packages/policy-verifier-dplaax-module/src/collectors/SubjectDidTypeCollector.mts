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
import {
  classifyDplaaxDid,
  parseDplaaxDid,
  type ParsedDplaaxDid,
} from "@provin-line/did-dplaax";
import type {
  AttributeCollector,
  Attributes,
  CollectorContext,
} from "@o3co/auth.policy-verifier.core";
import { ATTR_SUBJECT_DID_TYPE } from "../keys.mjs";

export const DID_TYPES = ["owner", "pipeline", "process"] as const;
export type DIDType = (typeof DID_TYPES)[number];

/**
 * Parses a did:dplaax DID string and returns its resource hierarchy type.
 *
 * Owner:    did:dplaax:{registry}:{accountType}:{accountId}
 * Pipeline: did:dplaax:{registry}:{accountType}:{accountId}:pipeline:{id}
 * Process:  did:dplaax:{registry}:{accountType}:{accountId}:pipeline:{id}:process:{id}
 *
 * accountType (e.g. "org", "user", "service") is orthogonal to the hierarchy
 * and does not affect classification. Any valid identifier is accepted.
 *
 * Returns null when the DID is structurally invalid or the resourcePath
 * does not match a known hierarchy pattern. The underlying
 * @provin-line/did-dplaax parser throws on malformed input; this adapter
 * catches that so the collector's "type unknown → emit nothing" contract
 * stays intact (auth#19).
 *
 * Exported signature is unchanged — external callers are not affected.
 */
export function parseDIDType(did: string): DIDType | null {
  let parsed: ParsedDplaaxDid;
  try {
    parsed = parseDplaaxDid(did);
  } catch {
    return null;
  }
  return classifyDplaaxDid(parsed);
}

/**
 * AttributeCollector that derives the did:dplaax DID type from
 * `payload.sub` and stores it under ATTR_SUBJECT_DID_TYPE.
 *
 * The name reflects what this collector actually reads: the subject
 * field of the JWT. If a future collector needs to derive a DID type
 * from another source (e.g. requestContext.subscriber_did), it should
 * be a separate class with its own name (e.g. SubscriberDidTypeCollector)
 * and its own attribute key.
 *
 * Emits nothing when sub is absent or is not a recognizable did:dplaax
 * DID. Consumers (e.g. SubjectDidTypeRule) must treat a missing
 * ATTR_SUBJECT_DID_TYPE as "type unknown" rather than inventing a
 * default.
 */
export class SubjectDidTypeCollector implements AttributeCollector {
  async collect(context: CollectorContext): Promise<Attributes> {
    const attrs: Attributes = new Map();
    const sub = context.payload.sub;
    if (typeof sub !== "string" || sub.length === 0) return attrs;
    const type = parseDIDType(sub);
    if (type !== null) {
      attrs.set(ATTR_SUBJECT_DID_TYPE, type);
    }
    return attrs;
  }
}
