export function apiErrorMessage(error) {
  if (error?.code === "DATABASE_NOT_CONFIGURED") return "MySQL 未配置：请在服务器 .env 设置 MYSQL_HOST、MYSQL_USER 和 MYSQL_DATABASE，并确认数据库已创建后重启 FastAPI。";
  if (error?.code === "ADMIN_AUTH_NOT_CONFIGURED") return "管理员登录未配置：请在服务器 .env 设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256。";
  if (error?.code === "ADMIN_AUTH_REQUIRED") return "管理员登录已过期，请重新登录。";
  if (error?.code === "MOBILE_API_KEY_NOT_CONFIGURED") return "手机端 API Key 未配置：请在服务器 .env 设置 MOBILE_API_KEY。";
  if (error?.code === "SHARED_API_AUTH_REQUIRED") return "请登录管理员账号，或让手机端请求携带有效的 X-Mobile-Api-Key。";
  return error?.message || "请求失败";
}

export function isAdminAuthError(error) {
  return error?.code === "ADMIN_AUTH_REQUIRED";
}

export function isAdminAuthConfigError(error) {
  return error?.code === "ADMIN_AUTH_NOT_CONFIGURED";
}
