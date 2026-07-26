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

### 1.1 Design decision: template is the source of truth

Previously, `services/provider` and `services/policy-verifier` were
hand-maintained "reference instances", and a round-trip test asserted that
each `create-*` template stays diff-equivalent to its reference under a list
of normalization rules (workspace-vs-standalone dep forms, caret stripping,
`private` flag, Dockerfile divergence, excluded paths).

This inverts here: **`packages/create-*/src/template/` is canonical**, and the
repository keeps no standing instance. Rationale:

- The repo's public contract is "you can generate a working instance" — so the
  artifact under test must be the generated output, not a sibling that
  approximates it modulo eight normalization rules.
- Dual maintenance (service + template) plus normalization is a standing drift
  hazard; every intentional divergence weakened the round-trip assertion.
- The integration test never depended on `services/` source — it composes
  in-process from the library packages directly.

## 2. Package roles

| Path | Role | Published |
| --- | --- | --- |
| `packages/create-provider` | Generator + canonical template for an auth-provider instance | not yet — run from a repo clone |
| `packages/create-policy-verifier` | Generator + canonical template for a policy-verifier instance | not yet — run from a repo clone |
| `packages/provider-did`, `packages/did-dplaax` | DID grant / `did:dplaax` method libraries | not yet — consumed as git-subdirectory refs (§ 3.3) |
| `packages/provider-dplaax-module`, `packages/policy-verifier-dplaax-module` | dPLaaX composition modules consumed by generated instances | not yet — consumed as git-subdirectory refs (§ 3.3) |
| `integration/` | Private workspace package: cross-package flow tests (§ 6.2) | no |
| `instances/` | Git-ignored output directory for locally generated dev instances (§ 5) | no |

`services/` ceases to exist (§ 7).

## 3. Template contract

### 3.1 Form

Templates are stored in **standalone consumer form** — exactly what an
external consumer receives:

- dPLaaX module dependencies use the **git-subdirectory form** pinned by
  `--dplaax-module-ref`; never `workspace:*`. The CLI requires the flag
  explicitly (no default — a scaffold must not silently pin a moving ref);
  `DEFAULT_DPLAAX_MODULE_REF` in `defaults.mts` is a library-only constant
  for tooling and tests.
- All other dependency versions are **exact pins** (no `^`/`~`), baked into
  `defaults.mts` as literals.
- `package.json` carries no `private` flag and no workspace-only fields.
- The Dockerfile is the standalone (non-workspace) build.

There is no "workspace flavor" of the template. Where the repo itself needs a
runnable instance (CI smoke § 6.3, local dev § 5), it generates one into
`instances/`, where a single, statically declared workspace mechanism
(§ 6.3.1) redirects `@provin-line/*` resolution — the template itself is
byte-identical to what a consumer receives.

### 3.2 Token substitution

Template files use `<NAME>`-style tokens substituted at generation time;
`.tmpl`-suffixed files are token-bearing, all other files are copied verbatim.
Token invariants are enforced by `token-invariants.test.mts` in each
generator package (every token used in a template must be substituted; no
token may survive into output).

### 3.3 Dependency pinning policy

The generator emits exact dependency pins from `DEFAULT_DEP_VERSIONS`.
Moving git refs (e.g. branch names) are rejected for `--dplaax-module-ref`
in published releases. When the dependency baseline upgrades, refresh
`defaults.mts` in lockstep with a generator **MINOR** bump.

(Formerly spec § 5.3 / § 5.4 / § 8.1 — see Appendix A.)

### 3.4 Consumer-mode transitive resolution

The dPLaaX module packages declare their sibling `@provin-line/*` deps as
`workspace:*`, and none of the `@provin-line/*` packages are published to
npm. A standalone consumer install therefore needs two scaffold-side
provisions, both emitted into the generated `package.json`:

- **`pnpm.overrides`** pinning each transitive `@provin-line/*` package to a
  git-subdirectory ref at the **same ref** as `--dplaax-module-ref`
  (provider: `auth-provider-did`, `did-dplaax`; policy-verifier:
  `did-dplaax`). pnpm applies consumer-root overrides to transitive
  resolution, which is the only mechanism that can reach inside the
  git-fetched module's `workspace:*` declarations.
