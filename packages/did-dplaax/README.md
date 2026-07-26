# @provin-line/did-dplaax

dPLaaX DID grammar — `did:dplaax:{registry}:{accountType}:{accountId}[:{resourcePath}...]`.

A **framework-agnostic** parser + classifier for the dPLaaX DID method.
Zero runtime dependencies. Consumed by both the auth-provider and
policy-verifier dPLaaX composition layers so the grammar has a single
source of truth.

## Scope

This package owns:

- **Structural parsing**: split a `did:dplaax:...` string into
  `{ raw, registry, accountType, accountId, resourcePath }`, with per-
  segment safety checks. Throws on malformed input. `raw` carries the
  verbatim input string so error formatters in `requireOwner` /
  `requireKnownPattern` quote the actual input rather than reconstructing
  it from the individual fields (auth#24).
- **Hierarchy classification**: decide whether a parsed DID is an
  `owner` / `pipeline` / `process` (or unrecognized) — the dPLaaX-defined
  shapes for resource hierarchy.
- **Spec-version policy**: the current `accountType` allow-list and
  helpers (`getSupportedAccountTypes`, `isSupportedAccountType`).
- **Throwing guards**: `requireKnownPattern`, `requireOwner` for call
  sites that must reject anything outside a known hierarchy.

It does NOT own DID **document** resolution (verification methods, public
keys) — that lives in `@provin-line/auth-provider-did`, which is a
JWT/DID-document layer that depends on the OAuth grant flow.

## Why a separate package

Both `@provin-line/auth-provider-dplaax-module` and
`@provin-line/auth-policy-verifier-dplaax-module` need the same parser. Without
this package, either:

- the policy-verifier composition layer would have to depend on the
  auth-provider framework (`@o3co/auth-provider-core` +
  `@o3co/auth-provider-oauth`) for a pure grammar concern — wrong layer
  direction; or
- the parser stays duplicated and silently drifts on the next spec
  revision.

Extracting it puts the grammar where it belongs: below both frameworks.

## Distribution

Not published to npm. Consumed via pnpm workspace dep
(`workspace:*`) inside this monorepo, or via pnpm git-subdirectory dep
(`github:provin-line/auth#<tag>&path:/packages/did-dplaax`) from
out-of-tree consumers.

## License

Apache-2.0. See [LICENSE](./LICENSE).
