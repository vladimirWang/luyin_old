#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

compose=(docker compose --env-file .env.dev -f docker-compose.dev.yml)

echo "Starting local Docker development environment..."
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait --wait-timeout 180

echo
"${compose[@]}" ps
echo
echo "App:        http://localhost:${APP_PORT:-8787}"
echo "Node debug: localhost:${APP_DEBUG_PORT:-9229}"
echo "MySQL:     localhost:${MYSQL_HOST_PORT:-3307}"
echo "Redis:     localhost:${REDIS_HOST_PORT:-6379}"
echo
echo "Follow logs: ${compose[*]} logs -f app"
echo "Stop:        ${compose[*]} down"
