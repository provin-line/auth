# Repo-root developer targets (create-app.md § 5).
#
# `make instances` regenerates the throwaway composition roots under
# instances/ from the scaffold generators. instances/ is git-ignored and a
# pnpm workspace member: the root pnpm.overrides redirect the generated
# git-subdirectory deps to workspace:* (create-app.md § 6.3.1), so instances
# always build against the local package state. pnpm prints WARNs that the
# instances' own pnpm.overrides/onlyBuiltDependencies "will not take
# effect" — expected: that block is for external consumers (create-app.md
# § 3.4) and is intentionally inert inside this workspace.

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
# install TOLERATES stale extra importers (verified on pnpm 10.30.2), so
# CI does NOT catch an accidental commit via --frozen-lockfile; a dedicated
# CI step greps the lockfile for instances/* importers instead. Run this
# target before committing if you have generated instances.
clean-instances:
	rm -rf instances
	pnpm install

# Workspace-mode scaffold smoke (create-app.md § 6.3): build, typecheck,
# boot each generated instance and assert its health endpoint responds, then
# drive one real DID-grant round trip against the provider (the boot smoke
# alone let two consumer-install gaps through — the PDP surface drift and the
# generated provider's missing @noble/ed25519).
smoke:
	pnpm --filter ./instances/provider --filter ./instances/policy-verifier run build
	pnpm --filter ./instances/provider --filter ./instances/policy-verifier run typecheck
	./scripts/smoke-instance.sh instances/provider 3000 /_healthcheck
	./scripts/smoke-instance.sh instances/policy-verifier 3001 /healthcheck
	node scripts/smoke-did-grant.mjs instances/provider 3100