- **`pnpm.onlyBuiltDependencies`** allow-listing every git-fetched
  `@provin-line/*` package: they build via `prepare`, which pnpm ≥10 blocks
  for non-allow-listed deps (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`).

Empirical basis (2026-06-11): a bare scaffold install failed first on the
build-script gate, then on `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for the
`workspace:*` transitive deps; with both provisions, generate → install →
build → typecheck → boot → health all passed outside the workspace.

The transitive package list is baked into each generator like
`DEFAULT_DEP_VERSIONS` and refreshed in lockstep (§ 3.3). If the
`@provin-line/*` libraries are later published to npm, these overrides can
be retired in favor of exact-pin semver deps inside the module packages.

Inside this repo's workspace the scaffold's own `pnpm` block is inert
(pnpm honors only workspace-root overrides), so workspace mode (§ 6.3.1)
is unaffected.

## 4. Generator CLI contract

The CLI surface (`create-auth-provider <name> --dplaax-module-ref <ref>
[options]`, and the policy-verifier equivalent) is unchanged by this spec.
The subsections below restate the normative behaviors that code comments
cite; subsection numbers intentionally match the lost spec's § 4.x.

### 4.1 Required arguments

The `<name>` positional and `--dplaax-module-ref` are required.
The ref MUST be exact (tag or commit SHA); known moving branch names are
rejected (§ 3.3). The CLI deliberately has no default ref.

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
make instances        # runs both generators → instances/provider, instances/policy-verifier
docker compose up     # workspace-context image builds of instances/*
```

- `instances/` is **git-ignored**; nothing under it is ever committed. It is
  listed in `pnpm-workspace.yaml`, so generated instances join the workspace
  (§ 6.3.1) and reflect local package state.
- The template's standalone Dockerfile installs `@provin-line/*` from git
  refs, which cannot contain local edits. Therefore `docker-compose.yml`
  builds dev images from a repo-root-context `Dockerfile.instance`
  (`ARG INSTANCE=provider|policy-verifier`) that copies the workspace plus the
  generated instance and builds with workspace resolution. This is the single
  workspace-flavored build artifact in the repo; it lives at the repo root,
  never in a template. The standalone Dockerfile is exercised by
  consumer-mode smoke (§ 6.3).

## 6. Verification architecture

Three layers replace the retired round-trip test.

### 6.1 Generator unit tests (existing)

`generator.test.mts`, `cli.test.mts`, `token-invariants.test.mts` in each
`create-*` package. These test generation mechanics: file emission, token
substitution, argument validation, ref pinning.

### 6.2 Integration tests — `integration/` package

The in-process cross-package flow test (currently
`services/provider/tests/integration.test.mts`: mock DID registry →
auth-provider → policy-verifier) moves to a private workspace package
`integration/`. It composes from the **library packages** (`@provin-line/*`
modules + `@o3co/*` framework) directly, as it already does today; it has no
dependency on any instance directory.

### 6.3 Scaffold smoke (CI dogfood)

Two modes, verifying two different properties.

**Workspace mode (every PR)** — verifies the template against the PR's
package state:

1. `make instances` (generators → `instances/*`, workspace members per
   § 6.3.1).
2. `pnpm install`, then build / typecheck / boot each instance and assert
   `GET /_healthcheck` responds.

**Consumer mode (`main` + release)** — verifies the exact consumer
experience, no workspace assistance:

1. Run the generator CLIs into a directory **outside** the repo.
2. `pnpm install` / build / boot as-is — `@provin-line/*` resolve from their
   pinned git refs.
3. Additionally `docker build` the template's standalone Dockerfile.

Workspace mode is the load-bearing replacement for the round-trip test:
instead of asserting "template ≈ reference modulo normalizations", it asserts
"the generated artifact installs, builds, and boots against the code under
review". Consumer mode protects the property workspace mode masks: that the
scaffold works without this repo checked out.

#### 6.3.1 Workspace resolution for generated instances

The scaffold declares `@provin-line/auth-provider-dplaax-module` (resp.
`policy-verifier-dplaax-module`) via a git-subdirectory ref. Inside this repo
that resolution is redirected statically — no post-generation mutation:

- `pnpm-workspace.yaml` includes `instances/*`, so generated instances are
  workspace members;
- the root manifest declares `pnpm.overrides` listing each `@provin-line/*`
  package **by explicit name** (no wildcard patterns) mapped to
  `workspace:*`.

Both declarations are committed, visible, and inert when `instances/` is
empty. An external consumer install is untouched (overrides apply only to
installs rooted in this workspace). M3 adds a CI assertion that the
generated `package.json` itself is byte-identical to direct generator
output — redirection happens entirely in pnpm resolution, never by mutating
the artifact.

**Ref source rule** — which `--dplaax-module-ref` each context passes:

| Context | Ref |
| --- | --- |
| `make instances` / workspace-mode smoke | `git rev-parse HEAD` (resolution is overridden anyway; the emitted ref stays honest) |
| Consumer-mode smoke | the exact tag or commit SHA under test (`main`'s HEAD SHA on `main` builds; the release tag on release builds) |

#### 6.3.2 Consumer-mode transitive resolution — resolved

Resolved 2026-06-11 (decision on open question 3): the bare consumer
install was confirmed broken in exactly the predicted way, and the scaffold
now ships the `pnpm.overrides` + `pnpm.onlyBuiltDependencies` provisions
specified in § 3.4. Consumer-mode smoke is a gating CI job; npm publication
of the `@provin-line/*` libraries remains a possible future simplification
(tracked separately), at which point the overrides retire.

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
