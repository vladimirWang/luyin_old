#!/bin/bash
# 开发环境 Docker 启动脚本（数据卷模式，支持热更新）
# 使用方法：bash start_dev_docker.sh

set -e

echo "=== 停止旧的开发容器 ==="
docker compose -f docker-compose.dev.yml down --remove-orphans 2>/dev/null || true

echo "=== 清理旧的开发卷（如需重置依赖） ==="
# 如需强制重新安装依赖，取消以下注释
# docker compose -f docker-compose.dev.yml down -v

echo "=== 启动开发环境 ==="
docker compose -f docker-compose.dev.yml up -d --build

echo ""
echo "=== 等待服务就绪 ==="
sleep 5

echo ""
echo "=== 服务状态 ==="
docker compose -f docker-compose.dev.yml ps

echo ""
echo "=== 访问地址 ==="
echo "  前端（Vite 开发服务器）: http://localhost:5173"
echo "  后端 API:               http://localhost:7000"
echo "  Redis:                  localhost:6379"
echo ""
echo "=== 查看日志 ==="
echo "  后端日志: docker compose -f docker-compose.dev.yml logs -f app"
echo "  前端日志: docker compose -f docker-compose.dev.yml logs -f web"
echo ""
echo "=== 停止开发环境 ==="
echo "  docker compose -f docker-compose.dev.yml down"
