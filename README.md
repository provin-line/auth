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

## P0 Auth Contract

The DID grant (`@provin-line/auth-provider-did`, composed into the resolver
`DplaaxDidResolver` from `@provin-line/auth-provider-dplaax-module`) issues
tokens under a P0 auth contract (dplaax.spec_draft). This section documents
what actually ships today, not the full target contract.

### Contract ids

| Contract id | Status | Notes |
| --- | --- | --- |
| `LEGACY_DID_LOGIN@1` | Default, active | Relationship-blind (no `authentication`/`assertionMethod` check); controller-matched key selection only; capped by `legacyMaxTtlSec` |
| `OWNER_AUTHENTICATION_LOGIN@1` | Built, **fail-closed** | Grant construction throws — see below |
| `OWNER_ASSERTION_CONTROL_LOGIN@1` | Built, **fail-closed** | Grant construction throws — see below |

**OWNER contracts do not work end-to-end today.** `createDidGrant` **throws
at construction time** (before any request is served) if `authContract` is
set to either `OWNER_*` value. The OWNER validation path — a versioned login
transcript (`login-transcript-v1`), the three-way kid match between the JWS
header `kid`, the signed transcript's `verification_method`, and the
resolver-selected method id, and the Fork-Y (`authentication`) relationship
check — is implemented and unit-tested (`validateOwnerLogin` in
`packages/auth-provider-did/src/transcript.mts`), but is **not wired into
the request handler** (`did.mts`'s `handle()`, which always runs the LEGACY
flow). Wiring it in and lifting this guard is tracked as follow-up work.
Selecting `authContract: OWNER_*` is refused at boot rather than silently
minting a token that claims OWNER-level assurance while only LEGACY
validation ran. Use `LEGACY_DID_LOGIN@1` until the OWNER path is enforced.

(An `OWNER_*` `authContract` also requires `ownerMigrationRatified: true`
and `tokenEndpoint` to even pass config-schema validation — but grant
construction refuses OWNER regardless of that gate.)

### Token claims

Every minted token carries these six claims:

| Claim | Value |
| --- | --- |
| `auth_contract_id` | The configured `authContract` (`LEGACY_DID_LOGIN@1` only, today) |
| `verification_method` | The selected `verificationMethod`'s `id` |
| `did_document_snapshot` | `sha256:<64-hex>` — digest of the exact bytes the registry served for the DID Document |
| `lifecycle_state_ref` | `registry:<origin>#<digest>` — a stable pointer to that exact resolution snapshot |
| `lifecycle_freshness_ref` | RFC 3339 UTC instant the resolution was performed |
| `authorization_scope` | Always `AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1` — the only scope this package ever mints |

`lifecycle_state_ref` / `lifecycle_freshness_ref` are a **documented P0
projection** — the registry snapshot digest plus the retrieval instant —
standing in until a real lifecycle service exists. There is no live/positive
freshness cache behind them.

### Config keys (`oauth.grants.did`)

| Key | Required / Default | Notes |
| --- | --- | --- |
| `allowedAudiences` | **Required, non-empty** | An empty or absent allowlist fails closed at construction (no "accept any audience" fallback) |
| `revocationLatencyBoundSec` | **Required, no default** | `oauth.accessToken.expiresIn` must be ≤ this bound, or grant construction throws |
| `legacyMaxTtlSec` | Default `900` | For `LEGACY_DID_LOGIN@1`, `expiresIn` must also be ≤ this bound |
| `authContract` | Default `LEGACY_DID_LOGIN@1` | See Contract ids above |
| `ownerMigrationRatified` | Default `false` | Must be `true` before an `OWNER_*` `authContract` even parses; construction still refuses OWNER regardless |

The `create-auth-provider` scaffold ships secure-by-default: its generated
`application.conf` sets `oauth.accessToken.expiresIn`,
`oauth.grants.did.revocationLatencyBoundSec`, and
`oauth.grants.did.legacyMaxTtlSec` all to `900` (15 minutes) out of the box.

