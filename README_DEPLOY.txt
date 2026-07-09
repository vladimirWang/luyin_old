企业微信录音 H5 部署包

1. 本包已包含当前 .env 中的 API KEY 等配置，请不要公开传播这个压缩包。
2. 本包不包含之前上传过的录音、文字稿、附件、日志和本地 db.json。
3. 数据存储使用 MySQL。首次在新电脑使用时，请先安装 MySQL，再双击“初始化MySQL.bat”。
4. 初始化完成后，双击“启动.bat”即可启动程序。默认服务地址为 http://127.0.0.1:8787/。

目录说明：
- server/storage/accounts/：账号相关独立文件目录，便于后续管理头像等账号资产。
- server/storage/audio/：新电脑后续上传的 MP3 录音文件会放在这里。
- server/storage/transcripts/YYYY-MM-DD/：新电脑后续生成的录音文字稿会按日期分类保存。
- MySQL 表 transcript_segments、recording_questions、app_accounts、daily_meeting_briefs 会保存文字段落、问答、账号和每日简报数据。

默认 MySQL 配置：
- 数据库：wecom_recorder
- 用户名：wecom_recorder
- 密码：wecom_recorder
如需改成自己的 MySQL 账号，请修改 .env 里的 MYSQL_HOST、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE。
