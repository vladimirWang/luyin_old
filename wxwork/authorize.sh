#!/bin/sh

ID='ww0854a981ec186692'
SECRET='GUhdefMvhFSFkLFGonbtLZIznv6x9OBxjfczoGdxTog'
REDIRECT_URI='http://localhost:4000/api/wechat/callback'

print_info() {
  echo "\033[36m[INFO]\033[0m $1"
}

print_success() {
  echo "\033[32m[SUCCESS]\033[0m $1"
}

print_error() {
  echo "\033[31m[ERROR]\033[0m $1"
}

get_access_token() {
  print_info "获取 access_token..."
  local resp=$(curl -sS "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=$ID&corpsecret=$SECRET")
  local token=$(echo "$resp" | jq -r .access_token)
  if [ "$token" = "null" ] || [ -z "$token" ]; then
    local errmsg=$(echo "$resp" | jq -r .errmsg)
    print_error "获取 access_token 失败: $errmsg"
    exit 1
  fi
  echo "$token"
}

show_qr_code() {
  local url="$1"
  print_info "生成二维码..."
  
  if command -v qrencode >/dev/null 2>&1; then
    local qr_img="$PWD/qr_code.png"
    qrencode -o "$qr_img" "$url"
    
    if command -v imgcat >/dev/null 2>&1; then
      imgcat "$qr_img"
    else
      print_info "请使用手机扫描下方链接:"
      echo ""
      echo "  $url"
      echo ""
      print_info "或打开图片文件: $qr_img"
    fi
  else
    print_info "请使用手机扫描下方链接:"
    echo ""
    echo "  $url"
    echo ""
    print_info "提示: 安装 qrencode 可生成二维码图片: brew install qrencode"
  fi
}

poll_callback() {
  local token="$1"
  print_info "等待用户扫码授权..."
  
  while true; do
    local resp=$(curl -sS "http://localhost:4000/api/wechat/callback_result")
    local code=$(echo "$resp" | jq -r .code)
    
    if [ "$code" != "null" ] && [ -n "$code" ] && [ "$code" != "waiting" ]; then
      print_success "用户已授权，获取到 code: $code"
      
      print_info "使用 code 获取用户信息..."
      local user_resp=$(curl -sS "https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=$token&code=$code")
      print_success "用户信息:"
      echo "$user_resp" | jq .
      break
    fi
    
    sleep 2
  done
}

main() {
  local token=$(get_access_token)
  print_success "获取 access_token 成功"
  
  local encoded_uri=$(echo "$REDIRECT_URI" | sed 's/[\/&]/\\&/g')
  encoded_uri=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$REDIRECT_URI'))")
  
  local auth_url="https://open.weixin.qq.com/connect/oauth2/authorize?appid=$ID&redirect_uri=$encoded_uri&response_type=code&scope=snsapi_base&state=wxwork_auth#wechat_redirect"
  
  print_info "授权链接: $auth_url"
  echo ""
  
  show_qr_code "$auth_url"
  
  echo ""
  print_info "请在微信中打开浏览器，扫描二维码或点击链接进行授权"
  echo ""
  
  poll_callback "$token"
}

main