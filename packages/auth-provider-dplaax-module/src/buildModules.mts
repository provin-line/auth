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
	type DidDocumentResolver,
	type NonceStore,
	oauthDidModule,
} from "@provin-line/auth-provider-did";
import type { AppConfig, Module } from "@o3co/auth-provider-core";
import { oauthModule } from "@o3co/auth-provider-oauth";

import {
	clientRepositoryModule,
	inMemoryCodeRepositoryModule,
	keyStoreModule,
} from "./modules.mjs";
import { DplaaxDidResolver } from "./resolver/dplaax.mjs";

/**
 * Operational shape of the dPLaaX auth-provider config. Picks only the upstream
 * `AppConfig` sections that this DID-only deployment actually populates
 * (`http` / `oauth` / `endpoints` / `repositories`); session / federation /
 * rateLimit / cors are intentionally omitted instead of stubbed with
 * `undefined`. A future upstream change that makes `oauthModule({config})`
 * read one of the omitted sections unconditionally will surface as a type
 * error at the `oauthModule` call site below, not silently `undefined` at
 * runtime.
 */
export type DplaaxAppConfigBase = Pick<
	AppConfig,
	"http" | "oauth" | "endpoints" | "repositories"
>;

export interface DplaaxAppConfig extends DplaaxAppConfigBase {
	readonly dplaax: {
		readonly registry: {
			readonly baseUrl: string;
			readonly allowedRegistries: readonly string[];
		};
	};
}

export interface DplaaxBuildModulesOverrides {
	/** Override the keyStore module (test-only). */
	readonly keyStoreModule?: Module;
	/** Override the clientRepository module (test-only). */
	readonly clientRepositoryModule?: Module;
	/** Override the codeRepository module (test-only). */
	readonly codeRepositoryModule?: Module;
	/**
	 * Inject a custom `DidDocumentResolver` instead of the default `DplaaxDidResolver`.
	 * Used by integration tests to point at an in-process mock registry.
	 */
	readonly didResolver?: DidDocumentResolver;
	/**
	 * Override the DID grant's nonce (replay-protection) store. Defaults to
	 * `InMemoryNonceStore` (single-process PoC). Used by tests to inject a
	 * spy/fake, or by multi-replica deployments to swap in a shared-store
	 * implementation of `NonceStore`.
	 */
	readonly nonceStore?: NonceStore;
}

/**
 * Compose the dPLaaX auth-provider module list from `config`.
 *
 * Scope (v0.5 rescaffold): DID grant + minimal OAuth endpoints. No session,
 * no federation, memory-only code repository. Production deployments that
 * need multi-replica behaviour can swap in the Redis-backed modules from
 * `@o3co/auth-provider-redis` via the override surface.
 */
export function buildModules(
	config: DplaaxAppConfig,
	overrides: DplaaxBuildModulesOverrides = {},
): Module[] {
	const resolver =
		overrides.didResolver ??
		new DplaaxDidResolver(config.dplaax.registry.baseUrl, {
			allowedRegistries: config.dplaax.registry.allowedRegistries
				? Array.from(config.dplaax.registry.allowedRegistries)
				: undefined,
		});

	return [
		overrides.keyStoreModule ?? keyStoreModule,
		overrides.clientRepositoryModule ?? clientRepositoryModule,
		overrides.codeRepositoryModule ?? inMemoryCodeRepositoryModule,
		// `oauthModule` types `config` as the full upstream `AppConfig`.
		// dPLaaX deliberately omits the session / federation / rateLimit /
		// cors sections (see `DplaaxAppConfigBase` Pick above); the upstream
		// router gates every read of those sections on the corresponding
		// optional ComponentMap slot (`userSessionStore`, `federationProviders`,
		// `rateLimiter`), so the absent sections are safe. The cast is
		// localised here so changing `DplaaxAppConfigBase` to add a section
		// only requires editing one file.
		oauthModule({ config: config as unknown as AppConfig }),
		oauthDidModule({ resolver, nonceStore: overrides.nonceStore }),
	];
}
