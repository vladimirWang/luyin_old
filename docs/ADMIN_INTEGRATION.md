# 中台接入与数据库迁移

## 架构

手机端 Express 与中台 FastAPI 使用同一个 MySQL 数据库。核心业务数据只由 Prisma 访问，中台读取链路如下：

```text
adminClient -> /admin-api -> adminBackend -> /api/internal-admin -> server/Prisma -> MySQL
```

中台问答会话由 FastAPI 写入独立的 `admin_qa_sessions` 和 `admin_qa_messages`，不会复用手机端启动时会同步重写的 `recording_questions`。

## 上线前

1. 备份目标数据库，并先在数据库测试副本执行迁移。
2. 为 FastAPI 创建最小权限账号：允许读取连接状态，并只允许读写两张 `admin_qa_*` 表。
3. 为 Node 与 FastAPI 生成同一个高强度 `ADMIN_BACKEND_API_KEY`，不要提交到 Git。
4. 确认音频文件目录对手机端 Express 可读；中台通过 Express 流式读取音频。

## 数据库迁移

在 `server` 目录配置 `DATABASE_URL` 后执行：

```powershell
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

生产环境禁止使用 `prisma db push` 代替迁移。迁移文件只新增两张中台表，不修改手机端现有表和数据。

## 配置

手机端 `server/.env`：

```env
PORT=8787
DATABASE_URL=mysql://user:password@host:3306/database
ADMIN_BACKEND_API_KEY=replace-with-a-long-random-secret
```

中台 `adminBackend/.env`：

```env
PORT=8788
MYSQL_HOST=host
MYSQL_PORT=3306
MYSQL_USER=admin_service_user
MYSQL_PASSWORD=replace-me
MYSQL_DATABASE=database
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me
ADMIN_SESSION_SECRET=replace-with-another-random-secret
ADMIN_BACKEND_API_KEY=replace-with-the-same-gateway-secret
MOBILE_INTERNAL_API_URL=http://127.0.0.1:8787/api/internal-admin
LLM_PROVIDER=deepseek
LLM_API_URL=https://api.deepseek.com/chat/completions
LLM_API_KEY=replace-me
LLM_MODEL=replace-with-enabled-model
FRONTEND_DIST_DIR=../adminClient/dist
AUTO_CREATE_ADMIN_SCHEMA=false
```

## 构建与启动

```powershell
cd adminClient
npm install
npm run test
npm run build

cd ../adminBackend
python -m pip install -r requirements.txt
python -m unittest discover -s backend/tests -v
python -m uvicorn main:app --host 0.0.0.0 --port 8788
```

生产反向代理应将 `/api/*` 转发到 `8787`，将 `/admin-api/*` 和中台静态页面转发到 `8788`。

## 验收

1. 手机端新录音后，中台列表能看到同一录音、成员、部门和项目分类。
2. 中台按今天、昨天、项目、成员提问时，命中的录音范围正确。
3. 中台问答可创建、智能命名、归档、恢复和删除，不影响手机端问答记录。
4. 音频播放和转写文本均通过中台页面正常访问。
5. 服务日志和浏览器响应中不出现数据库密码、LLM 密钥或网关密钥。
