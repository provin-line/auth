# Repo-root developer targets (create-app.md § 5).
#
# `make instances` regenerates the throwaway composition roots under
# instances/ from the scaffold generators. instances/ is git-ignored and a
# pnpm workspace member: the overrides in the root pnpm-workspace.yaml
# redirect the generated git-subdirectory deps to workspace:* (create-app.md
# § 6.3.1), so instances always build against the local package state. The
# overrides and build allowances an instance carries in its own
# pnpm-workspace.yaml (create-app.md § 3.4) are for external consumers and
# inert inside this workspace.

HEAD_SHA = $(shell git rev-parse HEAD)

.PHONY: instances clean-instances smoke

instances:
	rm -rf instances
	node packages/create-provider/dist/cli.mjs provider \
		--dplaax-module-ref $(HEAD_SHA) \
		--out instances/provider --no-git-init
	node packages/create-policy-verifier/dist/cli.mjs policy-verifier \
		--dplaax-module-ref $(HEAD_SHA) --port 3001 \
		--out instances/policy-verifier --no-git-init
	# --no-frozen-lockfile explicitly: the committed lockfile intentionally
	# has no instances/* importers (see clean-instances below), so a frozen
	# install — pnpm's default under CI=true — always fails here once the
	# generated instances' pins move ahead of the workspace lockfile.
	pnpm install --no-frozen-lockfile

# Restores pnpm-lock.yaml as well: with instances/ present, `pnpm install`
# records instances/* importers in the lockfile. Those are local-only and
# the committed lockfile must never contain them. NOTE: pnpm's frozen
# install TOLERATES stale extra importers (verified on pnpm 10.30.2; not
# re-verified on 11), so
# CI does NOT catch an accidental commit via --frozen-lockfile; a dedicated
# CI step greps the lockfile for instances/* importers instead. Run this
# target before committing if you have generated instances.
clean-instances:
	rm -rf instances
	pnpm install

# Ports of the smoke's servers. Override when one is taken locally:
#   make smoke PROVIDER_PORT=3200 VERIFIER_PORT=3201
PROVIDER_PORT ?= 3100
VERIFIER_PORT ?= 3001

# Workspace-mode scaffold smoke (create-app.md § 6.3). The policy-verifier
# instance is built, typechecked and booted, and its health endpoint asserted.
# The provider instance runs its sources (`node src/main.ts`, no build): the
# smoke boots it and drives one real DID-grant round trip (a boot alone let
# the PDP surface drift and the missing @noble/ed25519 through).
smoke:
	pnpm --filter ./instances/policy-verifier run build
	pnpm --filter ./instances/policy-verifier run typecheck
	./scripts/smoke-instance.sh instances/policy-verifier $(VERIFIER_PORT) /healthcheck /verify
	node scripts/smoke-did-grant.mjs instances/provider $(PROVIDER_PORT)
