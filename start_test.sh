#!/bin/bash

set -e

echo "=========================================="
echo "  启动录音应用测试环境"
echo "=========================================="

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

echo ""
echo "[1/3] 检查环境..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装或未启动"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose 未安装"
    exit 1
fi

echo "✅ Docker 环境就绪"

echo ""
echo "[2/3] 构建镜像..."
docker compose -f docker-compose.test.yml up -d --build

echo ""
echo "[3/3] 启动服务..."
docker compose --env-file .env.test -f docker-compose.test.yml logs -f --tail=20

echo ""
echo "=========================================="
echo "  测试环境已启动"
echo "=========================================="
echo ""
echo "前端访问: http://localhost:5173"
echo "API地址: http://localhost:5173/api"
echo ""
echo "停止服务: docker compose -f docker-compose.test.yml down"