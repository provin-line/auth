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

// Zod schema for the HOCON-defined dPLaaX auth-provider config.
//
// Extends the upstream `CoreConfigSchema` with the dPLaaX additions: the
// `dplaax.registry.*` section, the per-deployment `endpoints.login.url`
// pointer, and a passthrough shape for `repositories.client` /
// `repositories.code` so HOCON adapter slices reach the runtime modules
// without zod ahead-of-time validation. Operational shape lives in
// `DplaaxAppConfig` (buildModules.mts); this schema is the runtime
// validator a deployment's `main.mts` runs against parsed HOCON.

import { CoreConfigSchema } from "@o3co/auth-provider-core";
import { z } from "zod";

/**
 * Validates the parsed HOCON config a deployment's `main.mts` loads.
 *
 * The resulting object is observationally identical to `DplaaxAppConfig`
 * (see buildModules.mts) — the difference is only in zod's narrower view
 * of `repositories.*` as passthrough records. Cast at the deployment's
 * main.mts boundary; the rest of the dPLaaX-extension code works against
 * `DplaaxAppConfig`.
 */
export const DplaaxConfigSchema = CoreConfigSchema.extend({
	endpoints: z.object({
		login: z.object({
			url: z.string().min(1),
		}),
	}),
	repositories: z
		.object({
			client: z
				.object({
					type: z.string(),
				})
				.passthrough(),
			code: z
				.object({
					type: z.string(),
				})
				.passthrough(),
		})
		.passthrough(),
	dplaax: z.object({
		registry: z.object({
			baseUrl: z.string().default("https://registry.dplaax.dev"),
			// Optional list of additional registry names to accept in DIDs'
			// registry segment beyond baseUrl's hostname. Used for migrations
			// (e.g., HUB-managed registry → independent self-hosted registry)
			// and for dev/local setups where the DID public identifier differs
			// from the HTTP endpoint (e.g., DID says "registry.test.local" but
			// baseUrl is "http://127.0.0.1:PORT").
			allowedRegistries: z.array(z.string()).default([]),
		}),
	}),
});

export type DplaaxConfigParsed = z.infer<typeof DplaaxConfigSchema>;
