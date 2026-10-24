# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, the public API (the `@provin-line/auth-provider-did`
module surface and the DID grant contract) may still change between minor
releases.

## [Unreleased]

### Added

- **`@provin-line/auth-dplaax-registry`**: provides the DID grant's
  `didDocuments` (`packages/dplaax-registry`).
  - It resolves did:dplaax owner DIDs at
    `<url>/did/<accountType>/<accountId>/did.json` through auth.provider's
    `outbound`, as the operator's own URL. The operator's destination policy
    decides between https (`outbound.internal-hosts`) and plain http to a
    private address (`outbound.plain-internal`).
  - Its section `dplaax-registry` replaces 0.15's `dplaax.registry.baseUrl`
    / `allowedRegistries` and `oauth.grants.did.resolver.*`: `url` (now
    required; 0.15 defaulted to `https://registry.dplaax.dev`),
    `allowed-registries`, `timeout` (5s) and `max-document-size` (64KiB,
    within `outbound.max-response-size`; 0.15 took 1 MiB).
  - Concurrency is outbound's `max-concurrent` (16, shared with every
    outbound caller): a request past it is refused at once (503), where 0.15
    queued it behind its own limit of 8.
  - Outcomes: rejected for a DID the registry does not hold (404 or another
    4xx) or bytes that are no document for it; unavailable for 5xx, no
    answer in time, a refused destination (a redirect included) and an
    answer over the size limit. outbound stops a large answer before its
    status is read, so an oversized document is now unavailable (503), where
    0.15 rejected it (400).
  - Decoding meets rule `canon.strict-decode`: invalid UTF-8 and unpaired
    surrogate escapes are refused, and integers beyond 2^53 are kept
    exactly. A copy of `strictJsonParse` lives here; the one
    `auth-provider-did` exports goes with that package.
- **`@provin-line/auth-did-grant-store`**: keeps the DID grant's spent nonces
  on `records` over the kernel's `store` (`packages/did-grant-store`), with
  the guarantees `spentNoncesNeeds` asks, as upstream's `jwt-bearer-store`
  does.
- **`@provin-line/auth-did-grant`**: the DID grant as an auth.provider 0.18
  module (`packages/did-grant`), beside the 0.15 `auth-provider-did`.
  - Its tokens carry the six claims of rule `auth.token.signed-claims`
    (`auth_contract_id`, `verification_method`, `did_document_snapshot`,
    `lifecycle_state_ref`, `lifecycle_freshness_ref`,
    `authorization_scope`) through auth.provider's added claims, signed
    into the JWT. `client_id` names the client; `azp` is no longer written.
  - The package exports the contract at `.`, the module at `./module` and
    `spentNoncesContract` at `./testing`. auth.provider's packages and zod
    are peers.
  - It takes two contracts it owns: `didDocuments` (the resolver) and
    `spentNonces` (the nonces already used). Custom signature algorithms
    are contributed at `signatureAlgorithms` instead of an injected
    `VerifierRegistry`, and say whether they carry a JWS header; the grant
    issues only when a verifier's subject and message are the requested
    DID's. Verifiers are made at boot, so a missing `@noble/ed25519`
    refuses boot instead of failing every request.
  - `es256k_jws` is no longer offered: jose does not verify ES256K on Node,
    so it never worked. A deployment that needs it contributes a verifier.
  - Its section `did-grant` replaces `oauth.grants.did`: lifetimes carry a
    unit, and `access-token-lifetime` is the grant's own. Audiences and
    scopes come from the client's `client-allowance` (`allowedAudiences` is
    gone), and the OWNER token endpoint comes from auth.provider's
    `tokenEndpointLocation` (`tokenEndpoint` is gone).
  - A failed signature is `400 invalid_grant`, never `401`. A resolver or
    nonce store that cannot tell answers `503`.
  - A message's nonce is kept until the message's own window closes, plus a
    minute for clock differences. It was kept for `message-max-age` from
    the request, which left a message stamped ahead of the clock usable
    once more.

### Changed

