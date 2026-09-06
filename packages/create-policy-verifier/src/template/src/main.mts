import * as verifierServer from "@o3co/auth.policy-verifier.server";
import type { Module as VerifierModule } from "@o3co/auth.policy-verifier.core";
import { fileURLToPath } from "node:url";
import { builtinCollectorsModule } from "@o3co/auth.policy-verifier.builtins";
import {
    AppConfigSchema,
    createApp,
} from "@o3co/auth.policy-verifier.server";
import { parseFile } from "@o3co/ts.hocon";
import { validate } from "@o3co/ts.hocon/zod";
import { resolveConfigPaths } from "./configPath.mjs";
import { createAppLogger } from "./logger.mjs";
import { installGracefulShutdown } from "./shutdown.mjs";
import { dplaaxModule } from "@provin-line/auth-policy-verifier-dplaax-module";

// Released 0.3.x resolves keys internally; current server requires this module.
const keyResolversModule = Reflect.get(verifierServer, "builtinKeyResolversModule") as VerifierModule | undefined;

const env = process.env.CONFIG_ENV || process.env.NODE_ENV || "development";
const configDir = new URL("../config/", import.meta.url);
const configDirPath = fileURLToPath(configDir);
const { applicationConfPath, envConfPath } = resolveConfigPaths(configDirPath, env);

const config = validate(
    parseFile(envConfPath).withFallback(parseFile(applicationConfPath)),
    AppConfigSchema,
);

// Released 0.3.x has no `logging` section; current server does. Read it if
// present so an instance honours `logging.level`, else fall back to LOG_LEVEL.
const logger = createAppLogger(
    "dplaax-policy-verifier",
    (config as { logging?: { level?: string } }).logging?.level,
);

const app = await createApp({
    pathResolver: import.meta.resolve,
    config,
    modules: [
        builtinCollectorsModule,
        ...(keyResolversModule ? [keyResolversModule] : []),
        dplaaxModule,
    ],
});

const server = app.listen(config.http.port, config.http.hostname, () => {
    logger.info(`dPLaaX policy-verifier listening on http://${config.http.hostname}:${config.http.port}`);
});

installGracefulShutdown(server, { logger });
