# @provin-line/create-auth-provider

Scaffold generator for dPLaaX auth.provider deployment instances. Part of [dplaax.auth](../../README.md).

This package generates an [auth.provider](https://github.com/o3co/auth.provider)
0.18 app and composes the dPLaaX modules into it:

1. It calls the generator of `@o3co/auth-provider-scaffold` (pinned at exactly
   `0.18.4`) with a listed app of `@mod/token-endpoint`, `@mod/client-allowance`,
   `@mod/outbound`, `@mod/discovery` and `@mod/token-control` (revocation and
   introspection). Upstream adds what they need to run and
   writes the app: `package.json`, `src/main.ts`, `config/application.conf`, the
   `.example` settings files, `Dockerfile`, `README.md`, `AGENTS.md`. The app runs
   its sources (`node src/main.ts`); there is no build.
2. It composes [`@provin-line/auth-did-grant`](../did-grant/README.md),
   [`@provin-line/auth-dplaax-registry`](../dplaax-registry/README.md) and
   [`@provin-line/auth-did-grant-store`](../did-grant-store/README.md) into the
   result (`src/overlay/`, one pure function per patched file; see
   [docs/create-app.md § 3.5](../../docs/create-app.md)) and adds
   `pnpm-workspace.yaml`, which pnpm 11 reads in place of `package.json#pnpm`.

The repo keeps no standing reference instance: the generator is the definition
of an instance ([create-app.md § 1.1](../../docs/create-app.md)).

## Usage

### Monorepo-internal (development)

```bash
pnpm --filter @provin-line/create-auth-provider exec node dist/cli.mjs <name> --dplaax-module-ref <sha>
```

### Clone-then-run (consumer)

```bash
git clone https://github.com/provin-line/auth.git --branch <release-tag>
cd auth
pnpm install
pnpm --filter @provin-line/create-auth-provider exec node dist/cli.mjs /abs/path/to/<name> --dplaax-module-ref <release-commit-sha>
```

Then, in the generated app: `pnpm install`, copy `.env.example` to `.env` and
`config/local.conf.example` to `config/local.conf` and fill them in (its
README names every key), and `APP_CONFIG=config/local.conf,config/application.conf pnpm start`.

## CLI

```text
create-auth-provider <name> --dplaax-module-ref <sha> [options]

Arguments:
  <name>                       Output directory + package.json name (positional, required)

Required:
  --dplaax-module-ref <sha>    Full 40-hex commit SHA of provin-line/auth the
                               dPLaaX modules are fetched at (no default)

Options:
  --allow-unpinned-ref         Accept a branch or tag for --dplaax-module-ref
                               (local iteration only; not publishable)
  --description <text>         package.json description and README opener
  --license <SPDX>             LICENSE file content + package.json field (default: Apache-2.0)
  --author <name>              package.json author field
  --registry-base-url <url>    Default DPLAAX_REGISTRY_URL in .env.example
  --git-init / --no-git-init   Run `git init` after scaffolding (default: enabled)
  --out <path>                 Output directory override
```

The app's port is `HTTP_PORT` and its host `HTTP_HOST`, set by the deployment.

## What the pin does

`--dplaax-module-ref` pins the three dPLaaX modules and, in
`pnpm-workspace.yaml`, the `@provin-line/*` packages they reach through
`workspace:*`. For a commit SHA it also writes the `allowBuilds` pnpm needs for
those git-fetched packages; for a branch or tag the first install stops with
pnpm's message naming the key to add ([create-app.md § 3.4](../../docs/create-app.md)).

## Verification

Generator mechanics are unit-tested here: each patch of the overlay
(`overlay.test.mts`), the real upstream generator into a temporary directory
(`generator.test.mts`) and the CLI (`cli.test.mts`). The generated app is
verified by the repo-level scaffold smoke ([create-app.md § 6.3](../../docs/create-app.md)):
every PR generates an instance, boots it against the local workspace state and
takes a DID-grant round trip, and every push re-runs the flow as a pure
external consumer (git-ref resolution, standalone Dockerfile).

## Distribution

`@provin-line/create-auth-provider` is **not published to npm**. Consumers
clone the `provin-line/auth` repository at a tagged release and run the
generator via `pnpm --filter` (see Usage above).

## License

[Apache-2.0](./LICENSE). Copyright 2026 1o1 Co. Ltd.