- **BREAKING (`create-auth-provider` 0.4.0): the generated provider is an
  auth.provider 0.18.4 app.** The generator calls auth.provider's own
  (`@o3co/auth-provider-scaffold`, pinned at exactly 0.18.4) for a listed app
  of `@mod/token-endpoint`, `@mod/client-allowance`, `@mod/outbound`,
  `@mod/discovery` and `@mod/token-control`, then composes `@provin-line/auth-did-grant`,
  `auth-dplaax-registry` and `auth-did-grant-store` into it
  (`packages/create-provider/src/overlay/`, one function per patched file).
  - The 0.15 template is gone. The app runs its sources
    (`node src/main.ts`), with no build, no `tsconfig.json` and no `dist/`;
    its settings are env variables read by `config/application.conf`, a local
    layer (`APP_CONFIG`) for lists, and a refused boot exits 78. Existing
    0.15 instances do not carry over: auth.provider 0.18 reads different
    keys and records.
  - Revocation (`POST /oauth/revoke`) and introspection
    (`POST /oauth/introspect`) are `@mod/token-control`'s, as the 0.15
    provider answered them. Introspection refuses public clients. With
    `tokens.revocation = denylist` it answers a revoked token inactive; a
    verifier that reads the JWT alone accepts it until it expires.
  - Added to upstream's app: the did-grant, dplaax-registry and
    `keys.signing.secret` / `secret-encoding` keys and variables (a
    deployment sharing an HS256 secret with a policy-verifier sets
    `utf8`), the DID grant type in the example client's allowance, the
    registry in `outbound.allow` and `outbound.plain-internal`, and
    `tokens.subject-check` (boot requires it, or a module that checks
    subject revocation, which this app does not compose).
  - `pnpm-workspace.yaml` (pnpm 11 no longer reads `package.json#pnpm`)
    pins `@provin-line/did-dplaax` and `@provin-line/auth-did-grant` to the
    same ref, sets `blockExoticSubdeps: false` for those git sources below the
    app's direct dependencies, and allows the git-fetched packages their
    `prepare` through `allowBuilds`, keyed by the source pnpm resolves
    (docs/create-app.md § 3.4). For a branch or tag under
    `--allow-unpinned-ref` no `allowBuilds` is written and the first install
    names the key to add.
  - Removed CLI flags and exports: `--port` (the port is `HTTP_PORT`),
    `--package-manager` (upstream's app is pnpm), and `DEFAULT_PORT` and
    `DEFAULT_PACKAGE_MANAGER` from the package. `DEFAULT_DEP_VERSIONS` now
    holds only what the overlay adds (`@noble/ed25519`), and
    `LISTED_MODULES` is new. `--registry-base-url` is the default
    `DPLAAX_REGISTRY_URL` of `.env.example`.
  - **Runtime contract of the published `auth-provider` image.** It runs
    the generated app, so the 0.15 variables (`OAUTH_JWT_*`,
    `DPLAAX_REGISTRY_BASE_URL`, `CLIENT_REPOSITORY_PATH`, `HTTP_PORT` aside)
    no longer mean anything. A container sets the 0.18 variables
    `config/application.conf` reads (`KERNEL_DEPLOYMENT`,
    `STORE_ACCEPT_VOLATILE`, `TOKENS_REVOCATION`, `TOKENS_SUBJECT_CHECK`,
    `HTTP_PUBLIC_ORIGIN`, `HTTP_INSECURE_ORIGIN`, `ISSUER_URL`,
    `KEYS_SIGNING_*`, `DID_GRANT_*`, `DPLAAX_REGISTRY_URL`) and mounts a local
    layer of lists (`outbound.allow`, `audit.receivers`,
    `clients.registered`) named by `APP_CONFIG`
    (`config/local.conf,config/application.conf`); the dev composition's
    `deploy/dev/provider.local.conf` is an example. The image listens on
    `HTTP_HOST=0.0.0.0` and `HTTP_PORT=3000` (the app's own default is
    8080). `--registry-base-url` in `publish-images.yml` now only fills the
    generated examples; the registry at runtime is `DPLAAX_REGISTRY_URL`.
  - The scaffold smoke, CI and image build follow: `make smoke` boots the
    provider's sources against a throwaway DID registry on loopback and
    checks a DID-grant round trip (HS256 over the secret's UTF-8 bytes, the
    six signed claims, a tampered signature rejected); its ports are
    `PROVIDER_PORT` and `VERIFIER_PORT`. The root workspace overrides map the
    three new packages to `workspace:*`. `Dockerfile.instance`,
    `deploy/generated-instance.Dockerfile` and `publish-images.yml` take an
    `ENTRY` (`src/main.ts` for the provider, `dist/main.mjs` for the
    policy-verifier) and build only if the instance has a build script. The
    dev `docker-compose.yml` configures the provider with the 0.18 variables
    and `deploy/dev/provider.local.conf`.
- **BREAKING (types, verifier packages): the policy-verifier baseline is
  0.17.0.** 0.17.0 makes `secretEncoding` required in the `AppConfig`
  type's `oauth.jwt` and in `Hs256Rotation`, and the dPLaaX verifier module
  requires `^0.17.0`, so a consumer moves its three verifier packages
  together. Configuration read through `AppConfigSchema` is unaffected.
  Workspace packages require
  `@o3co/auth.policy-verifier.{core,builtins,server}` `^0.17.0`, and
  `create-policy-verifier` (now 0.4.0) emits the same as exact pins.
  - 0.17.0 adds `oauth.jwt.secretEncoding`, how the HS256 secret becomes
    key bytes. The default, `"utf8"`, is the reading earlier verifiers
    applied, so nothing changes for a deployment that does not set it. The
    generated verifier now writes `secretEncoding = "utf8"`, overridable
    with `OAUTH_JWT_SECRET_ENCODING`. That is the reading the auth.provider
    0.18 this repository is moving to will be configured with.
  - 0.16.3 reads the client from `client_id` as well as `azp`, which
    auth.provider 0.18's tokens need.
  - The generated verifier also emits `@o3co/ts.hocon` 1.14.3 (was 0.1.5),
    pino 10.4.0, `@types/node` 26.6.5 and vitest 5.0.5. These are the newest
    releases inside the ranges upstream's own verifier template declares.
  - [docs/upstream-compatibility.md](docs/upstream-compatibility.md#moving-an-existing-verifier-instance-to-017)
    lists what an existing instance changes.
- **The workspace toolchain follows upstream auth.provider 0.18.4**: pnpm
  11.28.7, TypeScript 6.0.3, vitest 5.0.5, `@types/node` 26.6.5.
  - The base tsconfig names `types: ["node"]`, because TypeScript 6 no
    longer loads every `@types` package by default.
  - `engines.node` is `>=24.22.1` with no upper bound, and CI builds and
    tests on Node 24.22 and 26.
  - Other dependencies move to: jose 6.2.13, `@noble/ed25519` 3.2.0, zod
    `^4.6.7` (still overridden to 4.6.7).
- **pnpm settings move from `package.json#pnpm` to `pnpm-workspace.yaml`.**
  - `overrides` keeps the same entries, with vite raised to `^8.3.3`.
  - `minimumReleaseAgeExclude` lets a fresh `@o3co/*` release install
    despite pnpm 11's one-day hold.
  - `allowBuilds` denies bcrypt's install script. pnpm 11 refuses an install
    whose dependency build scripts are neither allowed nor denied. bcrypt
    ships prebuilt binaries, and pnpm 10 had skipped the script too.

### Security

- body-parser 2.4.0 in the lockfile ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828):
  denial of service via trailing bytes after a compressed request body). It
  is reached through express under the 0.15 provider, the verifier server
  and the integration suite.

