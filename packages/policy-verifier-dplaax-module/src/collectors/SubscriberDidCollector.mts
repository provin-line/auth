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
import { ATTR_SUBSCRIBER_DID } from "../keys.mjs";

/**
 * AttributeCollector that promotes `context.requestContext.subscriber_did`
 * to ATTR_SUBSCRIBER_DID when the value is a non-empty string.
 *
 * The field name (`subscriber_did`) and the attribute key
 * (ATTR_SUBSCRIBER_DID) are dplaax-domain constants — this collector is
 * not a generic requestContext expander. Other projects that need a
 * different field should declare their own dedicated collector.
 */
export class SubscriberDidCollector implements AttributeCollector {
  async collect(context: CollectorContext): Promise<Attributes> {
    const attrs: Attributes = new Map();
    const value = context.requestContext?.subscriber_did;
    if (typeof value === "string" && value.length > 0) {
      attrs.set(ATTR_SUBSCRIBER_DID, value);
    }
    return attrs;
  }
}
