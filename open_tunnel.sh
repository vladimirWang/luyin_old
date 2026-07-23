#!/bin/bash

nohup exec "/opt/natapp/natapp" -authtoken=f277cfdfcadea158 &

# powershell -c "irm https://natapp.cn/get.ps1?authtoken=f277cfdfcadea158 | iex"
