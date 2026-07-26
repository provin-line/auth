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
import path from "node:path";
import {
	type AppConfig,
	createKeyStoreFactory,
	createRepositoryFactories,
	defineModule,
	type Module,
	registerBuiltinKeyStores,
} from "@o3co/auth-provider-core";

/**
 * Flatten the HOCON adapter-config slice into the flat `{ type, ...rest }`
 * shape consumed by `AdapterFactory.create()`.
 *
 * Two HOCON shapes are accepted:
 *   - Nested (upstream standalone): `{ type: "yaml", yaml: { path: "..." } }`
 *   - Flat: `{ type: "yaml", path: "..." }`
 *
 * Top-level fields outside `type` / `provider` / the selector-keyed block are
 * preserved so a flat HOCON config (the form dPLaaX ships) does not silently
 * drop adapter options like `path`. Nested-block fields win on key conflicts
 * because the nested form is the upstream documented shape.
 *
 * Composition-root concern; mirrors the helper in the upstream standalone
 * template (`references/auth.provider/templates/standalone/src/modules.mts`).
 */
function flattenAdapterConfig(
	section: ({ type: string } | { provider: string }) & Record<string, unknown>,
): { type: string } & Record<string, unknown> {
	const selector =
		(section as { type?: string; provider?: string }).type ??
		(section as { provider?: string }).provider;
	if (typeof selector !== "string") {
		throw new TypeError(
			"flattenAdapterConfig: section requires 'type' or 'provider' string",
		);
	}
	const sub = section[selector];
	const flattenedSub =
		typeof sub === "object" && sub !== null && !Array.isArray(sub)
			? (sub as Record<string, unknown>)
			: {};
	const flatRest: Record<string, unknown> = { ...section };
	delete flatRest.type;
	delete flatRest.provider;
	delete flatRest[selector];
	return { type: selector, ...flatRest, ...flattenedSub };
}

/**
 * KeyStore module — provides the JWT signing KeyStore from
 * `config.oauth.jwt.signingKey`. Uses the built-in local/jwks adapters from
 * `@o3co/auth-provider-core`.
 */
export const keyStoreModule: Module = defineModule({
	name: "dplaax:key-store",
	requires: ["config"] as const,
	provides: {
		keyStore: async ({ config }) => {
			const factory = createKeyStoreFactory();
			registerBuiltinKeyStores(factory);
			return factory.create(
				flattenAdapterConfig((config as AppConfig).oauth.jwt.signingKey),
			);
		},
	},
});

/**
 * Client repository module — provides `clientRepository` from
 * `config.repositories.client`. dPLaaX currently uses the yaml adapter only;
 * the built-in factory ships with both memory and yaml adapters.
 */
export const clientRepositoryModule: Module = defineModule({
	name: "dplaax:client-repository",
	requires: ["config"] as const,
	// D-5 (core 0.5.x): forward `lifecycleRegistrar` so the built-in yaml
	// adapter can register its file-watch closer via `ctx.lifecycle?.register`.
	// Without this, `handle.dispose()` cannot drain the watcher.
	optional: ["lifecycleRegistrar"] as const,
	provides: {
		clientRepository: async ({ config, lifecycleRegistrar }) => {
			const { clientFactory } = createRepositoryFactories({
				lifecycle: lifecycleRegistrar,
			});
			const slice = flattenAdapterConfig(
				(config as AppConfig).repositories.client as { type: string } & Record<
					string,
					unknown
				>,
			);
			if (typeof slice.path === "string") {
				slice.path = path.resolve(process.cwd(), slice.path);
			}
			return clientFactory.create(slice);
		},
	},
});

/**
 * In-memory code repository module — provides the OAuth authorization-code
 * `codeRepository` backed by the in-process Map adapter. dPLaaX PoC ships
 * memory-only; multi-replica deployments swap this for
 * `redisCodeRepositoryModule` from `@o3co/auth-provider-redis` via
 * `DplaaxBuildModulesOverrides.codeRepositoryModule`.
 *
 * This module is memory-only by design (`inMemory*` in the name); the HOCON
 * `repositories.code.type` must read `"memory"`. Any other value is an
 * operator misconfiguration — fail fast so the silent
 * "I set type=redis and nothing changed" footgun cannot land in
 * production.
 */
export const inMemoryCodeRepositoryModule: Module = defineModule({
	name: "dplaax:in-memory-code-repository",
	requires: ["config"] as const,
	// D-5 (core 0.5.x): the in-memory code repository spawns a GC interval
	// timer; the built-in adapter registers `clearInterval` via
	// `ctx.lifecycle?.register` so `handle.dispose()` clears it.
	optional: ["lifecycleRegistrar"] as const,
	provides: {
		codeRepository: async ({ config, lifecycleRegistrar }) => {
			const slice = flattenAdapterConfig(
				(config as AppConfig).repositories.code as { type: string } & Record<
					string,
					unknown
				>,
			);
			if (slice.type !== "memory") {
				throw new Error(
					`inMemoryCodeRepositoryModule received repositories.code.type="${slice.type}"; ` +
						"this module only serves the memory adapter. To use a different adapter " +
						"(e.g. Redis), pass it via DplaaxBuildModulesOverrides.codeRepositoryModule.",
				);
			}
			const { codeFactory } = createRepositoryFactories({
				lifecycle: lifecycleRegistrar,
			});
			return codeFactory.create(slice);
		},
	},
});
