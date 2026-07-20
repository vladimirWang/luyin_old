#!/bin/bash
set -euo pipefail

COMPOSE=(docker compose --env-file .env.test -f docker-compose.test.yml)

echo "启动阿里云测试环境完整服务栈..."
echo "1/2 启动并等待 MySQL 健康..."
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 180 mysql; then
  echo "MySQL 启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps mysql || true
  "${COMPOSE[@]}" logs --tail=200 mysql || true
  exit 1
fi

echo "2/2 构建并启动应用服务..."
if ! "${COMPOSE[@]}" up -d --build --wait --wait-timeout 180; then
  echo "应用服务启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps || true
  "${COMPOSE[@]}" logs --tail=200 mysql app py_server nginx || true
  exit 1
fi

echo "测试环境已启动：MySQL、后端、Python 服务和 Nginx 均由 Docker Compose 管理。"
echo "查看状态：${COMPOSE[*]} ps"
echo "查看日志：${COMPOSE[*]} logs -f"
