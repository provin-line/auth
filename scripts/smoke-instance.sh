#!/usr/bin/env bash
# Boot a generated instance and assert its health endpoint responds
# (create-app.md § 6.3). Usage: smoke-instance.sh <instance-dir> <port> <health-path>
set -euo pipefail

dir="$1"
port="$2"
health_path="$3"

if [ ! -f "$dir/dist/main.mjs" ]; then
	echo "smoke: $dir/dist/main.mjs missing — run the build first" >&2
	exit 1
fi

# A pre-bound port means any health response would come from a stale
# server, not the build under test — fail fast instead of false-passing.
if curl -fsS -o /dev/null --max-time 2 "http://localhost:$port$health_path" 2>/dev/null; then
	echo "smoke: port $port already serving $health_path — refusing to run against a stale server" >&2
	exit 1
fi

# Minimal boot config: HS256 needs only a secret; issuer satisfies OIDC wiring.
export OAUTH_JWT_ALGORITHM=HS256
export OAUTH_JWT_SECRET=smoke-only-secret
export OAUTH_JWT_ISSUER=https://smoke.invalid
export HTTP_PORT="$port"

# `exec` so $! is the node PID itself, not a subshell wrapper — otherwise
# the EXIT trap kills only the subshell and node leaks past the script.
(cd "$dir" && exec node dist/main.mjs) &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
	if curl -fsS "http://localhost:$port$health_path" >/dev/null 2>&1; then
		echo "smoke: healthy — $dir on :$port$health_path"
		exit 0
	fi
	if ! kill -0 "$pid" 2>/dev/null; then
		echo "smoke: process exited before becoming healthy — $dir" >&2
		exit 1
	fi
	sleep 1
done

echo "smoke: health check timed out after 30s — $dir" >&2
exit 1
