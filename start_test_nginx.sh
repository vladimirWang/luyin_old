#!/bin/bash

set -euo pipefail

COMPOSE=(docker compose --env-file .env.test -f docker-compose.test.yml)

echo "启动阿里云测试环境完整服务栈..."
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 180

echo "测试环境已启动：MySQL、后端、Python 服务和 Nginx 均由 Docker Compose 管理。"
echo "查看状态：${COMPOSE[*]} ps"
echo "查看日志：${COMPOSE[*]} logs -f"
