import { fileURLToPath } from "node:url";
import { AppConfigSchema } from "@o3co/auth.policy-verifier.server";
import { parseFile } from "@o3co/ts.hocon";
import { validate } from "@o3co/ts.hocon/zod";
import { describe, expect, it } from "vitest";

// The reading of the HS256 secret must be the issuer's, or every token is
// answered 401 with nothing at boot to say why. These pin that
// application.conf reads it as UTF-8 by default and takes
// OAUTH_JWT_SECRET_ENCODING over it, through the same loader main.mts uses.

const APPLICATION_CONF = fileURLToPath(new URL("../../../config/application.conf", import.meta.url));

/** application.conf validated with these variables set, and every other OAUTH_JWT_* variable unset. */
function loadedWith(env: Record<string, string>) {
  const saved = { ...process.env };
  for (const name of Object.keys(process.env)) if (name.startsWith("OAUTH_JWT_")) delete process.env[name];
  Object.assign(process.env, {
    OAUTH_JWT_ISSUER: "https://issuer.example",
    OAUTH_JWT_AUDIENCE: "https://audience.example",
    ...env,
  });
  try {
    return validate(parseFile(APPLICATION_CONF), AppConfigSchema);
  } finally {
    process.env = saved;
  }
}

describe("config/application.conf oauth.jwt.secretEncoding", () => {
  it("reads the secret as UTF-8 when nothing says otherwise", () => {
    const config = loadedWith({ OAUTH_JWT_SECRET: "template.test.secret.at.least.32.bytes.long" });
    expect(config.oauth.jwt.secretEncoding).toBe("utf8");
  });

  it("takes OAUTH_JWT_SECRET_ENCODING over the default", () => {
    const config = loadedWith({
      OAUTH_JWT_SECRET: Buffer.alloc(32, 0x5a).toString("base64"),
      OAUTH_JWT_SECRET_ENCODING: "base64",
    });
    expect(config.oauth.jwt.secretEncoding).toBe("base64");
  });

  it("refuses a reading the verifier does not know", () => {
    expect(() =>
      loadedWith({
        OAUTH_JWT_SECRET: "template.test.secret.at.least.32.bytes.long",
        OAUTH_JWT_SECRET_ENCODING: "latin1",
      }),
    ).toThrow();
  });
});
