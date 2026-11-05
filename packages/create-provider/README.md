# @provin-line/create-auth-provider

Scaffold generator for dPLaaX auth.provider deployment instances. Part of [dplaax.auth](../../README.md).

This package generates an [auth.provider](https://github.com/o3co/auth.provider)
0.19 app composing the dPLaaX modules:

1. It calls the generator of `@o3co/auth-provider-scaffold` (pinned at exactly
   `0.19.0`) with a listed app of `@mod/token-endpoint`, `@mod/client-allowance`,
   `@mod/outbound`, `@mod/discovery` and `@mod/token-control` (revocation and
   introspection), and with [`@provin-line/auth-did-grant`](../did-grant/README.md),
   [`@provin-line/auth-did-grant-store`](../did-grant-store/README.md) and
   [`@provin-line/auth-dplaax-registry`](../dplaax-registry/README.md) as
   packages outside its release, read from a project pnpm installed them into.
   Upstream adds what they need to run and writes the app: `package.json`,
   `src/main.ts`, `config/application.conf` (with the provin sections' bindings,
   from each package's `config.example`), the `.example` settings files,
   `pnpm-workspace.yaml`, `Dockerfile`, `README.md`, `AGENTS.md`,
   `outside-modules.json` and `scripts/check-outside.mjs`. The app runs its
   sources (`node src/main.ts`); there is no build.
2. It patches what upstream does not write for them (`src/overlay/`, one pure
   function per patched file; see [docs/create-app.md § 3.5](../../docs/create-app.md)):
   the project's name and license, four bindings no module's example holds
   (`keys.signing.secret`, `keys.signing.secret-encoding`, `tokens.subject-check`,
   `tokens.access-token-lifetime`), the registry's default URL and how outbound
   reaches it, the DID grant in the example client, `@provin-line/did-dplaax` at
   its exact version in `minimumReleaseAgeExclude`, and the README's account of
   the modules.

Each generator version composes the provin packages at its own version, the
repository's one version (`PROVIN_PACKAGES`; npm holds them with provenance
from 0.6.0). With no `--outside-from`, the generator installs the modules into
a temporary project, `@provin-line/did-dplaax` coming with them, from the
registry your npm configuration names (a `.npmrc` in the directory you run it
from included), runs none of their lifecycle scripts, and removes the project
once the app is written, or when it is interrupted first.

`--outside-from <dir>` names a project where pnpm already installed the
modules: upstream's generator reads them from there, and the app records what
it read. It does not choose versions. Generation refuses, naming each package
and both versions, a project whose modules or `did-dplaax` are not this
release's, so an app holds exactly the provin packages its generator was
released with, whichever project they were read from.

The repo keeps no standing reference instance: the generator is the definition
of an instance ([create-app.md § 1.1](../../docs/create-app.md)).

## Usage

### Monorepo-internal (development)

`make instances` stages this checkout's packages (`scripts/stage-provin-packages.mjs`:
packed, served from a loopback registry, installed into a project) and runs:

```bash
node packages/create-provider/dist/cli.mjs <name> --outside-from <staged project>
```

### Clone-then-run (consumer)

```bash
git clone https://github.com/provin-line/auth.git --branch <release-tag>
cd auth
pnpm install
pnpm --filter @provin-line/create-auth-provider exec node dist/cli.mjs /abs/path/to/<name>
```

Then, in the generated app, install as its README's `## Packages outside this
release` says (`pnpm install --lockfile-only`, `node scripts/check-outside.mjs`,
`pnpm install --frozen-lockfile --ignore-scripts`), copy `.env.example` to
`.env` and `config/local.conf.example` to `config/local.conf` and fill them in
(its README names every key), and run
`APP_CONFIG=config/local.conf,config/application.conf node --env-file-if-exists=.env src/main.ts`.

## CLI

```text
create-auth-provider <name> [options]

Arguments:
  <name>                       Output directory + package.json name (positional, required)

Options:
  --outside-from <dir>         A project where pnpm installed the dPLaaX modules,
                               at this release's versions (default: the
                               generator installs them into a temporary project)
  --description <text>         package.json description and README opener
  --license <SPDX>             LICENSE file content + package.json field (default: Apache-2.0)
  --author <name>              package.json author field
  --registry-base-url <url>    Default DPLAAX_REGISTRY_URL in .env.example
  --git-init / --no-git-init   Run `git init` after scaffolding (default: enabled)
  --out <path>                 Output directory override
```

The app's port is `HTTP_PORT` and its host `HTTP_HOST`, set by the deployment.

## Verification

Generator mechanics are unit-tested here: each patch of the overlay
(`overlay.test.mts`), the real upstream generator into a temporary directory
(`generator.test.mts`, reading this checkout's packages, which the test run
stages once), the generator's own staging (`staging.test.mts`,
`staging-real.test.mts`, `generator-staging.test.mts`), the repository's
staging script (`stage-script.test.mts`) and the CLI (`cli.test.mts`). The generated app
is verified by the repo-level scaffold smoke ([create-app.md § 6.3](../../docs/create-app.md)):
every PR generates an instance, boots it against the local workspace state and
takes a DID-grant round trip, and every push re-runs the flow as an external
consumer (the provin packages from a registry, the standalone Dockerfile).

## Distribution

`@provin-line/create-auth-provider` is **not published to npm**. Consumers
clone the `provin-line/auth` repository at a tagged release and run the
generator via `pnpm --filter` (see Usage above).

## License

[Apache-2.0](./LICENSE). Copyright 2026 1o1 Co. Ltd.
