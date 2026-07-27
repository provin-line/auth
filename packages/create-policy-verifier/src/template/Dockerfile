# syntax=docker/dockerfile:1.7
#
# Build context: this directory.
#
#   docker build -t <tag> .
#
# Standalone build. The `@provin-line/*` deps are resolved by pnpm from their
# git-subdirectory refs at install time; no monorepo workspace context is
# required.
#
# `--frozen-lockfile` is intentionally NOT used: the scaffold ships
# without a `pnpm-lock.yaml`, so the first `docker build` resolves deps
# fresh. Once you commit a lockfile, add `--frozen-lockfile` to the
# install lines below for reproducible builds.

FROM node:24-alpine AS node-base

ENV HOME=/home/node

RUN apk add --no-cache tini git \
 && npm install -g corepack@0.35.0 --force \
 && corepack enable

WORKDIR /home/node/app

# --- builder: install deps and compile ---
FROM node-base AS builder

COPY package.json ./
RUN pnpm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY config/ ./config/

RUN pnpm run build

# --- runtime: prod deps + built dist/ + config/ ---
FROM node-base AS runtime

ENV NODE_ENV=production

COPY package.json ./
RUN pnpm install --prod

COPY --from=builder /home/node/app/dist/ ./dist/
COPY --from=builder /home/node/app/config/ ./config/

USER node

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.mjs"]

# --- test: run tests inside the image (CI helper) ---
# Inherits builder's tsconfig + src/ + config/, so configFiles.test.mts
# can walk ../../../config when running in the image.
FROM builder AS test

CMD ["pnpm", "run", "test", "--", "--passWithNoTests"]
