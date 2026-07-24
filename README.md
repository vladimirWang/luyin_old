# 企业微信录音平台

本仓库同时承载手机端录音服务和中台管理端，二者共用一套 MySQL 数据库。

## 目录

- `client/`：手机端前端。
- `server/`：手机端 Express 服务及 Prisma 数据层，拥有录音、转写、成员和项目分类等核心表。
- `adminClient/`：React 中台前端。
- `adminBackend/`：FastAPI 中台服务，只写入中台问答会话表。

## 服务端口

- 手机端 Express：`8787`
- 中台 FastAPI：`8788`
- 中台 Vite 开发服务器：`5173`

中台浏览器接口使用 `/admin-api/*`，手机端继续使用 `/api/*`，不会发生路由冲突。

## 数据边界

录音、转写、成员、部门和项目分类由 `server` 中的 Prisma 数据层统一读写。中台通过密钥保护的 `/api/internal-admin/*` 获取这些数据，不直接修改核心表。

中台只直接写入：

- `admin_qa_sessions`
- `admin_qa_messages`

详细部署和数据库迁移步骤见 [`docs/ADMIN_INTEGRATION.md`](docs/ADMIN_INTEGRATION.md)。
