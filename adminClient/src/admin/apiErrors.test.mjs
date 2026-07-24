import assert from "node:assert/strict";
import test from "node:test";

import { apiErrorMessage, isAdminAuthConfigError, isAdminAuthError } from "./apiErrors.js";

test("apiErrorMessage explains missing MySQL configuration", () => {
  assert.equal(
    apiErrorMessage({ code: "DATABASE_NOT_CONFIGURED", message: "request failed" }),
    "MySQL 未配置：请在服务器 .env 设置 MYSQL_HOST、MYSQL_USER 和 MYSQL_DATABASE，并确认数据库已创建后重启 FastAPI。",
  );
});

test("apiErrorMessage explains missing admin authentication configuration", () => {
  assert.equal(
    apiErrorMessage({ code: "ADMIN_AUTH_NOT_CONFIGURED" }),
    "管理员登录未配置：请在服务器 .env 设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256。",
  );
});

test("apiErrorMessage falls back to server message", () => {
  assert.equal(apiErrorMessage(new Error("录音不存在")), "录音不存在");
  assert.equal(apiErrorMessage(null), "请求失败");
});

test("apiErrorMessage explains shared API access errors", () => {
  assert.equal(apiErrorMessage({ code: "ADMIN_AUTH_REQUIRED" }), "管理员登录已过期，请重新登录。");
  assert.equal(apiErrorMessage({ code: "MOBILE_API_KEY_NOT_CONFIGURED" }), "手机端 API Key 未配置：请在服务器 .env 设置 MOBILE_API_KEY。");
  assert.equal(apiErrorMessage({ code: "SHARED_API_AUTH_REQUIRED" }), "请登录管理员账号，或让手机端请求携带有效的 X-Mobile-Api-Key。");
});

test("admin auth helpers identify session and configuration errors", () => {
  assert.equal(isAdminAuthError({ code: "ADMIN_AUTH_REQUIRED" }), true);
  assert.equal(isAdminAuthError({ code: "SHARED_API_AUTH_REQUIRED" }), false);
  assert.equal(isAdminAuthConfigError({ code: "ADMIN_AUTH_NOT_CONFIGURED" }), true);
  assert.equal(isAdminAuthConfigError({ code: "ADMIN_AUTH_REQUIRED" }), false);
});
