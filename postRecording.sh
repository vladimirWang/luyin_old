#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AUDIO_FILE="${SCRIPT_DIR}/1.txt"
API_URL="${API_URL:-http://127.0.0.1:8787/api/recordings}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-15}"

if [[ ! -f "${AUDIO_FILE}" ]]; then
  echo "Missing upload fixture: ${AUDIO_FILE}" >&2
  exit 1
fi

echo "POST ${API_URL}"
echo "audio=${AUDIO_FILE}"

resp=$(curl --fail-with-body \
  --silent \
  --show-error \
  --max-time "${REQUEST_TIMEOUT_SECONDS}" \
  --request POST \
  --form "audio=@${AUDIO_FILE};type=text/plain" \
  --write-out $'\nHTTP %{http_code}\n' \
  "${API_URL}")
echo "$resp"
