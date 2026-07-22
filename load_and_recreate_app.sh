#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_PATH="${1:-}"
IMAGE_NAME="${IMAGE_NAME:-luyin_old-app:latest}"
ENV_FILE="${ENV_FILE:-.env.test}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
IMAGE_COMPOSE_FILE="${IMAGE_COMPOSE_FILE:-docker-compose.image.yml}"

usage() {
  echo "用法：$0 <镜像归档.tar或镜像归档.tar.gz>" >&2
  echo "示例：$0 ~/luyin_old-app_latest-20260722-181200.tar.gz" >&2
}

if [[ -z "${ARCHIVE_PATH}" ]]; then
  usage
  exit 1
fi

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "镜像归档不存在：${ARCHIVE_PATH}" >&2
  exit 1
fi
ARCHIVE_PATH="$(cd -- "$(dirname -- "${ARCHIVE_PATH}")" && pwd)/$(basename -- "${ARCHIVE_PATH}")"

for command_name in docker; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少命令：${command_name}" >&2
    exit 1
  fi
done

cd "${SCRIPT_DIR}"

for required_file in "${ENV_FILE}" "${COMPOSE_FILE}" "${IMAGE_COMPOSE_FILE}"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "缺少部署文件：${SCRIPT_DIR}/${required_file}" >&2
    exit 1
  fi
done

echo "正在导入镜像归档：${ARCHIVE_PATH}"
docker load -i "${ARCHIVE_PATH}"

if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "归档已导入，但没有找到预期镜像：${IMAGE_NAME}" >&2
  echo "当前相关镜像：" >&2
  docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.ID}}' | grep 'luyin_old-app' >&2 || true
  exit 1
fi

compose=(
  docker compose
  --env-file "${ENV_FILE}"
  -f "${COMPOSE_FILE}"
  -f "${IMAGE_COMPOSE_FILE}"
)

echo "正在校验 Compose 配置"
"${compose[@]}" config >/dev/null

echo "正在使用 ${IMAGE_NAME} 强制重建 app 容器"
"${compose[@]}" up -d --no-build --force-recreate app

container_id="$("${compose[@]}" ps -q app)"
if [[ -z "${container_id}" ]]; then
  echo "app 容器未创建成功" >&2
  exit 1
fi

actual_image="$(docker inspect "${container_id}" --format '{{.Config.Image}}')"
if [[ "${actual_image}" != "${IMAGE_NAME}" ]]; then
  echo "app 容器使用了错误镜像：${actual_image}，预期：${IMAGE_NAME}" >&2
  exit 1
fi

echo "app 容器已重建，当前状态："
"${compose[@]}" ps app

echo "最近的 app 日志："
"${compose[@]}" logs --tail=80 app
