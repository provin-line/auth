# dplaax-create-app — Scaffold Generator Specification

**Status**: Active (reviewed 2026-06-11; M1–M5 implemented)
**Date**: 2026-06-11
**Supersedes**: the unrecoverable "dplaas-create-app spec" cited by existing
test comments (`spec § 5.3 / § 5.4 / § 6.3 / § 8.1`). Appendix A maps those
citations to sections of this document; the migration plan (§ 7) updates them.

## 1. Purpose & scope

This repository ships **libraries** (`packages/*`) and **scaffold generators**
(`create-auth-provider`, `create-policy-verifier`). It does **not** operate
auth services. A dPLaaX deployment instantiates its own `auth-provider` /
`policy-verifier` composition roots by running the generators; each instance
is owned, configured, and deployed by its consumer.

This spec defines:

- the role split between generators, templates, and libraries (§ 2),
- the template contract — the single source of truth for what a generated
  instance looks like (§ 3–5),
- the verification architecture that keeps generator output trustworthy
  without maintaining a hand-written reference instance (§ 6),
- the migration plan that removes `services/` (§ 7).

### 1.1 Design decision: the generator is the source of truth

Previously, `services/provider` and `services/policy-verifier` were
hand-maintained "reference instances", and a round-trip test asserted that
each `create-*` template stays diff-equivalent to its reference under a list
of normalization rules (workspace-vs-standalone dep forms, caret stripping,
`private` flag, Dockerfile divergence, excluded paths).

This inverts here: **what a generator emits is canonical** (for the
policy-verifier its `src/template/`; for the provider, upstream's generated
app plus the overlay, below), and the repository keeps no standing instance. Rationale:

- The repo's public contract is "you can generate a working instance" — so the
  artifact under test must be the generated output, not a sibling that
  approximates it modulo eight normalization rules.
- Dual maintenance (service + template) plus normalization is a standing drift
  hazard; every intentional divergence weakened the round-trip assertion.
- The integration test never depended on `services/` source — it composes
  in-process from the library packages directly.

For the policy-verifier, `packages/create-policy-verifier/src/template/` is
the canonical definition. For the provider there is no template: the app is
what auth.provider's own generator (`@o3co/auth-provider-scaffold`) writes
for a listed set of modules, plus the overlay of provin modules in
`packages/create-provider/src/overlay/` (§ 3.5).

## 2. Package roles

| Path | Role | Published |
| --- | --- | --- |
| `packages/create-provider` | Generator for an auth-provider instance: upstream's app composing the provin modules from npm, plus the overlay (§ 3.5) | not yet — run from a repo clone |
| `packages/create-policy-verifier` | Generator + canonical template for a policy-verifier instance | not yet — run from a repo clone |
| `packages/did-grant`, `packages/dplaax-registry`, `packages/did-grant-store`, `packages/did-dplaax` | The DID grant, its registry and nonce-store wiring (auth.provider 0.19 modules) and the `did:dplaax` method library | npm with provenance, from 0.6.0 ([`publish-packages`](../.github/workflows/publish-packages.yml)); the provider generator composes the modules from npm (§ 3.5) |
| `packages/policy-verifier-dplaax-module` | dPLaaX composition module consumed by generated policy-verifier instances | not yet — consumed as git-subdirectory refs (§ 3.3) |
| `integration/` | Private workspace package: cross-package flow tests (§ 6.2) | no |
| `instances/` | Git-ignored output directory for locally generated dev instances (§ 5) | no |

`services/` ceases to exist (§ 7).

## 3. Template contract

### 3.1 Form

The policy-verifier template and the provider's generated app are stored in
**standalone consumer form** — exactly what an external consumer receives:

