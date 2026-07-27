# syntax=docker/dockerfile:1.7
#
# Canonical image build for a GENERATED provin.auth instance (policy-verifier
# or auth-provider). provin.auth is a generator repo — a runnable instance is
# not committed anywhere; it is scaffolded by the create-* CLIs. This
# Dockerfile (1) clones provin.auth at a pinned ref, (2) builds the requested
# generator CLI, (3) scaffolds an instance pinned to the SAME ref, and
# (4) builds + runs it. It is the consumer-mode build path (git-subdir deps),
# the same shape provin.oss's quickstart proved end to end; the publish-images
# workflow builds and pushes it to GHCR so consumers reference an image
# instead of re-running this generation themselves.
#
# GITHUB ACCESS: while provin.auth is private, the clone and the instance's
# pnpm install (git-subdir refs into this repo) need a GitHub token. Pass it
# as a BuildKit secret `github_token` (in CI: the workflow's GITHUB_TOKEN).
# Once the repo is public this is inert — anonymous fetch just works.
#
# Scaffold-time parameters that are deployment-specific (e.g. the
# auth-provider's --registry-base-url) get placeholder values here and are
# overridden at runtime via env (DPLAAX_REGISTRY_BASE_URL) — the image stays
# deployment-generic.

# GENERATOR: "policy-verifier" | "provider" — the COMPONENT name. Each
# namespace adds the prefix its own context does not supply: the directory is
# packages/create-${GENERATOR} (inside the auth repo), the npm package is
# @provin-line/create-auth-${GENERATOR}, the image is auth-${GENERATOR}.
# (selects the create-* CLI,
# the instance name, and the exposed port).
ARG GENERATOR=policy-verifier
ARG AUTH_REF=poc
ARG PORT=3001
# Extra scaffold args (word-split deliberately; placeholder-only values).
ARG SCAFFOLD_ARGS=""

# --- gen: clone provin.auth, build the generator, scaffold the instance ---
FROM node:24-alpine AS gen
RUN apk add --no-cache git && npm install -g corepack@0.35.0 --force && corepack enable
WORKDIR /src
ARG GENERATOR
ARG AUTH_REF
ARG PORT
ARG SCAFFOLD_ARGS
RUN --mount=type=secret,id=github_token \
    tok="$(cat /run/secrets/github_token 2>/dev/null || true)"; \
    if [ -n "$tok" ]; then \
      export GIT_CONFIG_COUNT=1 \
        GIT_CONFIG_KEY_0="url.https://x-access-token:${tok}@github.com/.insteadOf" \
        GIT_CONFIG_VALUE_0="https://github.com/"; \
    fi; \
    git clone https://github.com/provin-line/auth.git . \
 && git checkout "${AUTH_REF}" \
 && pnpm install --frozen-lockfile \
 && pnpm --filter "@provin-line/create-auth-${GENERATOR}" build \
 && node "packages/create-${GENERATOR}/dist/cli.mjs" "${GENERATOR}" \
      --dplaax-module-ref "${AUTH_REF}" --port "${PORT}" \
      ${SCAFFOLD_ARGS} \
      --out /instance --no-git-init

# --- builder: install the instance's deps (git-subdir refs) and compile ---
FROM node:24-alpine AS builder
RUN apk add --no-cache git && npm install -g corepack@0.35.0 --force && corepack enable
WORKDIR /app
COPY --from=gen /instance/ ./
RUN --mount=type=secret,id=github_token \
    tok="$(cat /run/secrets/github_token 2>/dev/null || true)"; \
    if [ -n "$tok" ]; then \
      export GIT_CONFIG_COUNT=1 \
        GIT_CONFIG_KEY_0="url.https://x-access-token:${tok}@github.com/.insteadOf" \
        GIT_CONFIG_VALUE_0="https://github.com/"; \
    fi; \
    pnpm install \
 && pnpm run build

# --- runtime: the built app copied wholesale from the builder ---
# A `pnpm install --prod` here would refetch the git-subdir deps and run their
# `prepare` (tsc) with devDependencies pruned, which fails. Copying the
# builder's already-installed, already-built /app (node_modules is
# self-contained: pnpm's links stay within node_modules) sidesteps that and
# needs no GitHub access.
FROM node:24-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production
ARG PORT
WORKDIR /app
COPY --from=builder /app/ ./
EXPOSE ${PORT}
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.mjs"]
