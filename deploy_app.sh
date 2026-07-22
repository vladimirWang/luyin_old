#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_HOST="${REMOTE_HOST:-root@172.16.200.9}"
REMOTE_DIR="${REMOTE_DIR:-/root/luyin_old}"
IMAGE_NAME="${IMAGE_NAME:-luyin_old-app:latest}"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"
LOCAL_ARCHIVE_DIR="${LOCAL_ARCHIVE_DIR:-${SCRIPT_DIR}/app_imgages}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="${ARCHIVE_NAME:-luyin_old-app_latest-${TIMESTAMP}.tar.gz}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${LOCAL_ARCHIVE_DIR}/${ARCHIVE_NAME}}"
CONTROL_DIR=""
CONTROL_PATH=""

cleanup() {
  if [[ -n "${CONTROL_PATH}" ]]; then
    ssh -o "ControlPath=${CONTROL_PATH}" -O exit "${REMOTE_HOST}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${CONTROL_DIR}" && -d "${CONTROL_DIR}" ]]; then
    rmdir "${CONTROL_DIR}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for command_name in ssh scp mktemp; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少命令：${command_name}" >&2
    exit 1
  fi
done

for required_script in export_app_image.sh load_and_recreate_app.sh; do
  if [[ ! -x "${SCRIPT_DIR}/${required_script}" ]]; then
    echo "脚本不存在或不可执行：${SCRIPT_DIR}/${required_script}" >&2
    exit 1
  fi
done

if [[ "${REMOTE_DIR}" == *"'"* || "${ARCHIVE_NAME}" == *"'"* || "${IMAGE_NAME}" == *"'"* ]]; then
  echo "远端目录、归档名称或镜像名称不能包含单引号" >&2
  exit 1
fi

mkdir -p "${LOCAL_ARCHIVE_DIR}"
CONTROL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/luyin-deploy.XXXXXX")"
CONTROL_PATH="${CONTROL_DIR}/ssh-control"

echo "正在连接目标服务器：${REMOTE_HOST}"
echo "SSH 提示时请输入一次服务器密码，后续上传和部署将复用该连接。"
ssh \
  -o ControlMaster=yes \
  -o ControlPersist=10m \
  -o "ControlPath=${CONTROL_PATH}" \
  -MNf "${REMOTE_HOST}"

if ! ssh -o "ControlPath=${CONTROL_PATH}" "${REMOTE_HOST}" "test -d '${REMOTE_DIR}'"; then
  echo "目标服务器项目目录不存在：${REMOTE_DIR}" >&2
  exit 1
fi

echo "步骤 1/3：导出并上传镜像"
IMAGE_NAME="${IMAGE_NAME}" \
TARGET_PLATFORM="${TARGET_PLATFORM}" \
REMOTE_TARGET="${REMOTE_HOST}:${REMOTE_DIR}/" \
SCP_CONTROL_PATH="${CONTROL_PATH}" \
ARCHIVE_NAME="${ARCHIVE_NAME}" \
ARCHIVE_PATH="${ARCHIVE_PATH}" \
  "${SCRIPT_DIR}/export_app_image.sh"

echo "步骤 2/3：同步目标服务器加载脚本"
scp \
  -o "ControlPath=${CONTROL_PATH}" \
  "${SCRIPT_DIR}/load_and_recreate_app.sh" \
  "${REMOTE_HOST}:${REMOTE_DIR}/load_and_recreate_app.sh"

echo "步骤 3/3：远程加载镜像并强制重建 app"
ssh \
  -o "ControlPath=${CONTROL_PATH}" \
  "${REMOTE_HOST}" \
  "cd '${REMOTE_DIR}' && chmod +x ./load_and_recreate_app.sh && IMAGE_NAME='${IMAGE_NAME}' ./load_and_recreate_app.sh './${ARCHIVE_NAME}'"

echo "部署完成：${IMAGE_NAME}"
