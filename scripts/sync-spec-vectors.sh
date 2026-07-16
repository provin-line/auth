#!/usr/bin/env bash
# Vendor dplaax.spec_draft's auth.*/did-resolution-auth conformance vectors
# into integration/conformance/vectors/ (Task 11, rule
# auth.contract.normative-sot). Not run in CI yet — a manual/local step
# until P2 wires a cross-repo job.
#
# Usage: DPLAAX_SPEC_DIR=/path/to/dplaax.spec_draft scripts/sync-spec-vectors.sh
set -euo pipefail

if [[ -z "${DPLAAX_SPEC_DIR:-}" ]]; then
	echo "error: DPLAAX_SPEC_DIR is not set (path to a dplaax.spec_draft checkout)" >&2
	exit 1
fi

SPEC_VECTORS_DIR="${DPLAAX_SPEC_DIR}/vectors"
if [[ ! -d "$SPEC_VECTORS_DIR" ]]; then
	echo "error: ${SPEC_VECTORS_DIR} does not exist" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/../integration/conformance/vectors"
mkdir -p "$DEST_DIR"

shopt -s nullglob
files=("$SPEC_VECTORS_DIR"/auth-*.json "$SPEC_VECTORS_DIR"/did-resolution-*.json)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
	echo "warning: no auth-*.json or did-resolution-*.json vectors found in ${SPEC_VECTORS_DIR} — nothing to sync" >&2
fi

manifest_file="${DEST_DIR}/SYNC_MANIFEST.json"
{
	echo "{"
	printf '  "source": "%s",\n' "$DPLAAX_SPEC_DIR"
	printf '  "synced_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo '  "files": {'
	total=${#files[@]}
	i=0
	for f in "${files[@]}"; do
		i=$((i + 1))
		base="$(basename "$f")"
		cp "$f" "${DEST_DIR}/${base}"
		# shasum -a 256 (not sha256sum) for macOS/BSD portability.
		sha="$(shasum -a 256 "$f" | awk '{print $1}')"
		if [[ $i -lt $total ]]; then
			printf '    "%s": "%s",\n' "$base" "$sha"
		else
			printf '    "%s": "%s"\n' "$base" "$sha"
		fi
	done
	echo "  }"
	echo "}"
} >"$manifest_file"

echo "synced ${#files[@]} vector(s) from ${SPEC_VECTORS_DIR} into ${DEST_DIR}"
echo "manifest: ${manifest_file}"
