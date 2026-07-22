#!/usr/bin/env bash

set -Eeuo pipefail

IMAGE_NAME="${IMAGE_NAME:-luyin_old-app:latest}"
REMOTE_TARGET="${REMOTE_TARGET:-root@172.16.200.9:~/}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="${ARCHIVE_NAME:-luyin_old-app_latest-${TIMESTAMP}.tar.gz}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$(pwd)/${ARCHIVE_NAME}}"
PARTIAL_PATH="${ARCHIVE_PATH}.partial"

cleanup() {
  rm -f -- "${PARTIAL_PATH}"
}
trap cleanup EXIT

for command_name in docker gzip scp; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少命令：${command_name}" >&2
    exit 1
  fi
done

if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "本地不存在镜像：${IMAGE_NAME}" >&2
  echo "请先构建或为现有镜像添加该标签。" >&2
  exit 1
fi

if [[ -e "${ARCHIVE_PATH}" ]]; then
  echo "归档文件已存在，拒绝覆盖：${ARCHIVE_PATH}" >&2
  exit 1
fi

echo "正在导出镜像：${IMAGE_NAME}"
docker save "${IMAGE_NAME}" | gzip -1 > "${PARTIAL_PATH}"

echo "正在校验压缩包：${PARTIAL_PATH}"
gzip -t "${PARTIAL_PATH}"
mv -- "${PARTIAL_PATH}" "${ARCHIVE_PATH}"

echo "归档已生成："
ls -lh "${ARCHIVE_PATH}"

echo "正在上传到：${REMOTE_TARGET}"
echo "scp 提示时请输入服务器 SSH 密码。"
scp "${ARCHIVE_PATH}" "${REMOTE_TARGET}"

echo "上传完成。服务器上可执行："
echo "  docker load -i ~/${ARCHIVE_NAME}"
