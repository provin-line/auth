# provin auth

Authentication and authorization stack for the `provin` wire profile of the
dPLaaX protocol: libraries plus scaffold generators that produce per-deployment
composition roots of [auth.provider](https://github.com/o3co/auth.provider) and [auth.policy-verifier](https://github.com/o3co/auth.policy-verifier).

See [docs/requirements.md](docs/requirements.md) for what this repository provides.

> **Lineage**: forked from `dplaasio/auth` (the dPLaaS PoC auth stack) at `c23ff3f`,
> then renamed to the dplaax protocol namespace (`did:dplaax`, the DID
> grant — now `https://dplaax.dev/oauth/grant-type/did`) and the
> `@provin-line` npm scope.

## Instances

This repository does not operate services. Each dPLaaX deployment generates
its own composition roots with the scaffold generators
([docs/create-app.md](docs/create-app.md)):

| Generator | Generates | Default port |
| --- | --- | --- |
| [create-auth-provider](packages/create-auth-provider/) | DID-grant-only OAuth provider with `did:dplaax` resolver | 3000 |
| [create-policy-verifier](packages/create-policy-verifier/) | Scope-based ABAC policy engine | 3001 |

## Packages

| Package | Description |
| --- | --- |
| [packages/auth-provider-did](packages/auth-provider-did/) | `@provin-line/auth-provider-did` — DID authentication grant for OAuth 2.0 providers |

## Workspace Layout

This repo is a pnpm monorepo:

```text
auth/
├── packages/       # Libraries + scaffold generators (npm)
├── integration/    # Cross-package integration tests (private)
└── instances/      # Generated dev instances (git-ignored; `make instances`)
```

Use `pnpm install` at the repo root to bootstrap all workspaces.

## Quick Start

```bash
make instances    # generate dev composition roots into instances/
docker compose up
```

## Development

```bash
pnpm install      # bootstrap the workspace
pnpm -r test      # unit + integration tests
make instances    # regenerate dev instances from the templates
make smoke        # build, typecheck, boot + health-check both instances
```

## Architecture

```text
Client
  -> auth-provider instance (DID auth -> JWT)
  -> gRPC service with protobuf.interceptors
      -> policy-verifier instance (POST /verify -> allow/deny)
```

## E2E Tests

Cross-repo E2E tests (including auth integration) live in [provin-line/e2e](https://github.com/provin-line/e2e).

## License

Private -- provin-line