**Audience-absent requests (LEGACY path only, intentional).** `allowedAudiences`
governs the server-side *allowlist* — it must be configured non-empty
(above). It does NOT force every request to carry an `audience` claim: on
the LEGACY path, a request that omits `audience` entirely is accepted and
mints a token with no `aud` restriction. This is intentional, not an
oversight — the spec's audience-required rule binds the strict OWNER
profile (`OWNER_AUTHENTICATION_LOGIN@1` / `OWNER_ASSERTION_CONTROL_LOGIN@1`),
which is fail-closed and not wired into the request handler yet (see
Contract ids above); LEGACY was never bound by that rule. An empty or absent
*allowlist* still fails closed regardless — this only concerns a request
that omits the claim.

### Resolver hardening / bounds

`DplaaxDidResolver`'s transport (`createBoundedFetch`) enforces a "resource
floor" every outbound DID resolution request must clear before its response
bytes are trusted:

- A finite timeout, default `5000` ms
- A response body cap, default 1 MiB (`1_048_576` bytes), checked while
  streaming, never after full buffering
- A concurrency limit, default `8`, shared across all requests through one
  resolver instance
- Strict JSON decoding — rejects duplicate object keys and trailing data
  after the root value (`JSON.parse` silently accepts both); unknown
  document members, including `__proto__`, are preserved as an own data
  property rather than stripped or used to pollute the prototype
- Byte-exact id equality — the resolved document's `id` must equal the
  requested DID exactly, with no normalization
- **The resolver never follows redirects** (`redirect: "error"`) — the
  connection that ultimately serves the bytes is always the requested URL
  itself, never wherever a redirect chain would have sent it (origin-pin)

### Failure semantics

- Resolver **outage** (registry unreachable, or reachable but failing
  transiently — network error, HTTP 5xx) → HTTP **503**
  `temporarily_unavailable` (INDETERMINATE: the DID may still be valid; a
  client can retry)
- Resolver or method-selection **rejection** (DID not found, malformed
  document, id mismatch, method not found, duplicate method id, etc.) → HTTP
  **400** `invalid_grant` (FAILED). The same mapping also covers a
  transcript rejection, for when the OWNER path is wired in — not reachable
  yet on today's LEGACY-only request flow.
- Neither outcome ever mints a token.
- Note: a cryptographic **signature-verification failure** returns HTTP
  **401** `invalid_grant` — this is pre-existing behavior, unchanged by the
  P0 auth-contract work, and is a separate (tracked, not fixed here)
  OAuth-conformance question of its own.

### Liveness / known-limitations posture

- **No positive lifecycle cache exists.** `lifecycle_state_ref` /
  `lifecycle_freshness_ref` are a snapshot-at-resolution-time projection, not
  a live freshness service — any spec rule that expects a positive,
  continuously-refreshed liveness signal is vacuously satisfied (nothing
  claims fresher than "resolved at this instant").
- **Config is fail-closed by construction** — the audience allowlist,
  lifetime bounds, and OWNER contract gate all reject insecure or missing
  values at boot rather than defaulting open.
- **The 503-vs-400 split** cleanly separates outage (retryable,
  INDETERMINATE) from rejection (FAILED); neither path mints a token.
- **No degraded mode is configurable** — resolution either succeeds within
  the bounds above, or the request fails.
- **Only `AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1` is ever minted.** Spec
  rules that bind a claim to "current authorization as of the request" are
  satisfied by this package simply never minting that kind of claim at P0
  (the spec's `CURRENT_AUTHORIZATION_AT_REQUEST@1` scope is not implemented
  here).
- The OWNER contracts' fail-closed posture is covered under Contract ids
  above.

## E2E Tests

Cross-repo E2E tests (including auth integration) live in [provin-line/e2e](https://github.com/provin-line/e2e).

## License

Private -- provin-line
