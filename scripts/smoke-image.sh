#!/usr/bin/env bash
# Run a built image of a generated instance and assert its health endpoint
# answers (create-app.md § 6.3). Usage:
#   smoke-image.sh <image> <host-port> <container-port> <health-path> [<protected-path>] [-- <docker run args>]
# With <protected-path>, a POST to it without a token must answer 401.
set -euo pipefail

image="$1"
port="$2"
container_port="$3"
health_path="$4"
shift 4
protected_path=""
if [ "$#" -gt 0 ] && [ "$1" != "--" ]; then
	protected_path="$1"
	shift
fi
if [ "${1:-}" = "--" ]; then
	shift
fi

if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port$health_path" 2>/dev/null; then
	echo "smoke-image: port $port already serving $health_path — refusing to run against a stale server" >&2
	exit 1
fi

name="smoke-image-$$"
docker run -d --name "$name" -p "127.0.0.1:$port:$container_port" "$@" "$image" >/dev/null
cleanup() {
	docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
	if curl -fsS "http://127.0.0.1:$port$health_path" >/dev/null 2>&1; then
		echo "smoke-image: healthy — $image on :$port$health_path"
		if [ -n "$protected_path" ]; then
			code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST \
				-H 'content-type: application/json' -d '{"resource":"smoke","action":"read"}' "http://127.0.0.1:$port$protected_path" || true)"
			if [ "$code" != "401" ]; then
				echo "smoke-image: POST $protected_path without a token answered $code, want 401 — $image" >&2
				exit 1
			fi
			echo "smoke-image: POST $protected_path without a token refused with 401"
		fi
		exit 0
	fi
	if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)" != "true" ]; then
		echo "smoke-image: container exited before becoming healthy — $image" >&2
		docker logs "$name" >&2 || true
		exit 1
	fi
	sleep 1
done

echo "smoke-image: health check timed out after 40s — $image" >&2
docker logs "$name" >&2 || true
exit 1
