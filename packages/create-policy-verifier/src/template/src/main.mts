import { fileURLToPath } from "node:url";
import { builtinCollectorsModule } from "@o3co/auth.policy-verifier.builtins";
import {
    AppConfigSchema,
    builtinKeyResolversModule,
    createApp,
} from "@o3co/auth.policy-verifier.server";
import { parseFile } from "@o3co/ts.hocon";
import { validate } from "@o3co/ts.hocon/zod";
import { resolveConfigPaths } from "./configPath.mjs";
import { createAppLogger } from "./logger.mjs";
import { installGracefulShutdown } from "./shutdown.mjs";
import { dplaaxModule } from "@provin-line/auth-policy-verifier-dplaax-module";

const env = process.env.CONFIG_ENV || process.env.NODE_ENV || "development";
const configDir = new URL("../config/", import.meta.url);
const configDirPath = fileURLToPath(configDir);
const { applicationConfPath, envConfPath } = resolveConfigPaths(configDirPath, env);

const config = validate(
    parseFile(envConfPath).withFallback(parseFile(applicationConfPath)),
    AppConfigSchema,
);

const logger = createAppLogger("dplaax-policy-verifier", config.logging.level);

const app = await createApp({
    pathResolver: import.meta.resolve,
    config,
    modules: [
        builtinCollectorsModule,
        builtinKeyResolversModule,
        dplaaxModule,
    ],
});

const server = app.listen(config.http.port, config.http.hostname, () => {
    logger.info(`dPLaaX policy-verifier listening on http://${config.http.hostname}:${config.http.port}`);
});

installGracefulShutdown(server, { logger });
