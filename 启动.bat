@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 正在安装程序依赖，请稍等...
  npm install
  if errorlevel 1 (
    echo 依赖安装失败，请确认已安装 Node.js。
    pause
    exit /b 1
  )
)
echo 正在启动企业微信录音 H5...
npm run start
pause
