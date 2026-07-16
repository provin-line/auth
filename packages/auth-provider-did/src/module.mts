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

import { defineModule, type GrantHandler, type Module } from "@o3co/auth-provider-core";
import { z } from "zod";
import { createDidGrant } from "./did.mjs";
import type { NonceStore } from "./nonceStore.mjs";
import type { DidDocumentResolver } from "./resolver/types.mjs";
import type { VerifierRegistry } from "./verifiers/registry.mjs";

const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did" as const;

/**
 * Schema for the `oauth.grants.did` config slice.
 *
 * Nesting matches the runtime read path (`config.oauth.grants.did.*`) so that
 * defaults declared here actually reach the grant factory after
 * `composeConfigSchema` intersection at boot. The shape is wrapped in
 * `oauth.grants` (not exported as a bare `did` schema) so that `defineModule`'s
 * `configSchema` slot can compose it with `CoreConfigSchema`'s `oauth.grants:
 * z.object({}).passthrough()` without stripping sibling grants' config.
 */
export const didConfigSchema = z.object({
	oauth: z.object({
		grants: z
			.object({
				did: z
					.object({
						/**
						 * @deprecated Composition decides registration. Field
						 * accepted for HOCON config compatibility but ignored
						 * at runtime — include or omit `oauthDidModule` from
						 * the `modules` array instead.
						 */
						enabled: z.boolean().optional(),
						/** @deprecated Use supportedAlgorithms instead. Kept for backward compatibility. */
						algorithm: z.string().optional(),
						supportedAlgorithms: z.array(z.string()).default(["ed25519_raw"]),
						messageMaxAgeSec: z.coerce.number().default(300),
						allowedAudiences: z.array(z.string()).default([]),
					})
					.default({
						supportedAlgorithms: ["ed25519_raw"],
						messageMaxAgeSec: 300,
						allowedAudiences: [],
					}),
			})
			.passthrough(),
	}),
});

export type DidModuleOptions =
	| { resolver: DidDocumentResolver; verifierRegistry?: VerifierRegistry; nonceStore?: NonceStore }
	| {
			resolverFactory: (config: Record<string, unknown>) => DidDocumentResolver;
			verifierRegistry?: VerifierRegistry;
			nonceStore?: NonceStore;
	  };

// Pre-Phase-9 escape hatch — ComponentMap typed-slot inference for grant
// factories is intentionally permissive at the contribute boundary; mirrors
// the pattern in @o3co/auth-provider-oauth-token-exchange/src/module.mts.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
type AnyDeps = any;

/**
 * Module that contributes the DID grant handler.
 *
 * Per A2-γ, registration is declarative: include this module in the `modules`
 * array passed to `createApp` to enable DID grant. There is no runtime
 * `enabled` switch — composition decides.
 *
 * Accepts either a pre-built resolver or a factory that receives the DID grant
 * config slice and returns a resolver.
 */
export const oauthDidModule = (options: DidModuleOptions): Module =>
	defineModule({
		name: "oauth-did",
		configSchema: didConfigSchema,
		requires: ["config", "keyStore", "pathResolver"],
		contributes: {
			grants: {
				[DID_GRANT_TYPE]: ((deps: AnyDeps): GrantHandler => {
					const grantConfig =
						(deps.config.oauth.grants as Record<string, Record<string, unknown> | undefined>)
							.did ?? {};
					const resolver =
						"resolver" in options ? options.resolver : options.resolverFactory(grantConfig);
					return createDidGrant(
						{
							config: deps.config,
							keyStore: deps.keyStore,
							pathResolver: deps.pathResolver,
						},
						{
							resolver,
							verifierRegistry: options.verifierRegistry,
							nonceStore: options.nonceStore,
						},
					);
				}) as (deps: AnyDeps) => GrantHandler,
			},
		},
	});
