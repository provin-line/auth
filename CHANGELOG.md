# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, the public API (the `@provin-line/auth-provider-did`
module surface and the DID grant contract) may still change between minor
releases.

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/provin-line/auth/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/provin-line/auth/releases/tag/v0.2.1
[0.2.0]: https://github.com/provin-line/auth/releases/tag/v0.2.0