- dPLaaX module dependencies: the provider's are the npm versions its
  generator composes (`PROVIN_PACKAGES`, § 3.5); the policy-verifier's use the
  **git-subdirectory form** pinned by `--dplaax-module-ref`. Never
  `workspace:*`. The verifier CLI requires the flag explicitly (no default — a
  scaffold must not silently pin a moving ref); `DEFAULT_DPLAAX_MODULE_REF` in
  its `defaults.mts` is a library-only constant for tooling and tests.
- All other dependency versions are **exact pins** (no `^`/`~`). The
  policy-verifier bakes them into `defaults.mts` as literals; the provider's
  come from `@o3co/auth-provider-scaffold`, which the generator pins at an
  exact version (§ 3.3).
- No workspace-only fields. The provider's `package.json` keeps upstream's
  `private: true`, an app's mark; the policy-verifier's carries no `private`
  flag.
- The Dockerfile is the standalone (non-workspace) build.

There is no "workspace flavor" of the template. Where the repo itself needs a
runnable instance (CI smoke § 6.3, local dev § 5), it generates one into
`instances/`, where a single, statically declared workspace mechanism
(§ 6.3.1) redirects `@provin-line/*` resolution — the template itself is
byte-identical to what a consumer receives.

### 3.2 Token substitution

The policy-verifier template uses `<NAME>`-style tokens substituted at generation time;
`.tmpl`-suffixed files are token-bearing, all other files are copied verbatim.
Token invariants are enforced by `token-invariants.test.mts` in the
policy-verifier generator (every token used in a template must be
substituted; no token may survive into output). The provider generator has no
tokens: its files are upstream's, patched by pure functions (§ 3.5).

### 3.3 Dependency pinning policy

The policy-verifier generator emits exact dependency pins from
`DEFAULT_DEP_VERSIONS`. The provider generator depends on
`@o3co/auth-provider-scaffold` at an exact version, which is the
auth.provider release the generated app is built on (0.19.0); the app's own
pins are that release's. Its provin packages are `PROVIN_PACKAGES`, at the
generator's own version, which is the release's one version (below), and
generation refuses a project holding them at any other. Moving git refs (e.g. branch
names) are rejected for the verifier's `--dplaax-module-ref` in published
releases. When the dependency baseline upgrades, refresh `defaults.mts` (and,
for the provider, the scaffold pin) in a **minor** release of the
repository.

