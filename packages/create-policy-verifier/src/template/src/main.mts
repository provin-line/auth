import { fileURLToPath } from "node:url";
import { builtinCollectorsModule } from "@o3co/auth.policy-verifier.builtins";
import {
    AppConfigSchema,
    createApp,
} from "@o3co/auth.policy-verifier.server";
import { createLogger, gracefulShutdown } from "@o3co/auth.utils";
import { parseFile } from "@o3co/ts.hocon";
import { validate } from "@o3co/ts.hocon/zod";
import { resolveConfigPaths } from "./configPath.mjs";
import { dplaaxModule } from "@provin-line/auth-policy-verifier-dplaax-module";

const logger = createLogger("dplaax-policy-verifier");

const env = process.env.CONFIG_ENV || process.env.NODE_ENV || "development";
const configDir = new URL("../config/", import.meta.url);
const configDirPath = fileURLToPath(configDir);
const { applicationConfPath, envConfPath } = resolveConfigPaths(configDirPath, env);

const config = validate(
    parseFile(envConfPath).withFallback(parseFile(applicationConfPath)),
    AppConfigSchema,
);

const app = await createApp({
    pathResolver: import.meta.resolve,
    config,
    modules: [builtinCollectorsModule, dplaaxModule],
});

const server = app.listen(config.http.port, config.http.hostname, () => {
    logger.info(`dPLaaX policy-verifier listening on http://${config.http.hostname}:${config.http.port}`);
});

gracefulShutdown(server);
