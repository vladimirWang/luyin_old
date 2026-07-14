#!/bin/sh

ID='ww0854a981ec186692'
AGENT_ID='1000058'
SECRET='GUhdefMvhFSFkLFGonbtLZIznv6x9OBxjfczoGdxTog'

get_token() {
    echo "Getting access token..."

    TOKEN=$(curl -sS "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=$ID&corpsecret=$SECRET" | jq -r .access_token)

    echo "✅ 登录成功，token：$TOKEN"
    echo "----------------------------------------"

    export TOKEN
}
