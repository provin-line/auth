# @provin-line/auth-provider-dplaax-module

dPLaaX composition layer for [`@o3co/auth-provider-core`](https://www.npmjs.com/package/@o3co/auth-provider-core) — module wiring, DID grant resolver, and HOCON config schema. Part of [dplaax.auth](../../README.md).

This package is the upstream dPLaaX extension that a deployment consumes alongside the o3co framework. A deployment's `main.mts` validates HOCON against `DplaaxConfigSchema`, then passes the result to `buildModules()` to compose the module list for `createApp()`. Atomic DID grant resolution (the `oauthDidModule` half) lives in the sibling [`@provin-line/auth-provider-did`](../auth-provider-did/README.md); this package layers composition + dPLaaX-specific defaults on top.

## What it provides

### Public surface

| Export | Role |
| --- | --- |
| `buildModules(config, overrides?)` | Compose the dPLaaX auth-provider module list for `createApp({ modules })`. |
| `DplaaxAppConfig` (type) | Operational config shape consumed by `buildModules`. |
| `DplaaxAppConfigBase` (type) | The `Pick<AppConfig, ...>` subset dPLaaX deployments populate. |
| `DplaaxBuildModulesOverrides` (type) | Test/runtime override surface (`keyStoreModule`, `clientRepositoryModule`, `codeRepositoryModule`, `didResolver`). |
| `DplaaxConfigSchema` | Zod schema that validates parsed HOCON against `DplaaxAppConfig`. |
| `DplaaxConfigParsed` (type) | `z.infer<typeof DplaaxConfigSchema>` for callers that want the zod-narrowed view. |
| `keyStoreModule` / `clientRepositoryModule` / `inMemoryCodeRepositoryModule` | Built-in module implementations. |
| `DplaaxDidResolver` | did:dplaax resolver enforcing owner-only DIDs + registry allow-list. |
| `parseDplaaxDid` / `validateDplaaxDid` / `classifyDplaaxDid` / `requireOwner` / `requireKnownPattern` / `getSupportedAccountTypes` / `isSupportedAccountType` | DID parser + validator helpers. |

### Default module composition

`buildModules(config)` returns, in order:

1. `keyStoreModule` — JWT signing key store (built-in adapters: local / jwks)
2. `clientRepositoryModule` — yaml-backed client registry (lifecycle-aware file watcher)
3. `inMemoryCodeRepositoryModule` — in-process OAuth code repository (PoC default; swap for Redis via the override)
4. `oauthModule` (upstream `@o3co/auth-provider-oauth`)
5. `oauthDidModule` (upstream `@provin-line/auth-provider-did`) wired with `DplaaxDidResolver`

Each module can be overridden via `DplaaxBuildModulesOverrides` — used by integration tests to inject mock registries and by production deployments to swap memory-backed repositories for Redis.

## Usage

```ts
import {
    buildModules,
    DplaaxConfigSchema,
    type DplaaxAppConfig,
} from "@provin-line/auth-provider-dplaax-module";
import {
    type AppConfig,
    createApp,
} from "@o3co/auth-provider-core";
import { parseFile } from "@o3co/ts.hocon";
import { validate } from "@o3co/ts.hocon/zod";

const config: DplaaxAppConfig = validate(
    parseFile(envConfPath).withFallback(parseFile(applicationConfPath)),
    DplaaxConfigSchema,
) as unknown as DplaaxAppConfig;

const handle = await createApp({
    modules: buildModules(config),
    bootstrapComponents: {
        config: config as unknown as AppConfig,
        pathResolver: import.meta.resolve,
    },
});
```

`config.dplaax.registry.baseUrl` points at the DID registry the resolver hits; `config.dplaax.registry.allowedRegistries` is the optional migration allow-list (per `DplaaxDidResolverOptions`).

## DID hierarchy

`DplaaxDidResolver` accepts only owner DIDs (`did:dplaax:<registry>:<accountType>:<accountId>`). Pipeline and process DIDs are out of scope for OAuth identity authentication and are handled via the Signer API downstream.

`classifyDplaaxDid` exposes the full hierarchy classifier (`"owner" | "pipeline" | "process" | null`) for callers that need the broader vocabulary beyond the owner-only resolver path. Note: `@provin-line/policy-verifier-dplaax-module` currently ships its own private parser for the same did:dplaax grammar; consolidating those two parsers behind this package is tracked as a follow-up.

## Distribution

This package is **not published to npm**. Consumers reference it via pnpm's git-subdirectory dependency form:

```jsonc
{
  "dependencies": {
    "@provin-line/auth-provider-dplaax-module":
      "github:provin-line/auth#<release-tag>&path:/packages/auth-provider-dplaax-module"
  }
}
```

See [create-app.md § 3.1 / § 3.3](https://github.com/provin-line/auth/blob/develop/docs/create-app.md) for the rationale and the consumer-facing scaffolding command.

## License

[Apache-2.0](./LICENSE). Copyright 2026 1o1 Co. Ltd.
