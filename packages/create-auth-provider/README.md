# @provin-line/create-auth-provider

Scaffold generator for dPLaaX auth.provider deployment instances. Part of [dplaax.auth](../../README.md).

This package emits a runnable TypeScript project that boots
[`@o3co/auth-provider-core`](https://www.npmjs.com/package/@o3co/auth-provider-core)
with the dPLaaX composition layer from
[`@provin-line/auth-provider-dplaax-module`](../auth-provider-dplaax-module/README.md)
preregistered (DID grant resolver, JWT key store, client + code repositories,
HOCON config schema). The template under `src/template/` is the canonical
definition of an instance — the repo keeps no standing reference instance.

See [docs/create-app.md](../../docs/create-app.md) for the architectural
decision and the consumer-facing pattern.

## Usage

### Monorepo-internal (development)

```bash
pnpm --filter @provin-line/create-auth-provider exec node dist/cli.mjs <name> --dplaax-module-ref <tag>
```

### Clone-then-run (consumer)

```bash
git clone https://github.com/provin-line/auth.git --branch <release-tag>
cd auth
pnpm install
pnpm --filter @provin-line/create-auth-provider exec node dist/cli.mjs /abs/path/to/<name> --dplaax-module-ref <release-tag>
```

## CLI

```text
create-auth-provider <name> --dplaax-module-ref <tag> [options]

Arguments:
  <name>                       Output directory + package.json name (positional, required)

Required:
  --dplaax-module-ref <ref>    Git ref pinned for @provin-line/auth-provider-dplaax-module
                               (exact tag — no default; see spec § 5.4)

Options:
  --description <text>         package.json description and README opener
  --port <n>                   Default http.port in config/application.conf (default: 3000)
  --license <SPDX>             LICENSE file content + package.json field (default: Apache-2.0)
  --author <name>              package.json author field
  --registry-base-url <url>    Default dplaax.registry.baseUrl in application.conf
  --git-init / --no-git-init   Run `git init` after scaffolding (default: enabled)
  --package-manager <pm>       Used in Makefile + README install instructions (default: pnpm)
  --out <path>                 Output directory override
```

## Generated instance shape

See [spec § 6.1](https://github.com/provin-line/scope/blob/main/scopes/spec.dplaax/.claude/specs/dplaax-create-app.spec.md#61-files-emitted)
for the complete file list. Provider-specific additions over the common
skeleton are `config/clients.yaml` (sample template, overwrite per
deployment) and `keys/` (placeholder directory for signing-key material).

## Verification

Generator mechanics are unit-tested here (`generator.test.mts`,
`cli.test.mts`, `token-invariants.test.mts`). The generated artifact itself
is verified by the repo-level scaffold smoke (create-app.md § 6.3): every PR
generates, builds, boots, and health-checks an instance against the local
workspace state, and every push re-runs the same flow as a pure external
consumer (git-ref resolution, standalone Dockerfile).

## Distribution

`@provin-line/create-auth-provider` is **not published to npm**. Consumers
clone the `provin-line/auth` repository at a tagged release and run the
generator via `pnpm --filter` (see Usage above).

## License

[Apache-2.0](./LICENSE). Copyright 2026 1o1 Co. Ltd.
