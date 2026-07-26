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
import { fileURLToPath } from "node:url";
import {
	buildModules,
	DplaaxConfigSchema,
	type DplaaxAppConfig,
} from "@provin-line/auth-provider-dplaax-module";
import { createLogger, gracefulShutdown } from "@o3co/auth.utils";
import { type AppConfig, createApp } from "@o3co/auth-provider-core";
import { parseFile } from "@o3co/ts.hocon";
import { validate } from "@o3co/ts.hocon/zod";
import express from "express";
import { resolveConfigPaths } from "./configPath.mjs";

const logger = createLogger("auth-provider");

const env = process.env.CONFIG_ENV || process.env.NODE_ENV || "development";
const configDir = new URL("../config/", import.meta.url);
const configDirPath = fileURLToPath(configDir);
const { applicationConfPath, envConfPath } = resolveConfigPaths(
	configDirPath,
	env,
);

// `DplaaxConfigSchema` is structurally narrower than `DplaaxAppConfig` only
// because the Zod schema uses passthrough records for `repositories.*`. The
// validated shape is observationally identical to `DplaaxAppConfig`; assert
// here so the rest of the file works against the documented operational type.
const config: DplaaxAppConfig = validate(
	parseFile(envConfPath).withFallback(parseFile(applicationConfPath)),
	DplaaxConfigSchema,
) as unknown as DplaaxAppConfig;

await (async (): Promise<void> => {
	const app = express();
	app.set("trust proxy", config.http.trustProxy);

	const handle = await createApp({
		modules: buildModules(config),
		bootstrapComponents: {
			// `bootstrapComponents.config` types as the full upstream
			// `AppConfig`; the dPLaaX shape (per `DplaaxAppConfigBase`)
			// deliberately omits sections gated by optional ComponentMap
			// slots. See `buildModules` for the contract.
			config: config as unknown as AppConfig,
			pathResolver: import.meta.resolve,
		},
	});

	app.get("/_healthcheck", (_req, res) => {
		res.status(200).json({ status: "ok" });
	});

	app.use(handle.router);

	const server = app.listen(config.http.port, (): void => {
		logger.info(
			`auth-provider listening on http://localhost:${config.http.port}`,
		);
	});

	gracefulShutdown(server, () => handle.dispose());
})();
