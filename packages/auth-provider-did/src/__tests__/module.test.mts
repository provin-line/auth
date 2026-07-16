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

import { createSymmetricKeyStore, defineModule } from "@o3co/auth-provider-core";
import { createTestApp, makeValidAppConfig } from "@o3co/auth-provider-core/testing";
import { describe, expect, it } from "vitest";
import { oauthDidModule } from "../module.mjs";
import type { DidDocument, DidDocumentResolver } from "../resolver/types.mjs";

const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";

const mockResolver: DidDocumentResolver = {
	async resolve(_did: string): Promise<DidDocument> {
		throw new Error("not expected to be called in this test");
	},
};

const keyStoreModule = defineModule({
	name: "test:key-store",
	provides: { keyStore: () => createSymmetricKeyStore("test-secret") },
});

const bootDidApp = async () =>
	createTestApp({
		modules: [oauthDidModule({ resolver: mockResolver }), keyStoreModule],
		bootstrapComponents: { config: makeValidAppConfig(), pathResolver: (s: string) => s },
	});

describe("oauthDidModule", () => {
	it("contributes the DID grant under https://dplaax.dev/oauth/grant-type/did", async () => {
		const handle = await bootDidApp();
		try {
			expect(handle.inspect.grants.has(DID_GRANT_TYPE)).toBe(true);
		} finally {
			await handle.dispose();
		}
	});

	it("does NOT contribute the bare 'did' string (URN-only policy)", async () => {
		const handle = await bootDidApp();
		try {
			expect(handle.inspect.grants.has("did")).toBe(false);
		} finally {
			await handle.dispose();
		}
	});

	it("does NOT contribute the legacy urn:o3co: alias", async () => {
		const handle = await bootDidApp();
		try {
			expect(handle.inspect.grants.has("urn:o3co:oauth:grant-type:did")).toBe(false);
		} finally {
			await handle.dispose();
		}
	});

	it("supplies schema-default did config slice to resolverFactory", async () => {
		// Pins both behaviors that the initial migration silently broke and
		// multi-agent review caught: (1) `didConfigSchema` must be nested at
		// `oauth.grants.did` so its `.default(...)` reaches the grant factory
		// after `composeConfigSchema` intersection, (2) the `resolverFactory`
		// branch is exercised at boot. Without this test, a regression that
		// re-flattens the schema (defaults never reach the factory) would
		// pass under the smoke tests above.
		const captured: Array<Record<string, unknown>> = [];
		const handle = await createTestApp({
			modules: [
				oauthDidModule({
					resolverFactory: (cfg): DidDocumentResolver => {
						captured.push(cfg);
						return mockResolver;
					},
				}),
				keyStoreModule,
			],
			bootstrapComponents: { config: makeValidAppConfig(), pathResolver: (s: string) => s },
		});
		try {
			expect(handle.inspect.grants.has(DID_GRANT_TYPE)).toBe(true);
			expect(captured).toHaveLength(1);
			expect(captured[0]).toMatchObject({
				supportedAlgorithms: ["ed25519_raw"],
				messageMaxAgeSec: 300,
				allowedAudiences: [],
			});
		} finally {
			await handle.dispose();
		}
	});
});
