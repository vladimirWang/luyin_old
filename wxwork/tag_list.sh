#!/bin/sh

source access_token.sh

get_token
if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN not set"
  echo "Run: \"\$(./access_token.sh)\""
  exit 1
fi
echo $TOKEN




resp=$(curl -sS -X POST "https://qyapi.weixin.qq.com/cgi-bin/tag/list?access_token=$TOKEN" | jq .taglist)

echo "User list success:"
echo $resp
