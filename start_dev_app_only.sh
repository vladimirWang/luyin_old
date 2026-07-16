#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

echo "只构建并启动开发环境的 app 服务（不启动 mysql/nginx）..."

docker compose \
  --env-file .env.dev \
  -f docker-compose.dev.yml \
  up -d --build --no-deps app

echo "app 已启动：http://localhost:8787"
echo "查看日志：docker compose --env-file .env.dev -f docker-compose.dev.yml logs -f app"
