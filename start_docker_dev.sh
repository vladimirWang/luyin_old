#!/bin/bash

echo "启动 Docker 开发环境..."
echo "服务器端口: 8787"
echo "调试端口: 9229"
echo "前端端口: 7000"
echo ""

docker compose -f docker-compose.dev.yml up --build -d

echo ""
echo "Docker 开发环境已启动！"
echo "API 接口: http://localhost:8787/api/recordings"
echo "调试器端口: 9229 (VS Code 可连接此端口调试)"
echo "前端页面: http://localhost:7000"
echo ""
echo "查看日志: docker compose -f docker-compose.dev.yml logs -f"
echo "停止服务: docker compose -f docker-compose.dev.yml down"