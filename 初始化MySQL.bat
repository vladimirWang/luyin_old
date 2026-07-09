@echo off
chcp 65001 >nul
cd /d "%~dp0"
where mysql >nul 2>nul
if errorlevel 1 (
  echo 没有找到 mysql 命令，请先安装 MySQL 并把 mysql 加入系统 PATH。
  pause
  exit /b 1
)
echo 将使用 root 账号初始化 wecom_recorder 数据库和账号。
echo 系统稍后会要求输入 MySQL root 密码。
mysql -u root -p < mysql-init.sql
pause
