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
import type { DidDocument, ResolutionResult } from "@provin-line/auth-provider-did";

/**
 * Wrap a `DidDocument` fixture into the minimal `ResolutionResult` shape
 * `DidDocumentResolver.resolve()` now returns. Integration tests here stand
 * up a mock DID registry and exercise the OAuth-token issuance path — the
 * integrity/provenance fields (`canonicalBytes` / `digest` / `finalOrigin` /
 * `snapshotRef`) are inert placeholders, not derived from the mock
 * registry's actual HTTP response.
 */
export function makeMockResolution(document: DidDocument, requestedDid: string): ResolutionResult {
	const digest = `sha256:${"0".repeat(64)}`;
	return {
		document,
		canonicalBytes: new TextEncoder().encode(JSON.stringify(document)),
		digest,
		requestedDid,
		finalOrigin: "mock://registry",
		snapshotRef: `registry:mock://registry#${digest}`,
		retrievedAt: new Date().toISOString(),
	};
}
