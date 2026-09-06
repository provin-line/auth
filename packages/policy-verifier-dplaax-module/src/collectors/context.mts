// SPDX-FileCopyrightText: 2026 1o1 Co. Ltd.
// SPDX-License-Identifier: Apache-2.0

import * as core from "@o3co/auth.policy-verifier.core";
import type { CollectorContext } from "@o3co/auth.policy-verifier.core";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Current transports supply subject; released 0.3.x transports supply payload. */
export function subjectClaims(context: CollectorContext): Record<string, unknown> {
  // Presence wins even for an empty or malformed subject. Never recover identity
  // from a second bag when the transport has supplied the authoritative one.
  return record("subject" in context ? context.subject : Reflect.get(context, "payload")) ?? {};
}

// Namespace lookup keeps the released 0.3.x package loadable: it does not export
// the accessor yet. With a current core, ALWAYS use its trust-boundary accessor;
// an unmarked record must not fall back to the legacy plain-record path.
const read = Reflect.get(core, "readUntrustedRequestContext") as
  ((value: unknown) => unknown) | undefined;

/** Read caller-supplied fields, never authenticated identity or entitlements. */
export function untrustedRequestFields(context: CollectorContext): Record<string, unknown> | undefined {
  return record(read ? read(context.requestContext) : context.requestContext);
}
