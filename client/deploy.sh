#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

progress_bar() {
    local current=$1
    local total=$2
    local bar_width=40
    local percent fill empty bar space curr_mb tot_mb
    if [ "$total" -eq 0 ]; then
        percent=0
    else
        percent=$(awk -v c="$current" -v t="$total" 'BEGIN{printf "%.2f", c/t*100}')
    fi
    fill=$(awk -v p="$percent" -v w="$bar_width" 'BEGIN{print int(p / 100 * w)}')
    empty=$(( bar_width - fill ))
    printf -v bar '%*s' "$fill" ''
    bar=${bar// /#}
    printf -v space '%*s' "$empty" ''
    space=${space// /-}
    curr_mb=$(awk -v x="$current" 'BEGIN{printf "%.2f", x/1024/1024}')
    tot_mb=$(awk -v x="$total" 'BEGIN{printf "%.2f", x/1024/1024}')
    printf "\r[%-${bar_width}s] %s%%  %sMB / %sMB" "$bar$space" "$percent" "$curr_mb" "$tot_mb"
}

echo "==== Vite打包+压缩ZIP+单文件上传（平滑进度）===="
# read -p "服务器IP: " SERVER_IP
read -r -p "SSH用户名: " SSH_USER
# read -p "远程目录: " REMOTE_DIR
# SERVER_IP=139.224.68.145 # 阿里云
SERVER_IP=172.16.200.9 # hyp
REMOTE_DIR="luyin_old/client"
LOCAL_DIST="./dist"
ZIP_NAME="dist.zip"
ZIP_TMP="./$ZIP_NAME"

if [[ -z "$SSH_USER" || ! "$SSH_USER" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "SSH 用户名无效，只允许字母、数字、点、下划线和短横线。" >&2
    exit 1
fi

SSH_CONTROL_DIR=$(mktemp -d /tmp/luyin-ssh.XXXXXX)
SSH_CONTROL_SOCKET="$SSH_CONTROL_DIR/control"
SSH_TARGET="$SSH_USER@$SERVER_IP"
SSH_OPTIONS=(
    -o ControlMaster=auto
    -o ControlPersist=600
    -o "ControlPath=$SSH_CONTROL_SOCKET"
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
)

cleanup_ssh_connection() {
    if [ -S "$SSH_CONTROL_SOCKET" ]; then
        ssh -o "ControlPath=$SSH_CONTROL_SOCKET" -O exit "$SSH_TARGET" >/dev/null 2>&1 </dev/null || true
    fi
    rmdir "$SSH_CONTROL_DIR" >/dev/null 2>&1 || true
}
trap cleanup_ssh_connection EXIT

echo "正在建立 SSH 连接。若提示输入密码，输入过程不会显示字符，输入完成后按回车。"
if ! ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" true; then
    echo "SSH 认证失败。请检查用户名、密码、服务器地址以及服务器是否允许密码登录。" >&2
    exit 1
fi
if ! ssh -o "ControlPath=$SSH_CONTROL_SOCKET" -O check "$SSH_TARGET" >/dev/null 2>&1; then
    echo "SSH 已认证，但复用连接未建立。请检查本机 OpenSSH 的 ControlMaster 配置。" >&2
    exit 1
fi

# 1.vite打包
npm run build
[ ! -d "$LOCAL_DIST" ] && echo "dist不存在" && exit 1

# 2.压缩dist
echo "正在压缩dist目录为 $ZIP_TMP"
zip -r -q "$ZIP_TMP" "$LOCAL_DIST"

# 3.获取zip总大小
TOTAL_SIZE=$(wc -c < "$ZIP_TMP" | tr -d '[:space:]')
echo "压缩包总大小：$TOTAL_SIZE 字节"

# 4.上传zip单文件，进度连续
ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" "mkdir -p \"$REMOTE_DIR\""
rsync -e "ssh -o ControlMaster=auto -o ControlPersist=600 -o ControlPath=$SSH_CONTROL_SOCKET -o ServerAliveInterval=30 -o ServerAliveCountMax=3" --progress "$ZIP_TMP" "$SSH_TARGET:$REMOTE_DIR/" 2>&1 | tr '\r' '\n' | while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*([0-9][0-9,]*) ]]; then
        byte=${BASH_REMATCH[1]//,/}
        [[ "$byte" =~ ^[0-9]+$ ]] && progress_bar "$byte" "$TOTAL_SIZE"
    fi
done

# 5.远程自动解压+清理压缩包
echo -e "\n正在远程解压并清理zip文件..."
ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" "cd \"$REMOTE_DIR\" && unzip -q -o \"$ZIP_NAME\" && rm -f \"$ZIP_NAME\""

# 6.本地删除临时压缩包
rm -f "$ZIP_TMP"
echo "✅ 部署全部完成"