## [0.4.0] - 2026-10-22

A minor number, not a patch: the policy-verifier baseline moves to 0.16.1,
which changes `/verify`'s answer for JWKS-verifying deployments (`503`
instead of `401` when the keys cannot be fetched), and that must not reach
consumers that track the moving `v0.3` image tag. provin.oss's quickstart pins
`v0.3` and moves to `v0.4` on its own schedule.

It includes 0.3.1's security fixes (Node.js 24.22.1 under every image, the
refreshed lockfile entries), and adds the generated scaffolds' vitest 4.1.12
pin and Dependabot updates for the Node minor pin.

### Changed

- **BREAKING (wire, JWKS-verifying deployments only): the policy-verifier
  baseline is 0.16.1.** Workspace packages require
  `@o3co/auth.policy-verifier.{core,builtins,server}` `^0.16.1`, and
  `create-policy-verifier` (now 0.3.0, per create-app.md § 3.3) emits the
  same as exact pins. zod is pinned to 4.6.7 in the workspace and in the
  generated verifier's `pnpm.overrides` (server 0.16.1 requires `^4.6.6`).
  The bump needs no code change here: 0.13–0.16 otherwise change surfaces
  this composition does not use (Cedar engines, static role/permission
  collectors, delegated-token ranges, caller authentication).

  What changes on the wire: a verifier configured with `OAUTH_JWT_JWKS_URI`
  that cannot get the keys a token needs (fetch failure or timeout, non-200,
  a body that is not a key set) answers `503 verification_unavailable`
  instead of `401 invalid_token`. A cached key set keeps verifying through an
  outage only until it is `oauth.jwt.jwksCacheMaxAgeMs` old (upstream
  default 10 minutes). A token that fails verification is still `401`. The
  generated verifier uses a shared HS256 secret unless `OAUTH_JWT_JWKS_URI`
  is set, and only then is it affected. If it is: alerts, SLOs, retry-on-5xx
  and mesh outlier detection now see an IdP outage as 5xx, and
  provin.oss's `protobuf.interceptors` endpoint reports it to the caller as
  an internal error rather than as unauthenticated. See
  [upstream compatibility](docs/upstream-compatibility.md) for existing
  instances.

### Fixed

- The generated verifier passes its pino logger to `createApp`, so the
  verifier's own lines (e.g. `jwt_verification_unavailable`,
  `unauthenticated_non_loopback_bind`) are NDJSON instead of console text.
