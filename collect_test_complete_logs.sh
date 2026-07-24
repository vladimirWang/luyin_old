#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

COMPOSE=(docker compose --env-file .env.test -f docker-compose.test_complete.yml)
STAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="${1:-tencent-meeting-diagnostics-${STAMP}.log}"

{
  echo "# generated_at=$(date --iso-8601=seconds)"
  echo "# compose_status"
  "${COMPOSE[@]}" ps
  echo "# app_container_logs"
  "${COMPOSE[@]}" logs --no-color --timestamps app
  echo "# application_log_files"
  "${COMPOSE[@]}" exec -T app sh -c 'for file in /app/logs/*.log; do [ -f "$file" ] || continue; echo "## $file"; cat "$file"; done'
  echo "# storage_summary"
  "${COMPOSE[@]}" exec -T app sh -c 'find /app/server/storage -maxdepth 2 -type f -printf "%p\t%s bytes\t%TY-%Tm-%TdT%TH:%TM:%TS\n" 2>&1 | sort'
} > "${OUTPUT}" 2>&1

echo "Diagnostics written to ${OUTPUT}"
