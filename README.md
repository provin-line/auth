# provin auth

Authentication and authorization stack for the `provin` wire profile of the
dPLaaX protocol: libraries plus scaffold generators that produce per-deployment
composition roots of [auth.provider](https://github.com/o3co/auth.provider) and [auth.policy-verifier](https://github.com/o3co/auth.policy-verifier).

See [docs/requirements.md](docs/requirements.md) for what this repository provides.
See [upstream compatibility](docs/upstream-compatibility.md) before adopting
current auth-family candidate builds in an existing generated deployment.

> **Lineage**: this repository's history starts at the public cut, not at the
> start of the work. The code grew up in a private PoC auth stack for dPLaaS,
> and was carried over when the project moved to the dplaax protocol namespace
> (`did:dplaax`, the DID grant — now
> `https://dplaax.dev/oauth/grant-type/did`) and the `@provin-line` npm scope.
> That predecessor was retired rather than published, so there is no upstream
> repository to link to; the earliest commit here is the snapshot the public
> line begins from. See [CHANGELOG.md](CHANGELOG.md) for what each release
> since then contains.

## Instances

This repository does not operate services. Each dPLaaX deployment generates
its own composition roots with the scaffold generators
([docs/create-app.md](docs/create-app.md)):

| Generator | Generates | Default port |
| --- | --- | --- |
| [create-auth-provider](packages/create-provider/) | auth.provider 0.18 app with the DID grant and a `did:dplaax` registry resolver | `HTTP_PORT`, 8080 by default (the published image and the dev composition set 3000) |
| [create-policy-verifier](packages/create-policy-verifier/) | Scope-based ABAC policy engine | 3001 |

## Packages

| Package | Description |
| --- | --- |
| [packages/did-grant](packages/did-grant/) | `@provin-line/auth-did-grant` — the DID grant as an auth.provider 0.18 module |
| [packages/dplaax-registry](packages/dplaax-registry/) | `@provin-line/auth-dplaax-registry` — resolves `did:dplaax` owner DIDs against a DID registry |
| [packages/did-grant-store](packages/did-grant-store/) | `@provin-line/auth-did-grant-store` — keeps the DID grant's spent nonces on the kernel's `store` |
| [packages/did-dplaax](packages/did-dplaax/) | `@provin-line/did-dplaax` — the `did:dplaax` method library |
| [packages/policy-verifier-dplaax-module](packages/policy-verifier-dplaax-module/) | dPLaaX collectors for the policy-verifier |
| [packages/create-provider](packages/create-provider/), [packages/create-policy-verifier](packages/create-policy-verifier/) | The generators |

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

The DID grant ([`@provin-line/auth-did-grant`](packages/did-grant/README.md),
resolving through [`@provin-line/auth-dplaax-registry`](packages/dplaax-registry/README.md))
issues tokens under a P0 auth contract (dplaax.spec). This section documents
what actually ships today, not the full target contract; the package READMEs
hold the settings and every answer.

### Contract ids

| Contract id | Status | Notes |
| --- | --- | --- |
| `LEGACY_DID_LOGIN@1` | Default, active | Relationship-blind (no `authentication`/`assertionMethod` check); controller-matched key selection only; capped by `legacy-max-ttl` |
| `OWNER_AUTHENTICATION_LOGIN@1` | Active, wired | Fork-Y: the signing key must be string-referenced in the DID Document's `authentication` array |
| `OWNER_ASSERTION_CONTROL_LOGIN@1` | Active, wired | The signing key must be string-referenced in the DID Document's `assertionMethod` array |

The contract is the `did-grant.auth-contract` setting. An `OWNER_*` contract
runs the OWNER validation path against the request:

1. **Versioned login transcript.** The signed payload is a
   `login-transcript-v1` transcript: all eleven fields required and
   non-empty, `domain_separation_tag` pinned to `dplaax-owner-login-v1`. A
   request whose signed payload is not a valid transcript, the LEGACY message
   shape included, is refused. The transcript's `did` and `subject_did` must
   agree.
2. **Exact method-id selection and relationship check.** The transcript's
   `verification_method` must be *string*-referenced in the relationship the
   contract names; an embedded method object never satisfies it (rule
   `auth.forky.authentication-login`). It must be the method whose key
   verified the signature.
3. **Three-way kid match.** The JWS protected header's `kid`, the
   transcript's `verification_method` and the resolver-selected method id
   must agree (rule `auth.grant.kid-match`). This needs a JWS protected
   header, so `ed25519_raw` and `ed25519_prehash` are refused at boot for an
   OWNER contract.
4. **Audience required.** `audience` is one of the eleven fields, so an OWNER
   request that omits it is refused. A minted OWNER token always carries
   `aud`.
5. **Issuer and token-endpoint binding.** The transcript's `issuer` and
   `token_endpoint` must be this provider's: `issuer.url`, and the token
   endpoint's location on `http.public-origin`. An OWNER contract does not
   boot where the token endpoint has no public location.

An `OWNER_*` contract also needs `did-grant.owner-migration-ratified = true`
(rule `auth.migration.enable-gate`). A DID Document with more than one
`verificationMethod` whose `controller` is the authenticating DID is not yet
supported on the OWNER path: key selection refuses it as ambiguous before the
relationship check runs. Genuine multi-key OWNER selection is follow-up work.

### Token claims

Every minted token carries these six claims:

| Claim | Value |
| --- | --- |
| `auth_contract_id` | The configured `auth-contract` |
| `verification_method` | The selected `verificationMethod`'s `id`: the OWNER-certified method on the OWNER path, the controller-matched method on LEGACY |
| `did_document_snapshot` | `sha256:<64-hex>`: digest of the exact bytes the registry served for the DID Document |
| `lifecycle_state_ref` | `registry:<origin>#<digest>`: a stable pointer to that exact resolution snapshot |
| `lifecycle_freshness_ref` | RFC 3339 UTC instant the resolution was performed |
| `authorization_scope` | Always `AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1`, the only scope this module mints |

They are signed into the JWT through auth.provider's added claims. Tokens
minted at `/oauth/token` are bound to the client that endpoint authenticated
(RFC 9068 §2.2): `client_id` carries its id, taken from the authenticated
client, never from the request body. That binding is what lets the client
revoke the token through RFC 7009 `/oauth/revoke`. `azp` is not written; `aud`
carries the audience.

`lifecycle_state_ref` / `lifecycle_freshness_ref` are a **documented P0
projection**, the registry snapshot digest plus the retrieval instant,
standing in until a real lifecycle service exists. There is no live freshness
cache behind them.

### Settings

The `did-grant` section ([package README](packages/did-grant/README.md#section)):

| Key | Required / Default | Notes |
| --- | --- | --- |
| `revocation-latency-bound` | **Required, no default** | `access-token-lifetime` must be at most this bound, or boot is refused |
| `access-token-lifetime` | **Required, no default** | The lifetime of the grant's tokens; for LEGACY also at most `legacy-max-ttl` |
| `legacy-max-ttl` | Default `15m` | Cap for `LEGACY_DID_LOGIN@1` tokens |
| `auth-contract` | Default `LEGACY_DID_LOGIN@1` | See Contract ids above |
| `owner-migration-ratified` | Default `false` | Must be `true` before an `OWNER_*` contract boots |
| `supported-algorithms` | Default `["ed25519_raw"]` | Under an `OWNER_*` contract every entry must carry a JWS header (`ed25519_jws`, `es256_jws`, or a contributed one that says so) |
| `message-max-age` | Default `5m` | How far a message's timestamp may be from this host's clock |

Which audiences and scopes a client may be issued is the client's
`client-allowance` (`grants` must list the DID grant type), not a setting of
the grant. The `dplaax-registry` section holds `url` (required),
`allowed-registries`, `timeout` and `max-document-size`
([package README](packages/dplaax-registry/README.md#section)).

The generated provider ships secure-by-default settings: its
`config/application.conf` reads each from an environment variable and holds no
values (`.env.example` names them), and boot is refused without the two
required lifetimes.

**Audience-absent requests (LEGACY path only, intentional).** A LEGACY message
may omit `audience`: the token then gets the audience the client's allowance
issues by default (`client-allowance`'s `allowedIssuance`). The spec's audience-required rule binds the strict OWNER profile, which
fails closed on a missing `audience`; LEGACY was never bound by it.

### Resolver hardening / bounds

The registry module resolves through auth.provider's `outbound`, so its
destination policy and limits apply to every resolution:

- A finite timeout, default `5s` (`outbound.timeout`, narrowed by `timeout`)
- A response body cap, default 64 KiB (`outbound.max-response-size`, narrowed
  by `max-document-size`), enforced while streaming
- A concurrency limit, default 16 (`outbound.max-concurrent`, shared with every
  outbound caller); a request past it is refused at once
- Strict JSON decoding (rule `canon.strict-decode`): duplicate object keys,
  trailing data, invalid UTF-8 and unpaired surrogate escapes are refused;
  integers beyond 2^53 are kept exactly; unknown members, `__proto__`
  included, are preserved as own data properties
- Byte-exact id equality: the resolved document's `id` must equal the
  requested DID, with no normalization
- **Redirects are never followed**: the bytes always come from the requested
  URL's origin

### Failure semantics

- Registry **outage** (unreachable, HTTP 5xx, no answer in time, an answer over
  the size cap, a destination outbound refuses) or a nonce store that cannot
  tell: HTTP **503** `temporarily_unavailable` (INDETERMINATE: the DID may still
  be valid; a client can retry).
- Resolver or method-selection **rejection** (DID not found, malformed
  document, id mismatch, method not found, duplicate method id, a signature
  that does not verify, an OWNER transcript rejection): HTTP **400**
  `invalid_grant` (FAILED). Never `401`, which would ask the client to
  authenticate.
- Neither outcome ever mints a token.

### Liveness / known-limitations posture

- **No positive lifecycle cache exists.** `lifecycle_state_ref` /
  `lifecycle_freshness_ref` are a snapshot-at-resolution-time projection, not
  a live freshness service; any spec rule that expects a positive,
  continuously-refreshed liveness signal is vacuously satisfied (nothing
  claims fresher than "resolved at this instant").
- **Config is fail-closed by construction**: the lifetime bounds and the OWNER
  contract's gates reject insecure or missing values at boot rather than
  defaulting open.
- **The 503-vs-400 split** cleanly separates outage (retryable,
  INDETERMINATE) from rejection (FAILED); neither path mints a token.
- **No degraded mode is configurable**: resolution either succeeds within
  the bounds above, or the request fails.
- **Only `AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1` is ever minted.** Spec
  rules that bind a claim to "current authorization as of the request" are
  satisfied by this module simply never minting that kind of claim at P0
  (the spec's `CURRENT_AUTHORIZATION_AT_REQUEST@1` scope is not implemented
  here).

## E2E Tests

Cross-repo E2E scenarios live in [`provin-line/e2e`](https://github.com/provin-line/e2e)
(public). They run every node against `cmd/pdpstub` (allow-all) with a fixed
harness bearer, so they cover the node's credential gate and wireauth-signed
peer calls — never JWT issuance or a policy-decision deny. The real
three-layer auth stack (auth.provider + o3co policy-verifier) is exercised by
`provin-line/oss`'s `deploy/quickstart`, which is today's only working
verification path for auth integration.

## License

[Apache-2.0](LICENSE). Copyright 2026 1o1 Co. Ltd.
