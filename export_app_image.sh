#!/usr/bin/env bash

set -Eeuo pipefail

IMAGE_NAME="${IMAGE_NAME:-luyin_old-app:latest}"
BASE_IMAGE_NAME="${BASE_IMAGE_NAME:-luyin-old-app-base:node22-bookworm-ffmpeg-v1}"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"
BUILD_CONTEXT="${BUILD_CONTEXT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/server}"
DOCKERFILE="${DOCKERFILE:-${BUILD_CONTEXT}/Dockerfile}"
BASE_DOCKERFILE="${BASE_DOCKERFILE:-${BUILD_CONTEXT}/Dockerfile.base}"
BUILD_IMAGE="${BUILD_IMAGE:-true}"
REMOTE_TARGET="${REMOTE_TARGET:-root@172.16.200.9:~/luyin_old}"
SCP_CONTROL_PATH="${SCP_CONTROL_PATH:-}"
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

if [[ "${BUILD_IMAGE}" == "true" ]]; then
  if ! docker buildx version >/dev/null 2>&1; then
    echo "Docker Buildx 不可用，无法构建 ${TARGET_PLATFORM} 镜像。" >&2
    exit 1
  fi
  if [[ ! -f "${DOCKERFILE}" ]]; then
    echo "Dockerfile 不存在：${DOCKERFILE}" >&2
    exit 1
  fi
  if [[ ! -f "${BASE_DOCKERFILE}" ]]; then
    echo "基础镜像 Dockerfile 不存在：${BASE_DOCKERFILE}" >&2
    exit 1
  fi

  echo "正在为目标服务器构建 ${TARGET_PLATFORM} 基础镜像：${BASE_IMAGE_NAME}"
  docker buildx build \
    --platform "${TARGET_PLATFORM}" \
    --file "${BASE_DOCKERFILE}" \
    --tag "${BASE_IMAGE_NAME}" \
    --load \
    "${BUILD_CONTEXT}"

  echo "正在基于 ${BASE_IMAGE_NAME} 构建业务镜像：${IMAGE_NAME}"
  docker buildx build \
    --platform "${TARGET_PLATFORM}" \
    --file "${DOCKERFILE}" \
    --build-arg "APP_BASE_IMAGE=${BASE_IMAGE_NAME}" \
    --tag "${IMAGE_NAME}" \
    --load \
    "${BUILD_CONTEXT}"
elif [[ "${BUILD_IMAGE}" != "false" ]]; then
  echo "BUILD_IMAGE 只能是 true 或 false，当前值：${BUILD_IMAGE}" >&2
  exit 1
fi

if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "本地不存在镜像：${IMAGE_NAME}" >&2
  echo "请先构建或为现有镜像添加该标签。" >&2
  exit 1
fi

image_os="$(docker image inspect "${IMAGE_NAME}" --format '{{.Os}}')"
image_arch="$(docker image inspect "${IMAGE_NAME}" --format '{{.Architecture}}')"
if [[ "${image_os}/${image_arch}" != "${TARGET_PLATFORM}" ]]; then
  echo "镜像平台不匹配：当前 ${image_os}/${image_arch}，目标 ${TARGET_PLATFORM}" >&2
  echo "请保留 BUILD_IMAGE=true，让脚本重新构建目标平台镜像。" >&2
  exit 1
fi

echo "镜像平台校验通过：${image_os}/${image_arch}"

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
scp_options=()
if [[ -n "${SCP_CONTROL_PATH}" ]]; then
  echo "正在复用已建立的 SSH 连接。"
  scp_options+=( -o "ControlPath=${SCP_CONTROL_PATH}" )
else
  echo "scp 提示时请输入服务器 SSH 密码。"
fi
scp "${scp_options[@]}" "${ARCHIVE_PATH}" "${REMOTE_TARGET}"

echo "上传完成。服务器上可执行："
echo "  docker load -i ${REMOTE_TARGET%/}/${ARCHIVE_NAME}"
