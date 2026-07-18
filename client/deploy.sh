#!/bin/bash
set -euo pipefail

progress_bar() {
    local current=$1
    local total=$2
    local bar_width=40
    if [ "$total" -eq 0 ]; then
        percent=0
    else
        percent=$(awk -v c="$current" -v t="$total" 'BEGIN{printf "%.2f", c/t*100}')
    fi
    fill=$(awk -v p="$percent" -v w="$bar_width" 'BEGIN{print int(p / 100 * w)}')
    empty=$(( bar_width - fill ))
    bar=$(printf "%0.s#" $(seq 1 $fill))
    space=$(printf "%0.s-" $(seq 1 $empty))
    curr_mb=$(awk -v x="$current" 'BEGIN{printf "%.2f", x/1024/1024}')
    tot_mb=$(awk -v x="$total" 'BEGIN{printf "%.2f", x/1024/1024}')
    printf "\r[%-${bar_width}s] %s%%  %sMB / %sMB" "$bar$space" "$percent" "$curr_mb" "$tot_mb"
}

echo "==== Vite打包+压缩ZIP+单文件上传（平滑进度）===="
# read -p "服务器IP: " SERVER_IP
read -p "SSH用户名: " SSH_USER
# read -p "远程目录: " REMOTE_DIR
SERVER_IP=139.224.68.145
REMOTE_DIR="luyin_old/client"
LOCAL_DIST="./dist"
ZIP_NAME="dist.zip"
ZIP_TMP="./$ZIP_NAME"
SSH_CONTROL_DIR=$(mktemp -d /tmp/luyin-ssh.XXXXXX)
SSH_CONTROL_SOCKET="$SSH_CONTROL_DIR/control"

cleanup_ssh_connection() {
    ssh -S "$SSH_CONTROL_SOCKET" -O exit "$SSH_USER@$SERVER_IP" >/dev/null 2>&1 </dev/null || true
    rmdir "$SSH_CONTROL_DIR" >/dev/null 2>&1 || true
}
trap cleanup_ssh_connection EXIT

echo "请在下面的 SSH 提示中输入一次密码："
ssh -M -S "$SSH_CONTROL_SOCKET" -o ControlPersist=600 -o ServerAliveInterval=30 -Nf "$SSH_USER@$SERVER_IP"

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
ssh -S "$SSH_CONTROL_SOCKET" "$SSH_USER@$SERVER_IP" "mkdir -p \"$REMOTE_DIR\""
rsync -e "ssh -S $SSH_CONTROL_SOCKET" --progress "$ZIP_TMP" "$SSH_USER@$SERVER_IP:$REMOTE_DIR/" 2>&1 | tr '\r' '\n' | while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*([0-9][0-9,]*) ]]; then
        byte=${BASH_REMATCH[1]//,/}
        [[ "$byte" =~ ^[0-9]+$ ]] && progress_bar "$byte" "$TOTAL_SIZE"
    fi
done

# 5.远程自动解压+清理压缩包
echo -e "\n正在远程解压并清理zip文件..."
ssh -S "$SSH_CONTROL_SOCKET" "$SSH_USER@$SERVER_IP" "cd \"$REMOTE_DIR\" && unzip -q -o \"$ZIP_NAME\" && rm -f \"$ZIP_NAME\""

# 6.本地删除临时压缩包
rm -f "$ZIP_TMP"
echo "✅ 部署全部完成"
