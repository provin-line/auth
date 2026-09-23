# Upstream auth compatibility

Workspace packages require provider `^0.15.0` and verifier `^0.12.0`, and the
generators (0.3.0) emit the same as exact pins. Updating this repository's git
ref alone does **not** deploy newer upstream security fixes to an instance that
already exists: its own `package.json` pins and its `application.conf` must be
updated too (see below).

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
  `logging.level`.
- Upstream refuses to boot when a security capability `oauthModule` reads is
  neither wired nor declared absent. `buildModules` wires all of them, so an
  instance's config must not declare any of them absent:
  - **Audit sink.** `audit.sink.type` names the sink; `"console"` (one JSON
    object per event on stdout) is built in and is the default. `"none"` is
    refused at boot: upstream removed it so that saying nothing about
    auditing cannot mean having no audit trail.
  - **Access-token denylist.** `oauth.revocation.accessToken = "denylist"`.
    RFC 7009 revocation writes the token's `jti` to it; verification and
    introspection consult it.
  - **Subject revocation.** The `subjectRevocation` / `subjectSessionIndex`
    pair is wired; leave `oauth.revocation.subject` unset.
    `subjectRevocation.revokeBefore(did, …)` invalidates every token already
    issued to that DID.

  Migrating an instance generated before 0.3.0: delete
  `audit.sink.type = "none"`, `revocation.subject = "unsupported"` and
  `revocation.accessToken = "unsupported"`, and add the `audit.sink` block and
  `revocation.accessToken = "denylist"` from the current template.
- The denylist and the subject-revocation pair are in-memory, so they hold
  for one process only. Their manifests say so, and upstream refuses
  `deployment.mode = "multi"` with them. A multi-replica deployment passes
  shared implementations through `DplaaxBuildModulesOverrides`
  (`accessTokenDenylistModule`, `subjectRevocationModule`, and
  `auditSinkModule` for a non-console sink).
- Nothing in this repository calls `subjectRevocation.revokeBefore` yet:
  the capability is wired, and the trigger (for example, a DID deactivated
  at the registry) is the deployment's to connect.
- Current Provider separates JWKS publication from OAuth; current Verifier
  separates key-resolver registration. Composition includes those modules when
  available; released versions retain their internal wiring.

## DID policy and trust boundaries

The scaffold now requires an explicit Owner DID rule on its declared surface.
Scopeless tokens skip only the OAuth scope group.
`DefaultDenyRuleCollector` still rejects undeclared resource/action pairs.
Other configured groups, including subscriber identity when enabled, must pass.
A missing or non-Owner subject is denied.

This avoids relying on 0.3.x's empty-rule allow behavior; upstream has denied
empty rules since 0.4.0, and core `evaluate()` is async since 0.10.0.
PDP allow is the identity/surface gate; resource permissions remain
the downstream registry's ACL decision, as required by the Provin contract.

Collectors read the verified `subject`, which is authoritative even if empty.
Subscriber fields remain caller supplied: collectors read them only through
`readUntrustedRequestContext`, with no plain-record fallback.
