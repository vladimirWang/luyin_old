#!/bin/sh

source access_token.sh

get_token
if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN not set"
  echo "Run: \"\$(./access_token.sh)\""
  exit 1
fi
echo $TOKEN




resp=$(curl -sS "https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=$TOKEN")

echo "User list success:"
echo $resp
