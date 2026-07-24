#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

COMPOSE=(docker compose --env-file .env.test -f docker-compose.test_complete.yml)

# After reproducing the issue, run ./collect_test_complete_logs.sh and share the generated log file.

if [[ ! -r .env.test ]]; then
  echo "部署失败：缺少或无法读取 .env.test。" >&2
  exit 1
fi

if [[ ! -r client/dist/index.html ]]; then
  echo "部署失败：缺少 client/dist/index.html，请先完成前端构建。" >&2
  exit 1
fi

for ssl_file in client/ssl/2026_hyp-arch.com.pem client/ssl/2026_hyp-arch.com.key; do
  if [[ ! -r "${ssl_file}" ]]; then
    echo "部署失败：缺少或无法读取证书文件 ${ssl_file}" >&2
    exit 1
  fi
done

echo "正在整体构建并启动测试环境..."
"${COMPOSE[@]}" up --build -d --wait --wait-timeout 300 mysql redis app
"${COMPOSE[@]}" up -d --wait --wait-timeout 60 nginx

echo "测试环境部署完成。"
echo "查看状态：${COMPOSE[*]} ps"
echo "查看日志：${COMPOSE[*]} logs -f"
