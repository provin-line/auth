# @provin-line/create-policy-verifier

Scaffold generator for dPLaaX policy-verifier deployment instances. Part of [dplaax.auth](../../README.md).

This package emits a runnable TypeScript project that boots
[`@o3co/auth.policy-verifier.server`](https://www.npmjs.com/package/@o3co/auth.policy-verifier.server)
with the dPLaaX attribute and rule collectors from
[`@provin-line/policy-verifier-dplaax-module`](../policy-verifier-dplaax-module/README.md) preregistered.
The template under `src/template/` is the canonical definition of an
instance — the repo keeps no standing reference instance.

See [docs/create-app.md](../../docs/create-app.md) for the architectural
decision and the consumer-facing pattern.

## Usage

### Monorepo-internal (development)

```bash
pnpm --filter @provin-line/create-policy-verifier exec node dist/cli.mjs <name> [options]
```

### Clone-then-run (consumer)

```bash
git clone https://github.com/provin-line/auth.git --branch <release-tag>
cd auth
pnpm install
pnpm --filter @provin-line/create-policy-verifier exec node dist/cli.mjs /abs/path/to/<name>
```

## CLI

```text
create-policy-verifier <name> [options]

Arguments:
  <name>                   Output directory + package.json name (positional, required)

Options:
  --description <text>     package.json description and README opener
  --port <n>               Default http.port in config/application.conf (default: 3001)
  --license <SPDX>         LICENSE file content + package.json field (default: Apache-2.0)
  --author <name>          package.json author field
  --git-init / --no-git-init   Run `git init` after scaffolding (default: enabled)
  --package-manager <pm>   Used in Makefile + README install instructions (default: pnpm)
  --out <path>             Output directory override (default: ./<name>)
```

## Generated instance shape

See [spec § 6.1](https://github.com/provin-line/scope/blob/main/scopes/spec.dplaax/.claude/specs/dplaax-create-app.spec.md#61-files-emitted)
for the complete file list. Common shape:

```text
<name>/
├── package.json          ($name, exact pins, git-subdir dep on policy-verifier-dplaax-module)
├── tsconfig.json
├── vitest.config.mts
├── src/
│   ├── main.mts          (boots @o3co/auth.policy-verifier.server + dplaaxModule)
│   ├── configPath.mts
│   ├── rules/.gitkeep    (consumer adds custom RuleCollectors here)
│   └── collectors/.gitkeep
├── config/
│   ├── application.conf
│   ├── development.conf  (env overlay placeholder)
│   └── production.conf
├── Dockerfile            (standalone, not workspace-aware)
├── docker-compose.yml
├── Makefile
├── AGENTS.md
├── CLAUDE.md
├── README.md
└── LICENSE
```

## Verification

Generator mechanics are unit-tested here (`generator.test.mts`,
`cli.test.mts`, `token-invariants.test.mts`). The generated artifact itself
is verified by the repo-level scaffold smoke (create-app.md § 6.3): every PR
generates, builds, boots, and health-checks an instance against the local
workspace state, and every push re-runs the same flow as a pure external
consumer (git-ref resolution, standalone Dockerfile).

## Distribution

`@provin-line/create-policy-verifier` is **not published to npm**. Consumers
clone the `provin-line/auth` repository at a tagged release and run the
generator via `pnpm --filter` (see Usage above).

## License

[Apache-2.0](./LICENSE). Copyright 2026 1o1 Co. Ltd.