- `policy-verifier-dplaax-module`'s docs no longer say that the upstream
  evaluator allows a request no rule applies to. They state its
  deny-by-default (`onEmptyRuleSet`, upstream's default since 0.4.0) and why
  `DefaultDenyRuleCollector` stays enabled.

### Security

Node.js 24.22.1 (`node:24.22-alpine` under every image) and the refreshed
lockfile entries (proxy-addr, brace-expansion, source-map-js, vite, vitest)
shipped in 0.3.1. On top of them:

- **Dependabot keeps the Node minor pin current.** A minor tag such as
  `node:24.22-alpine` stops receiving updates once a newer minor ships, so
  Dependabot's `docker` ecosystem now proposes those bumps for this
  repository's Dockerfiles.
- **Generated scaffolds pin vitest 4.1.12** (`@vitest/mocker`:
  GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp), so a newly generated instance,
  and the published images, start on it. `create-provider` is now 0.3.0, per
  create-app.md § 3.3. An already generated instance moves its own `vitest`
  pin by hand.

## [0.3.1] - 2026-10-22

A patch on the 0.3 line, so the moving `v0.3` image tag that provin.oss's
quickstart pins picks up the Node.js and proxy-addr fixes below. It changes
no behaviour, configuration or wire answer; the policy-verifier 0.16
baseline ships in 0.4.0.

### Security

- **Node.js 24.22.1, the October 2026 security release** (eight CVEs on the
  24.x line, four of them high: two TLS hostname-verification bypasses, a
  Brotli decoder out-of-bounds write, and DNS name truncation). Every image
  builds on `node:24.22-alpine` instead of the floating `node:24-alpine`:
  the published images (`deploy/generated-instance.Dockerfile`), the dev
  composition image (`Dockerfile.instance`) and both generator templates,
  so a newly generated instance starts on it. An already generated instance
  keeps its own Dockerfile; change its `FROM` line by hand. CI installs the
  newest 24.22 patch (`check-latest`), and `engines.node` is
  `>=24.22.1 <25`.
- Refresh vulnerable lockfile entries: proxy-addr 2.0.8
  (GHSA-jqcg-44mw-7w3h, via express), brace-expansion 5.0.12
  (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p),
  source-map-js 1.2.2 (GHSA-68fv-2mgg-jv7q), vite 8.3.4 (GHSA-587h-7wmj-h5pm,
  GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-9jrq-w75r-8gcw,
  GHSA-rq7h-c2jc-7f22) and vitest 4.1.12 (`@vitest/mocker`:
  GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp). Only proxy-addr is a runtime
  dependency; the rest is test and build tooling.
- Generated scaffolds, and therefore the published images, keep their
  vitest 4.1.11 development pin, which carries the two `@vitest/mocker`
  advisories (development-only). 0.4.0 moves it.

## [0.3.0] - 2026-09-24

A minor number, unlike 0.2.1's patch: this release carries a breaking
configuration change (`audit.sink.type = "none"` no longer boots) and new
public exports, and it must not reach consumers that track the moving `v0.2`
image tag. provin.oss's quickstart pins `v0.2` and moves to `v0.3` on its own
schedule.

The auth baseline is now the latest upstream (provider 0.15.0, verifier
0.12.0). The provider composition records audit events and can revoke tokens —
by RFC 7009 for the client a DID token was issued to, and by subject for every
token already issued to a DID — and `deployment.mode = "multi"` refuses to boot
on in-process stores. The OWNER login contracts are wired into the DID grant.

### Added

- **The provider composition wires every security capability upstream can
  read, instead of declaring them absent.** Previously a DID-issued token could
  not be revoked before it expired, and no audit event was recorded.
  `buildModules` now includes:
  - `auditSinkModule` (new export): the sink named by `audit.sink.type`,
    `"console"` by default. `token.issued` and `token.issued.failure` events
    now reach stdout. `createAuditSinkModule({ registerSinks })` (new export)
    builds the same module with additional sinks for `audit.sink.type` to
    select.
  - core's `memoryAccessTokenDenylistModule`: RFC 7009 revocation of an access
    token writes to it, and the provider's verification and introspection
    consult it. With the client binding (see Changed), the client a DID token
    was issued to can now revoke it.
  - `inMemorySubjectRevocationModule` (new export): the `subjectRevocation` /
    `subjectSessionIndex` pair. `subjectRevocation.revokeBefore(did, …)`
    invalidates every token already issued to that DID.

  Both kinds of revocation take effect where the provider verifies a token.
  A resource server that verifies JWTs locally against the JWKS, such as the
  generated policy-verifier, consults neither store; the token lifetime is
  still its bound. The two in-memory stores are single-process and declare
  themselves replica-unsafe.
  `DplaaxBuildModulesOverrides` gains `auditSinkModule`,
  `accessTokenDenylistModule` and `subjectRevocationModule`, so a
  multi-replica deployment can pass shared implementations.

- The OWNER login contracts (`OWNER_AUTHENTICATION_LOGIN@1`,
  `OWNER_ASSERTION_CONTROL_LOGIN@1`) are now wired into the DID grant's
  request handler. `handle()` dispatches on the configured `authContract`:
  `LEGACY_DID_LOGIN@1` is unchanged; either `OWNER_*` value now requires and
  enforces a versioned login transcript (`login-transcript-v1`, now eleven
  required fields — see Changed, below) — the three-way match between the
  JWS header `kid`, the transcript's `verification_method`, and the
  resolver-selected method id (`auth.grant.kid-match`), explicitly checked
  against the crypto-verified method too; the Fork-Y relationship check
  (`authentication` for `OWNER_AUTHENTICATION_LOGIN@1`, `assertionMethod`
  for `OWNER_ASSERTION_CONTROL_LOGIN@1`); and a required `audience` claim.
  A minted OWNER token always carries `aud` and its actually-enforced
  `auth_contract_id`. Three boot-time asserts on `createDidGrant`, all
  mirroring the existing `allowedAudiences` / `revocationLatencyBoundSec`
  fail-closed style, now gate an OWNER `authContract`:
  `oauth.grants.did.tokenEndpoint` must be configured;
  `ownerMigrationRatified` must be `true` (rule `auth.migration.enable-gate`
  — re-asserts what `didConfigSchema` already requires at parse time, for a
  hand-built config that skips it); and every configured
  `supportedAlgorithms` entry must be header-bearing (JWS-family —
  `ed25519_raw` / `ed25519_prehash` sign no JWS protected header at all, so
  the three-way kid match is unsatisfiable on them; this includes the
  `didConfigSchema` default of `["ed25519_raw"]`). See
  [README.md § P0 Auth Contract](README.md#p0-auth-contract).

### Changed

- **`@o3co/auth.utils` is no longer emitted into generated `package.json`.**
  Its two helpers live in the scaffold (above). This was the package's last
  consumer across the auth family.

- **BREAKING (config): the provider composition no longer accepts security
  capabilities declared absent.** `buildModules` now wires an audit sink, an
  access-token denylist and the subject-revocation pair (see Added), so
  `audit.sink.type = "none"` fails boot. That refusal is this composition's
  policy: core would accept `"none"` as a declared absence, but the slot is
  always filled here. `DplaaxConfigSchema` now takes any sink name instead of
  only `"none"`. The generated `application.conf` selects
  `audit.sink.type = "console"` (override: `AUDIT_SINK_TYPE`) and
  `oauth.revocation.accessToken = "denylist"`, and drops
  `revocation.subject = "unsupported"`. For instances generated earlier, only
  the `"none"` line breaks boot; the migration is in
  [upstream compatibility](docs/upstream-compatibility.md).

- **DID-issued tokens are bound to the authenticated client.** The DID grant
  used to stamp `azp` with the token's *audience* and mint no `client_id`, so
  a token named no owning client. It now sets `client_id` and `azp` to the
  client that `/token` authenticated (RFC 9068 §2.2) — never the request
  body's `client_id` — and mints neither when there is none. `aud` still
  carries the audience. No consumer in the provin family reads `azp`.

- **`deployment.mode = "multi"` is enforced.** `DplaaxConfigSchema` used to
  strip `deployment`, so core's replica-safety guard never saw it and an
  instance booted multi-replica on in-process stores. The schema now keeps
  it, `DplaaxAppConfig` carries it, and the template reads it from
  `DEPLOYMENT_MODE`. `inMemoryCodeRepositoryModule`, and `oauthDidModule` when
  it falls back to its in-process nonce store, now declare themselves
  replica-unsafe as well, so `"multi"` refuses to boot until every in-process
  store is replaced.

- **The auth baseline is the released upstream, not a 0.3.x / 0.5.x pin with a
  compatibility shim.** Every workspace package now requires
  `@o3co/auth.policy-verifier.{core,builtins,server}` `^0.12.0` and
  `@o3co/auth-provider-{core,oauth}` `^0.15.0` — the latest releases — and the
  generators emit the same as exact pins (`DEFAULT_DEP_VERSIONS`: 0.12.0 /
  0.15.0), with both generators bumped to 0.2.0 per create-app.md § 3.3.
  `create-provider` also emits `express-session`, a peer of
  `@o3co/auth-provider-oauth` since 0.11.0, as an exact pin. Upstream core
  `evaluate()` is async since verifier 0.10.0; no production code here called
  it. The dual-path shim that let the collectors
  read `payload` or `subject` and reach `readUntrustedRequestContext` by
  reflection (`collectors/context.mts`) is removed: collectors read
  `context.subject` and call `readUntrustedRequestContext` directly, and the
  policy-verifier template and the integration test import
  `builtinKeyResolversModule` rather than probing for it. The code had already
  crossed the intervening upstream BREAKING changes; what changes here is that
  the released-0.3.x branch of each dual path is gone. `@o3co/ts.hocon` stays
  at its current pin — its 0.1 → 1.x move is a separate migration.

- Refresh vulnerable transitive lockfile entries: js-yaml 4.3.2, qs 6.16.0,
  nanoid 3.3.18 and brace-expansion 5.0.9. CI audits the dependency graph.
  vitest and @vitest/coverage-v8 move to `^4.1.11` (GHSA-82fw-gwwq-j7x9,
  path traversal via the @vitest/mocker redirect mock), and both generators
  emit vitest 4.1.11.
- Prepare generated instances for current upstream auth: align Zod 4.5.4, wire
  separated JWKS/key-resolver modules, update required configuration and support
  verified subject bags plus explicitly untrusted request context.
- Generated Verifiers now require an explicit Owner DID rule on the declared
  surface instead of relying on empty-rule allow. Scopeless DID tokens skip only
  the scope group; undeclared operations and non-Owner subjects remain denied.
  See [upstream compatibility](docs/upstream-compatibility.md) for migration.

- `login-transcript-v1` (unreleased) gains an eleventh required field,
  `did`, alongside the existing `subject_did` — `validateOwnerLogin` now
  also checks `transcript.did === transcript.subject_did`. `did` is the
  field name every built-in signature verifier's own internal payload-binding
  check already reads (`parsedMessage.did !== did`); the transcript needed
  its own copy under that exact name so a real signed request can satisfy
  both that check and `parseLoginTranscript`'s field requirements from a
  single signed payload — previously, no signed payload could actually be
  simultaneously valid for both, so the wired-in Added item above shipped
  correct only against test fixtures that added the field without it being
  part of the documented schema.

### Fixed

- **Generated instances never logged NDJSON.** Both scaffolds took their logger
  from `@o3co/auth.utils`, which treats pino as an *optional* peer and falls
  back to `console` when the import fails — and the generator never emitted
  pino, so every instance created by `create-provider` or
  `create-policy-verifier` logged bare `[name] …` console lines that no
  aggregator parses. The scaffold now ships its own `src/logger.mts` on pino
  (a direct runtime dependency, exact-pinned like the rest), honouring
  `logging.level` from the application config with `LOG_LEVEL` as the
  environment override, and serialising `err` so an Error keeps its stack.

- **Generated instances could hang on SIGTERM and always exited zero.** The
  same package's `gracefulShutdown` called `server.close()` with no deadline,
  so one stuck request meant the process never exited on its own and the
  orchestrator's SIGKILL cut it down mid-flight; cleanup failures went to
  `console.error`. The scaffold now ships `src/shutdown.mts` with the contract
  auth.provider (#290), auth.proxy (#81) and auth.policy-verifier (#210) each
  adopted: drain for `drainTimeoutMs` (default 10s), bound `cleanup` by
  `cleanupTimeoutMs`, force-close past the deadline and exit non-zero, log
  through the instance logger, and yield the loop once before exiting so the
  last lines flush. Both files come with tests that run under the instance's
  own `pnpm run test`.

### Security

- Removed the OWNER contract fail-closed construction-time stopgap
  introduced in `[0.2.1]`: `createDidGrant` no longer refuses to construct a
  grant for an `OWNER_*` `authContract`, now that the OWNER validation path
  is enforced in the request handler (see Added, above). A DID Document
  with more than one controller-matched `verificationMethod` is still
  rejected on the OWNER path (`MethodSelectionError`
  "ambiguous-legacy-selection", inherited from the shared crypto-key
  selection step) — genuine multi-key-per-DID OWNER selection remains
  unsupported and is tracked as follow-up work.
- `ed25519Raw.mts` / `ed25519Prehash.mts` now strip any `headerKid` member a
  signed payload tries to smuggle in, rather than let it flow through to
  `parsedMessage.headerKid` unfiltered. Neither raw-signature format has a
  JWS protected header — `headerKid` must only ever come from a real one
  (`jws.mts`) — so an unfiltered pass-through would have let a signed
  top-level `headerKid` payload member satisfy the OWNER path's three-way
  kid match without any protected header at all, including under the
  `supportedAlgorithms` default. Closed at both layers: the verifiers no
  longer trust the payload's own `headerKid`, and `createDidGrant` now
  additionally refuses at boot to configure a non-header-bearing algorithm
  for an OWNER `authContract` in the first place (see Added, above).

## [0.2.1] - 2026-07-27

A patch number for work that includes contract hardening, deliberately: while
the version is `0.x` this file already states that even minor releases may
change the public API, so patch-vs-minor carries no compatibility promise here.
What the number does buy is a stable consumer pin — provin.oss's quickstart
tracks the moving `v0.2` tag, and cutting `v0.3` would have forced that pin to
move for no benefit before the first announcement.

### Changed

- The published auth-provider image is `ghcr.io/provin-line/auth-provider`, no
  longer `auth-auth-provider`. That name came from concatenating an `auth-`
  prefix onto a component already called `auth-provider` — it said nothing
  twice.

  **Breaking for anyone pinning the old name**, done now precisely because
  nobody can be: the packages became public shortly before the rename and no
  release had been announced. GHCR has no rename and no alias, so the operation
  is publish-the-right-name and delete-the-wrong-one.

- One component name now derives every published identifier, with each
  namespace adding only the prefix its own context does not already supply:

      component   provider | policy-verifier
      directory   packages/create-${c}    inside this repo — "auth" is given
                                          by where the file is
      npm         create-auth-${c}        scope is provin-line, not auth
      image       auth-${c}               org is provin-line, not auth

  So directories lose a prefix their location already implies
  (`create-auth-provider` → `create-provider`, `auth-provider-did` →
  `provider-did`, `auth-provider-dplaax-module` → `provider-dplaax-module`) and
  two npm names gain one that was missing
  (`create-auth-policy-verifier`, `auth-policy-verifier-dplaax-module`). This
  deliberately breaks the directory↔package-name mirror; pnpm resolves by the
  `name` in `package.json`.

  Every package is unpublished on npm, which is the only reason this is a
  refactor rather than a breaking change.

  The same conflation was live inside both generators, and there it was not
  cosmetic: one list served as both npm names and directory paths, so after the
  rename a generated scaffold would have carried a git spec pointing at a
  `packages/` path that no longer exists — an install failure, not a cosmetic
  oddity.

P0 auth contract work (dplaax.spec): hardens DID resolution, tightens
verification-method selection, adds an OWNER-path login transcript
(validated but not yet wired in), a pluggable nonce store, six signed token
claims with an explicit outcome split, and a conformance vector runner. See
[README.md § P0 Auth Contract](README.md#p0-auth-contract) for the full,
accuracy-checked surface — including what does **not** work yet (OWNER
contracts are fail-closed).

### Added

- Resolver hardening for `DplaaxDidResolver`'s DID-document fetch: a finite
  timeout and response-body cap enforced while streaming (never after full
  buffering), bounded concurrency via a shared semaphore, strict RFC 8259
  JSON decoding (rejects duplicate object keys and trailing data; preserves
  unknown members — including `__proto__`, kept as an own property, not a
  prototype write — rather than stripping them), byte-exact `id` equality
  against the requested DID, and redirect refusal (`redirect: "error"`) so
  the serving connection is always the requested URL, never a redirect
  target. Rules: `auth.resolve.resource-floor`, `auth.resolve.id-equality`,
  `auth.resolve.unknown-member`, `auth.resolve.origin-pin`,
  `auth.resolve.failure-mapping`.
- Verification-method selection hardening in `@provin-line/auth-provider-did`:
  exact-`id` match with a controller check for the OWNER path, duplicate
  `verificationMethod` id rejection on every path, and a relationship-array
  check that trusts only *string* references — an embedded object whose
  `id` happens to match is rejected rather than silently accepted, closing
  a path that could otherwise smuggle a method into `authentication`
  inline. JWS-based verifiers (`ed25519_jws`, `es256_jws`, `es256k_jws`) now
  surface the protected header's `kid` and the signed payload's
  `verification_method` on `ParsedMessage`. Rules: `auth.grant.exact-method`,
  `auth.method.relationship`, `auth.method.string-reference-only`,
  `auth.forky.authentication-login`.
- A versioned OWNER-path login transcript (`login-transcript-v1`) and its
  validator, `validateOwnerLogin`: binds all ten transcript fields, checks
  the transcript's audience against the configured allowlist, enforces a
  domain-separation tag so a transcript signed for a different purpose
  cannot be replayed as a login, and enforces the three-way match between
  the JWS `kid`, the transcript's `verification_method`, and the
  resolver-selected method id. **Built and unit-tested, but not yet called
  from the DID grant's request handler** — see "OWNER contract fail-closed
  stopgap" under Security, below. Rules: `auth.transcript.bound-fields`,
  `auth.transcript.audience-required`, `auth.transcript.domain-separation`,
  `auth.grant.kid-match`.
- A pluggable `NonceStore` interface for the DID grant's replay protection,
  with an in-memory default (swept periodically, `.unref()`'d so it never
  blocks process shutdown on its own). Deployments needing cross-replica
  replay protection can inject a shared-store implementation.
- Six signed claims on every minted DID-grant token — `auth_contract_id`,
  `verification_method`, `did_document_snapshot` (`sha256:<64-hex>`),
  `lifecycle_state_ref`, `lifecycle_freshness_ref`, and
  `authorization_scope` (always `AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1`,
  the only scope this package mints) — assembled from a single bound
  evaluation input per request instead of being re-derived piecemeal, plus
  an explicit outcome split: resolver outage maps to HTTP 503
  `temporarily_unavailable`, resolver/method rejection maps to HTTP 400
  `invalid_grant`, and neither outcome mints a token. Rules:
  `auth.token.signed-claims`, `auth.token.issuance-vs-request`,
  `auth.resolve.single-input-binding`.
- A conformance vector runner (`integration/conformance`) that loads
  `dplaax.spec`-shaped vectors and executes them against the real
  resolve/grant code paths, fails closed (throws) on a vector naming a rule
  with no registered executor rather than silently skipping it, and carries
  a `DPLAAX_SPEC_DIR`-gated drift check against the upstream spec's vector
  bytes. Rule: `auth.contract.normative-sot`.

### Security

- The DID grant's audience allowlist, revocation-latency bound, and
  LEGACY-contract TTL cap are now fail-closed configuration: an
  empty/absent `allowedAudiences`, a missing `revocationLatencyBoundSec`, or
  an `oauth.accessToken.expiresIn` that exceeds either bound now throws at
  grant construction instead of silently accepting any audience or an
  unbounded token lifetime (previously, an empty/absent audience allowlist
  meant "accept any audience"). Selecting an `OWNER_*` `authContract` also
  requires an explicit `ownerMigrationRatified: true` opt-in at the
  config-schema level. Rules: `auth.token.lifetime-bound`,
  `auth.legacy.did-login`, `auth.migration.enable-gate`.
- **OWNER contract fail-closed stopgap**: `createDidGrant` now throws at
  construction time if `authContract` is set to
  `OWNER_AUTHENTICATION_LOGIN@1` or `OWNER_ASSERTION_CONTROL_LOGIN@1`. The
  OWNER validation path (`validateOwnerLogin`, above) is implemented but not
  yet wired into the request handler, which would otherwise mint a token
  labeled `OWNER_*` while only performing LEGACY (relationship-blind)
  validation — a token that misrepresents its own assurance level. This
  guard closes that gap until the OWNER path is wired into the handler; see
  [README.md § P0 Auth Contract](README.md#p0-auth-contract).

## [0.2.0] - 2026-07-24

Reference policy-verifier authorization surface for the separated
network/pipeline topology (lock-step with provin.oss's `cmd/network` +
`cmd/pipeline` recomposition — PR2 evidence-wire and the tlog-mirror surface).

### Added

- Reference policy verifier: declare the evidence-write and transparency-log
  resource/actions the separated data plane exercises but `v0.1.0` did not
  authorize — `chain`/`report-health` (publisher emit-health reporting),
  `payloads`/`retain` (by-reference payload deposit), `audit`/`register`
  (evidence registration), and `tlog`/`mirror` (custody-log mirroring). The
  `v0.1.0` image predated these wire calls and `403`d them with
  `undeclared_resource_action`, blocking the provin.oss quickstart's separated
  topology from reaching a `VERIFIED` verdict.

## [0.1.0] - 2026-07-12

Initial internal release — pinned for internal (private) deployment and soak.
No public tag exists for this line: the repository's public history starts at
the 0.2 snapshot, and 0.1.x is unsupported at the public cut (see
SECURITY.md).

### Added

- `@provin-line/auth-provider-did`: a DID grant-type provider for the o3co auth
  stack (`@o3co/auth-provider-core`). It authenticates a client by a
  counterparty-signed DID proof and issues a token for it.
- The grant is registered under the extension grant-type URI
  `https://dplaax.dev/oauth/grant-type/did` (RFC 6749 §4.5 extension grant;
  domain ownership = namespace authority). The identifier is compared
  byte-for-byte, never dereferenced.
- A reference policy verifier and auth provider, published as private GHCR
  container images (`ghcr.io/provin-line/auth-policy-verifier`,
  `ghcr.io/provin-line/auth-auth-provider`) by `publish-images.yml` on `v*`
  tags, consumed by the provin.oss quickstart via `AUTH_REF`.

[Unreleased]: https://github.com/provin-line/auth/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/provin-line/auth/releases/tag/v0.4.0
[0.3.1]: https://github.com/provin-line/auth/releases/tag/v0.3.1
[0.3.0]: https://github.com/provin-line/auth/releases/tag/v0.3.0
[0.2.1]: https://github.com/provin-line/auth/releases/tag/v0.2.1
[0.2.0]: https://github.com/provin-line/auth/releases/tag/v0.2.0
