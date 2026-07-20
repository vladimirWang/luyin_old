#!/bin/bash
set -euo pipefail

COMPOSE=(docker compose --env-file .env.test -f docker-compose.test.yml)

build_service() {
  local service="$1"
  local attempt

  for attempt in 1 2; do
    echo "构建 ${service}（第 ${attempt}/2 次）..."
    if "${COMPOSE[@]}" --progress plain build "$service"; then
      return 0
    fi

    if [ "$attempt" -eq 1 ]; then
      echo "${service} 构建失败，等待 3 秒后重试..."
      sleep 3
    fi
  done

  echo "${service} 连续两次构建失败。"
  return 1
}

echo "启动阿里云测试环境完整服务栈..."
echo "1/3 启动并等待 MySQL 健康..."
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 180 mysql; then
  echo "MySQL 启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps mysql || true
  "${COMPOSE[@]}" logs --tail=200 mysql || true
  exit 1
fi

echo "2/3 依次构建应用镜像，避免低资源环境下并行构建超时..."
for service in app py_server nginx; do
  if ! build_service "$service"; then
    echo "镜像构建失败，输出当前 Docker Compose 状态："
    "${COMPOSE[@]}" ps || true
    exit 1
  fi
done

echo "3/3 启动并等待应用服务健康..."
if ! "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180; then
  echo "应用服务启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps || true
  "${COMPOSE[@]}" logs --tail=200 mysql app py_server nginx || true
  exit 1
fi

echo "测试环境已启动：MySQL、后端、Python 服务和 Nginx 均由 Docker Compose 管理。"
echo "查看状态：${COMPOSE[*]} ps"
echo "查看日志：${COMPOSE[*]} logs -f"
