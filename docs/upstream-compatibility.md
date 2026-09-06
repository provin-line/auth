# Upstream auth compatibility

Generators still pin released provider 0.5.3 and verifier 0.3.1. Updating this
repository's git ref alone does **not** deploy newer upstream security fixes.
Existing instances need their dependency baseline and configuration updated.

The [o3co/auth compatibility suite](https://github.com/o3co/auth) tests candidate
source without publishing packages: it packs provider/core, provider/oauth and
verifier/core, builtins and server into local tarballs, overrides all matching
direct and transitive dependencies in a disposable Provin checkout, then runs
workspace build/typecheck/tests, generated-app build/typecheck/config tests,
service startup and a generated Provider's valid/tampered DID-signature grant.
This does not certify deployed registry ACLs or Web/mobile clients.

## Adopting current upstream

- Keep Zod at one minor version across the dependency graph. Workspace and
  generator overrides pin 4.5.4: mixing 4.3.x and 4.5.x schema objects across
  module boundaries fails TypeScript compilation.
- Supply an absolute Provider issuer. Set the Verifier's `OAUTH_JWT_ISSUER`
  and `OAUTH_JWT_AUDIENCE`. DID clients must include that audience in their
  **signed** message/transcript. Current Verifier rejects LEGACY tokens with no
  `aud`, although the grant still accepts audience-absent LEGACY requests.
- Use `oauth.jwt.mode = "verify"`; remove old `validate` and
  `allowInsecureDecode` keys from overlays. Supply strong signing keys/secrets.
- Generated Provider config supplies required `http.readinessTimeoutMs` and
  `logging.level`. `DplaaxConfigSchema` preserves the audit declaration.
- This DID-only composition has no session/password store, token denylist or
  audit sink. Config explicitly declares subject/access-token revocation
  unsupported and audit sink absent. Lifecycle is checked at issuance; issued
  tokens remain usable until bounded expiry. Earlier revocation or retained
  audit events requires wiring those services.
- Current Provider separates JWKS publication from OAuth; current Verifier
  separates key-resolver registration. Composition includes those modules when
  available; released versions retain their internal wiring.

## DID policy and trust boundaries

The scaffold now requires an explicit Owner DID rule on its declared surface.
Scopeless tokens skip only the OAuth scope group.
`DefaultDenyRuleCollector` still rejects undeclared resource/action pairs.
Other configured groups, including subscriber identity when enabled, must pass.
A missing or non-Owner subject is denied.

This avoids relying on 0.3.x's empty-rule allow behavior; current upstream denies
empty rules. PDP allow is the identity/surface gate; resource permissions remain
the downstream registry's ACL decision, as required by the Provin contract.

Collectors use verified `subject` on current upstream and `payload` on 0.3.x.
When present, `subject` is authoritative even if empty. Subscriber fields remain
caller supplied: current upstream reads them only through
`readUntrustedRequestContext`, with no plain-record fallback.