Every package carries the repository's one version: the root
`package.json`'s, which is the release tag's without its `v`
(`integration/tests/versions.test.mts` holds them equal, and
`publish-packages` refuses a tag whose version is not the root's and every
workspace package's). A provin package takes another as a peer at the caret of that
version, and as a dependency at exactly that version (`workspace:*`), so the
packages of a release resolve to that release. Before 0.6.0 each generator had its own version: 0.2.0 shipped in
tags v0.3.x, 0.3.0 in v0.4.0 and 0.4.0 in v0.5.0, and 0.5.0 was never
released.

(Formerly spec § 5.3 / § 5.4 / § 8.1 — see Appendix A.)

### 3.4 Consumer-mode transitive resolution

The dPLaaX module packages declare their sibling `@provin-line/*` deps with
the `workspace:` protocol, which a package fetched by git ref cannot resolve
outside this workspace. The provider composes the modules from npm (§ 3.5),
where packing turned those into versions, and needs no provision. The
policy-verifier generator still composes its module as a git-subdirectory
ref, so a standalone consumer install needs scaffold-side provisions, which
the generator emits as follows.

**Policy-verifier (pnpm 10).** Its `package.json` carries the equivalents,
`pnpm.overrides` (`did-dplaax`) and `pnpm.onlyBuiltDependencies`
(allow-listing every git-fetched `@provin-line/*` package, by name). The
scaffold keeps its own `packageManager` (pnpm 10, which reads that block).
Each git-fetched package's `prepare` runs `pnpm install` inside the fetched
provin.auth checkout, whose root `packageManager` is pnpm 11, so a consumer
install fetches that pnpm too and needs a Node it runs on (≥ 22.13). When
the verifier generator moves to pnpm 11 it emits a `pnpm-workspace.yaml` the
same way.

The transitive package list is baked into the generator and refreshed in
lockstep (§ 3.3). The libraries are on npm from 0.6.0; these overrides go
when the verifier generator composes its module from npm instead of a git
ref.

Inside this repo's workspace the scaffold's own overrides and build
allowances are inert (pnpm honors only workspace-root settings), so
workspace mode (§ 6.3.1) is unaffected.

### 3.5 Provider composition: upstream's app plus the overlay

`generateAuthProviderScaffold` calls `generate` of
`@o3co/auth-provider-scaffold/create-app` with a *listed app*
(`@mod/token-endpoint`, `@mod/client-allowance`, `@mod/outbound`,
`@mod/discovery`, `@mod/token-control`) and the three provin modules
(`@provin-line/auth-did-grant`, `auth-did-grant-store`, `auth-dplaax-registry`)
as packages outside its release. Upstream reads each from a project pnpm
installed it into (`--outside-from`; without one the generator stages a
temporary project installing the modules of `PROVIN_PACKAGES`, `did-dplaax`
coming with them, from the registry the operator's npm configuration names,
the working directory's `.npmrc` included, with no lifecycle script, and
removes it), composes it
through its
`authProvider` declaration, and adds what all of them need to run (tokens,
keys, issuer, clients, store, audit, http, rate-limit, metrics, ...). It writes
`package.json`, `src/main.ts`, `config/application.conf` (binding every scalar
key of each module's `config.example` to its variable), the `.example`
settings files, `pnpm-workspace.yaml`, `Dockerfile`, `README.md`, `AGENTS.md`,
and the record of the packages outside the release, `outside-modules.json`,
with `scripts/check-outside.mjs`, which holds the lockfile to it. The generated
app runs its sources (`node src/main.ts`): there is no build and no compiler
configuration. It reads each setting from an environment variable through
`config/application.conf`, the lists from a local layer, and exits 78 on a
refused boot.

`applyProvinModules` (`packages/create-provider/src/overlay/`) patches what
upstream does not write for the provin modules — one pure function per file,
applied in one place:

| File | Patch |
| --- | --- |
| `package.json` | name, description, license, author; refuses a manifest lacking a provin module |
| `config/application.conf` | `keys.signing.secret`, `keys.signing.secret-encoding`, `tokens.subject-check` and `tokens.access-token-lifetime`, which no module's example holds, each reading its variable |
| `.env.example` | those variables; the registry's default URL |
| `config/local.conf.example` | the DID grant type in the example client's `client-allowance.grants`; the registry in `outbound.allow` and `outbound.plain-internal` (or `outbound.internal-hosts` for https) |
| `pnpm-workspace.yaml` | `@provin-line/did-dplaax` at its exact version in `minimumReleaseAgeExclude`, beside the modules upstream names there |
| `README.md` | the title and description; `## Changing the modules` for this generator; the settings the provin modules need |

A patch whose anchor upstream moved throws, naming the file, instead of
shipping an app missing what the modules need. The refusal hints `src/main.ts`
writes (`keysRead`) name the variables of the keys upstream bound, not the
four the overlay adds.

`tokens.subject-check = none` is bound because boot requires either a module
that checks subject revocation or that statement, and this app composes none.
`@provin-line/did-dplaax` is named because pnpm holds a version back until it
is a day old, upstream names only the modules it was told were fresh, and a
library the modules depend on cannot be named to its generator.

## 4. Generator CLI contract

The CLI surfaces are `create-auth-provider <name> [--outside-from <dir>]
[options]` and `create-auth-policy-verifier <name> --dplaax-module-ref <ref>
[options]`.
The provider has no `--port` (the app's port is `HTTP_PORT`) and no
`--package-manager` (upstream's app is pnpm); `--registry-base-url` is the
default `DPLAAX_REGISTRY_URL` of its `.env.example`.
The subsections below restate the normative behaviors that code comments
cite; subsection numbers intentionally match the lost spec's § 4.x.

### 4.1 Required arguments

The `<name>` positional is required by both. The policy-verifier also
requires `--dplaax-module-ref`: the ref MUST be a full commit SHA, and
moving refs are rejected (§ 3.3); the CLI deliberately has no default ref.
The provider takes no ref: its provin packages are the npm versions of its
release (§ 3.3).

### 4.2 `--license`

Advertised as `--license <SPDX>`, but restricted to an allow-list of
licenses whose verbatim bodies the generator carries (currently Apache-2.0
only) — `package.json#license` must never contradict the shipped LICENSE
body. Broadening the allow-list means carrying each matching verbatim body.

### 4.3 Output-directory collision

The generator refuses to write into an existing non-empty directory; it
never merges or overwrites. A `--force` escape hatch is deferred; when
added, it must be an explicit opt-in resolved at the CLI layer.

## 5. Local development instances

A repo-root Make target generates throwaway composition roots for local
development and e2e composition:

```text
make instances        # stages this checkout's provin packages, runs both generators → instances/provider, instances/policy-verifier
docker compose up     # workspace-context image builds of instances/*
```

- `instances/` is **git-ignored**; nothing under it is ever committed. It is
  listed in `pnpm-workspace.yaml`, so generated instances join the workspace
  (§ 6.3.1) and reflect local package state.
- A generated app's standalone Dockerfile (the policy-verifier template's;
  upstream's for the provider) installs `@provin-line/*` from git refs
  (the verifier) or from the registry its `.npmrc` names (the provider),
  neither of which holds local edits. Therefore `docker-compose.yml`
  builds dev images from a repo-root-context `Dockerfile.instance`
  (`ARG INSTANCE=provider|policy-verifier`, `ARG ENTRY` the file the instance
  starts from: `src/main.ts` for the provider, `dist/main.mjs` for the
  policy-verifier) that copies the workspace plus the generated instance and
  builds with workspace resolution. This is the single
  workspace-flavored build artifact in the repo; it lives at the repo root,
  never in a template. The standalone Dockerfile is exercised by
  consumer-mode smoke (§ 6.3).

## 6. Verification architecture

Three layers replace the retired round-trip test.

### 6.1 Generator unit tests (existing)

`generator.test.mts`, `cli.test.mts` in each `create-*` package, plus
`token-invariants.test.mts` for the policy-verifier and `overlay.test.mts`
for the provider (each patch of § 3.5). These test generation mechanics: file
emission, token substitution, argument validation, ref pinning. The
provider's `generator.test.mts` runs the real upstream generator into a
temporary directory, reading this checkout's provin packages from a project
the test run stages once (`scripts/stage-provin-packages.mjs`).

### 6.2 Integration tests — `integration/` package

The cross-package flow test runs in one process, over real HTTP: a DID
registry served on loopback, a provider assembled from auth.provider's modules
with `@provin-line/auth-did-grant`, `auth-dplaax-registry` and
`auth-did-grant-store` (HS256 over the secret's UTF-8 bytes, through the real
`outbound`), and the real policy-verifier with the dPLaaX module reading the
same secret. The conformance executors run the same modules against the
vendored dplaax.spec vectors. It composes from the **library packages**
(`@provin-line/*` modules + `@o3co/*` framework) directly and has no
dependency on any instance directory.

### 6.3 Scaffold smoke (CI dogfood)

Two modes, verifying two different properties.

**Workspace mode (every PR)** — verifies the generated apps against the PR's
package state:

1. `make instances` (generators → `instances/*`, workspace members per
   § 6.3.1). The provider generator reads the PR's provin packages from a
   staged project: `scripts/stage-provin-packages.mjs` packs them, serves
   them from a loopback registry and installs the project.
2. `pnpm install`. The policy-verifier is built, typechecked and booted, and
   its health endpoint asserted and `/verify` without a token refused with
   401. The provider runs its sources
   (`scripts/smoke-did-grant.mjs`): it is booted with HS256 and the secret as
   UTF-8, against a throwaway DID registry on loopback (`outbound.allow` and
   `outbound.plain-loopback` name it), and takes one DID-grant round trip: a
   200 with a token signed over the secret's UTF-8 bytes and carrying the six
   signed claims, and a 4xx for a tampered signature. Then token-control:
   the metadata names both endpoints, a confidential client introspects the
   token active (the public client gets 401), the token's client revokes it,
   and it introspects inactive. `make smoke` takes `PROVIDER_PORT` and
   `VERIFIER_PORT`.

**Consumer mode (`main` + release)** — verifies the exact consumer
experience, no workspace assistance:

1. Run the generator CLIs into a directory **outside** the repo.
2. `pnpm install` / build / boot as-is. The verifier's `@provin-line/*`
   resolve from their pinned git refs; the provider's from a loopback
   registry serving this commit's packed packages, which the staged project
   and so the app's `.npmrc` name, installed as the app's README says
   (`--lockfile-only`, `check-outside.mjs`, `--frozen-lockfile
   --ignore-scripts`). The provider is installed only: it has no build.
3. Additionally `docker build` each app's standalone Dockerfile (the policy-verifier template's, its `runtime` stage; upstream's for the provider) and run the images: each
   answers its health endpoint, the verifier refuses `/verify` without a
   token (401), and the provider image takes the DID-grant round trip
   (`scripts/smoke-image.sh`, `scripts/smoke-did-grant.mjs --image`). The
   provider's image builds on the host network, which reaches that
   registry.

Workspace mode is the load-bearing replacement for the round-trip test:
instead of asserting "template ≈ reference modulo normalizations", it asserts
"the generated artifact installs, builds, and boots against the code under
review". Consumer mode protects the property workspace mode masks: that the
scaffold works without this repo checked out.

#### 6.3.1 Workspace resolution for generated instances

The provider's scaffold declares the provin modules (`auth-did-grant`,
`auth-dplaax-registry`, `auth-did-grant-store`) at npm versions, the
verifier's (`policy-verifier-dplaax-module`) via a git-subdirectory ref.
Inside this repo that resolution is redirected statically — no
post-generation mutation:

- `pnpm-workspace.yaml` includes `instances/*`, so generated instances are
  workspace members;
- the root `pnpm-workspace.yaml` declares `overrides` listing each
  `@provin-line/*` package **by explicit name** (no wildcard patterns)
  mapped to `workspace:*`. pnpm 11 no longer reads `pnpm.overrides` from
  `package.json`. A new `@provin-line/*` package a generated instance
  depends on is added to this list.

Both declarations are committed, visible, and inert when `instances/` is
empty. An external consumer install is untouched (overrides apply only to
installs rooted in this workspace). M3 adds a CI assertion that the
generated `package.json` itself is byte-identical to direct generator
output — redirection happens entirely in pnpm resolution, never by mutating
the artifact.

**Ref source rule** — which `--dplaax-module-ref` each context passes to
the verifier generator (the provider's packages are the staged project's,
this checkout's):

| Context | Ref |
| --- | --- |
| `make instances` / workspace-mode smoke | `git rev-parse HEAD` (resolution is overridden anyway; the emitted ref stays honest) |
| Consumer-mode smoke | the exact tag or commit SHA under test (`main`'s HEAD SHA on `main` builds; the release tag on release builds) |

#### 6.3.2 Consumer-mode transitive resolution — resolved

Resolved 2026-06-11 (decision on open question 3): the bare consumer
install was confirmed broken in exactly the predicted way, and the scaffold
now ships the override and build-allowance provisions specified in § 3.4. Consumer-mode smoke is a gating CI job. The
`@provin-line/*` libraries are published to npm from 0.6.0 and the provider
composes them from there, so its overrides retired; the verifier's retire when its
generator does the same.

### 6.4 Round-trip test — retired

With no reference instance, template↔reference equivalence is definitionally
void. Both `round-trip.test.mts` files are deleted in migration step M4, and
their § citations have no successor: the property they protected (generated
output matches a known-good instance) is now protected by § 6.3 against the
real consumer artifact.

## 7. Migration plan (from `services/`)

Each step is an independently land-able PR; steps are ordered so the safety
net never has a gap (new verification lands before old verification is
removed).

- **M1 — Land this spec.** Add `docs/create-app.md`; update the dangling
  `dplaax-create-app spec §` citations in test comments to point at this
  document's sections (Appendix A mapping).
- **M2 — Extract `integration/`.** Move
  `services/provider/tests/integration.test.mts` into the new private
  workspace package; add the package to `pnpm-workspace.yaml`; CI's
  `pnpm -r test` picks it up automatically. `services/` still exists and
  still passes — no behavior change.
- **M3 — Add scaffold smoke.** Add `instances/*` to the workspace + root
  overrides (§ 6.3.1), `make instances`, and both smoke modes (§ 6.3).
  Consumer mode may land as informational first if § 6.3.2 turns out broken.
  At this point the template is verified end-to-end while `services/` and
  the round-trip tests still exist.
- **M4 — Promote template to SoT.** **Entry gate**: workspace-mode smoke
  green, **and** either consumer-mode smoke green or an explicit recorded
  decision (open question 3 resolved) that external consumer install is a
  separately tracked contract not blocking `services/` removal. Note the
  retired round-trip test never verified the consumer install path either —
  this gate prevents the *appearance* of regression, not an actual one.
  Then: fold any drift from `services/*` into
  the templates (final diff review), then delete `services/`, both
  `round-trip.test.mts` files, and the `services/*` workspace glob. Switch
  `docker-compose.yml` to the root-context `Dockerfile.instance` builds
  (§ 5), git-ignore `instances/`, update `README.md` / `README.ja.md` /
  `docs/requirements.md` (composition tables reference generated instances,
  not `services/`).
- **M5 — Cleanup.** `defaults.mts` provenance comments point at the template
  baseline instead of the deleted reference; sweep remaining `services/`
  mentions.

## 8. Open questions

1. **`instances/` naming** — recommendation: `instances/` (git-ignored).
   Alternatives: `examples/` (misleading: implies committed content),
   `.gen/` (hides the artifact developers interact with).
2. **Smoke job cadence** — recommendation: workspace mode on every PR
   (`pnpm install` of two small instances; minutes, not tens of minutes);
   consumer mode on `main` + release. Alternative: both on every PR.
3. ~~**Consumer-mode transitive resolution remedy** (§ 6.3.2)~~ — **resolved
   2026-06-11**: scaffold-emitted `pnpm.overrides` + `onlyBuiltDependencies`
   (§ 3.4), chosen over npm publication on the M3 evidence. npm publication
   remains a future simplification that would retire the overrides.

## Appendix A — citation mapping from the lost spec

| Old citation (in code comments) | Successor |
| --- | --- |
| § 2 (deployment mandate / pipeline chain) | `docs/requirements.md` § 3 (boundary discipline) |
| § 4.2 (`--license`) | § 4.2 |
| § 4.3 (output-dir collision) | § 4.3 |
| § 5.3 (dplaax-module dep form) | § 3.1, § 3.3 |
| § 5.4 (exact pins, moving-ref rejection) | § 3.3 |
| § 6.1 (deployment-payload carve-out) | retired — § 6.4 (template ships generic samples) |
| § 6.3 / § 6.3.2 (round-trip + normalizations) | retired — § 6.3 (smoke), § 6.4 |
| § 8.1 (defaults refresh ↔ MINOR bump) | § 3.3 |
