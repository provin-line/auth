# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, the public API (the `@provin-line/auth-provider-did`
module surface and the DID grant contract) may still change between minor
releases.

## [Unreleased]

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

## [0.1.0] - 2026-07-12

Initial internal release — pinned for internal (private) deployment and soak.

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

[Unreleased]: https://github.com/provin-line/auth/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/provin-line/auth/releases/tag/v0.1.0
