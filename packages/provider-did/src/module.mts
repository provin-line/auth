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
 *
 * `did` itself carries NO object-level default (Task 8, config hardening):
 * `allowedAudiences` and `revocationLatencyBoundSec` are required with no
 * per-field default either, so a synthesized object-level default could only
 * be produced by inventing values for a security-relevant allowlist and
 * lifetime bound. Any deployment that includes `oauthDidModule` in its
 * `modules` array now MUST configure `oauth.grants.did` explicitly — this is
 * the fix for the audit finding that an empty/absent audience allowlist
 * silently meant "accept any audience" (fail-open default).
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
						/**
						 * Audience allowlist for the DID grant. Required, non-empty —
						 * NO default (fail closed). An empty/absent allowlist used to
						 * mean "accept any audience"; that fail-open default is the
						 * audit finding this field now closes at boot time instead of
						 * at request time.
						 */
						allowedAudiences: z.array(z.string().min(1)).min(1),
						/**
						 * The P0 auth contract this grant enforces (dplaax.spec).
						 * `LEGACY_DID_LOGIN@1` — the pre-existing message shape with no
						 * signed transcript — is the scaffold/default contract. The two
						 * `OWNER_*` values select transcript-bearing contracts gated by
						 * `ownerMigrationRatified` below (rule `auth.migration.enable-
						 * gate`) and wired into the request handler (`did.mts`'s
						 * `handle()`, step 5b): versioned transcript
						 * (`parseLoginTranscript`), three-way kid match, Fork-Y
						 * relationship (`authentication` / `assertionMethod`; see
						 * transcript.mts). `createDidGrant` still fails closed at
						 * construction time for either `OWNER_*` value when
						 * `ownerMigrationRatified` is not `true`, `tokenEndpoint` is
						 * absent, or any configured `supportedAlgorithms` entry is not
						 * header-bearing (JWS-family — the three-way kid match needs a
						 * real JWS protected header; see the guards in did.mts). Kept in
						 * sync by hand with `AuthContractId` in `./transcript.mts` —
						 * zod's literal-union enum can't reference that type's members
						 * directly.
						 */
						authContract: z
							.enum([
								"LEGACY_DID_LOGIN@1",
								"OWNER_AUTHENTICATION_LOGIN@1",
								"OWNER_ASSERTION_CONTROL_LOGIN@1",
							])
							.default("LEGACY_DID_LOGIN@1"),
						/**
						 * Explicit operator opt-in required before an OWNER_* contract
						 * may be selected — rule `auth.migration.enable-gate`. Defaults
						 * to `false` so upgrading this package never silently enables
						 * the OWNER_* migration path.
						 */
						ownerMigrationRatified: z.boolean().default(false),
						/**
						 * Upper bound, in seconds, on `oauth.accessToken.expiresIn` for
						 * this grant — rule `auth.token.lifetime-bound`, enforced as a
						 * boot-time assert in `createDidGrant` (this schema can't see
						 * `accessToken.expiresIn`, a sibling config slice). NO default:
						 * an operator who omits this gets a boot failure rather than an
						 * implicit, possibly-too-generous bound (fail closed).
						 */
						revocationLatencyBoundSec: z.number().int().positive(),
						/**
						 * Hard expiry cap, in seconds, for `LEGACY_DID_LOGIN@1` tokens —
						 * rule `auth.legacy.did-login`, enforced as a boot-time assert
						 * in `createDidGrant`. The legacy message shape carries no
						 * signed transcript / replay-binding beyond nonce+timestamp, so
						 * its tokens are capped more tightly than the general
						 * `revocationLatencyBoundSec` bound above.
						 */
						legacyMaxTtlSec: z.number().int().positive().default(900),
						/**
						 * The OAuth token endpoint URL. Required when `authContract` is
						 * OWNER_*: the login transcript's `token_endpoint` field is
						 * checked against this (Task 9's `validateOwnerLogin`).
						 */
						tokenEndpoint: z.string().min(1).optional(),
						/**
						 * Resource-floor bounds (timeout / body-size cap / concurrency)
						 * passed through to whatever resolver a `resolverFactory` builds
						 * from this config slice — this package only defines the shape;
						 * it does not itself construct a bounded transport. All fields
						 * optional, defaulting to `{}` so a resolver factory can layer
						 * its own defaults on top (e.g. `DplaaxDidResolver`'s
						 * `DEFAULT_BOUNDS` in `@provin-line/auth-provider-dplaax-module`).
						 */
						resolver: z
							.object({
								timeoutMs: z.number().int().positive(),
								maxBodyBytes: z.number().int().positive(),
								maxConcurrent: z.number().int().positive(),
							})
							.partial()
							.default({}),
					})
					.superRefine((val, ctx) => {
						const isOwnerContract =
							val.authContract === "OWNER_AUTHENTICATION_LOGIN@1" ||
							val.authContract === "OWNER_ASSERTION_CONTROL_LOGIN@1";
						if (!isOwnerContract) return;
						if (val.ownerMigrationRatified !== true) {
							ctx.addIssue({
								code: "custom",
								message:
									"owner contract requires ownerMigrationRatified: true (auth.migration.enable-gate)",
								path: ["ownerMigrationRatified"],
							});
						}
						if (!val.tokenEndpoint) {
							ctx.addIssue({
								code: "custom",
								message: "owner contract requires tokenEndpoint to be configured",
								path: ["tokenEndpoint"],
							});
						}
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
