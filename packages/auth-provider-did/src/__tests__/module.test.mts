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
import type { DidDocumentResolver, ResolutionResult } from "../resolver/types.mjs";

const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";

const mockResolver: DidDocumentResolver = {
	async resolve(_did: string): Promise<ResolutionResult> {
		throw new Error("not expected to be called in this test");
	},
};

const keyStoreModule = defineModule({
	name: "test:key-store",
	provides: { keyStore: () => createSymmetricKeyStore("test-secret") },
});

/**
 * `makeValidAppConfig()` alone no longer boots a `oauthDidModule` app (Task
 * 8): `oauth.grants.did` has no object-level default any more, and
 * `bootstrapComponents.config` is used verbatim by `createTestApp` (no
 * merge — see its docstring), so callers must supply the did-config slice
 * themselves. `makeValidAppConfig()`'s `accessToken.expiresIn` is 3600s, so
 * `legacyMaxTtlSec` (default 900s) must be raised to stay within it for the
 * default `authContract: "LEGACY_DID_LOGIN@1"`.
 */
const makeValidDidAppConfig = () => {
	const base = makeValidAppConfig();
	return {
		...base,
		oauth: {
			...base.oauth,
			grants: {
				did: {
					allowedAudiences: ["https://api.example.com"],
					revocationLatencyBoundSec: 3600,
					legacyMaxTtlSec: 3600,
				},
			},
		},
	};
};

const bootDidApp = async () =>
	createTestApp({
		modules: [oauthDidModule({ resolver: mockResolver }), keyStoreModule],
		bootstrapComponents: { config: makeValidDidAppConfig(), pathResolver: (s: string) => s },
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
		// `oauth.grants.did` so its per-field `.default(...)`s reach the grant
		// factory after `composeConfigSchema` intersection, (2) the
		// `resolverFactory` branch is exercised at boot. Without this test, a
		// regression that re-flattens the schema (defaults never reach the
		// factory) would pass under the smoke tests above.
		//
		// Task 8 removed `did`'s object-level default — `allowedAudiences` and
		// `revocationLatencyBoundSec` are supplied explicitly below (required,
		// no default: fail closed) — but `supportedAlgorithms` /
		// `messageMaxAgeSec` are left unset so this test still proves their
		// per-field defaults reach the factory.
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
			bootstrapComponents: { config: makeValidDidAppConfig(), pathResolver: (s: string) => s },
		});
		try {
			expect(handle.inspect.grants.has(DID_GRANT_TYPE)).toBe(true);
			expect(captured).toHaveLength(1);
			expect(captured[0]).toMatchObject({
				supportedAlgorithms: ["ed25519_raw"],
				messageMaxAgeSec: 300,
				allowedAudiences: ["https://api.example.com"],
				revocationLatencyBoundSec: 3600,
				authContract: "LEGACY_DID_LOGIN@1",
				ownerMigrationRatified: false,
			});
		} finally {
			await handle.dispose();
		}
	});
});
