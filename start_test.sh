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
echo "1/4 启动并等待 MySQL 健康..."
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 180 mysql; then
  echo "MySQL 启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps mysql || true
  "${COMPOSE[@]}" logs --tail=200 mysql || true
  exit 1
fi

echo "2/4 构建后端应用镜像..."
if ! build_service app; then
  echo "镜像构建失败，输出当前 Docker Compose 状态："
  "${COMPOSE[@]}" ps || true
  exit 1
fi

echo "3/4 启动并等待后端服务健康..."
if ! "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 app; then
  echo "后端服务启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps || true
  "${COMPOSE[@]}" logs --tail=200 mysql app || true
  exit 1
fi

echo "4/4 检查证书并启动 Nginx..."
if [ ! -r client/dist/index.html ]; then
  echo "Nginx 启动失败：缺少 client/dist/index.html，请先完成前端构建或上传 dist 目录。"
  exit 1
fi
for ssl_file in client/ssl/2026_hyp-arch.com.pem client/ssl/2026_hyp-arch.com.key; do
  if [ ! -r "$ssl_file" ]; then
    echo "Nginx 启动失败：缺少或无法读取证书文件 ${ssl_file}"
    exit 1
  fi
done

if ! "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 60 nginx; then
  echo "Nginx 启动失败，输出诊断信息："
  "${COMPOSE[@]}" ps -a nginx || true
  nginx_container_id=$("${COMPOSE[@]}" ps -q nginx || true)
  if [ -n "$nginx_container_id" ]; then
    docker inspect --format '容器状态={{.State.Status}} 启动错误={{.State.Error}} 退出码={{.State.ExitCode}}' "$nginx_container_id" || true
  fi
  "${COMPOSE[@]}" logs --tail=200 nginx || true
  echo "如果启动错误包含 address already in use，请检查宿主机端口：ss -ltnp '( sport = :80 or sport = :443 )'"
  exit 1
fi

echo "测试环境已启动：MySQL、后端和 Nginx 均由 Docker Compose 管理。"
echo "查看状态：${COMPOSE[*]} ps"
echo "查看日志：${COMPOSE[*]} logs -f"
