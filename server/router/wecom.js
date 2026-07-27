import express from "express";
import crypto from "node:crypto";
import logger from "../utils/log.js";
import {
  getWecomUserByCode,
  hasWecomConfig,
  getWecomConfig,
  getWecomDepartmentIds,
  getWecomDepartmentMembers,
  requestWecomIdentity,
  signWecomIdentity,
} from "../utils/wecom.js";

const router = express.Router();
const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);

function normalizeRedirectUri(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

router.get("/login-config", (request, response) => {
  const config = getWecomConfig();
  const redirectUri = normalizeRedirectUri(config.redirectUri);
  response.json({
    configured: Boolean(config.appid && config.agentid && config.corpSecret && redirectUri),
    appid: config.appid || "",
    agentid: config.agentid || "",
    redirectUri,
  });
});

router.get("/oauth-url", (request, response) => {
  const config = getWecomConfig();
  if (!config.appid || !config.corpSecret) {
    response.json({ configured: false });
    return;
  }

  const redirect = normalizeRedirectUri(config.redirectUri || request.query.redirect);
  if (!redirect) {
    response.status(500).json({ configured: false, error: "企业微信回调地址必须是无 # 片段的 HTTPS URL" });
    return;
  }
  const requestedState = String(request.query.state || "").trim();
  const state = /^[A-Za-z0-9._~-]{8,200}$/.test(requestedState) ? requestedState : "wecom_recorder";
  const url =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(config.appid)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}` +
    (config.agentid ? `&agentid=${encodeURIComponent(config.agentid)}` : "") +
    "#wechat_redirect";
  response.json({ configured: true, url });
});

router.get("/me", async (request, response, next) => {
  logger.info("request /wecom/me", { message: "start" });
  try {
    const code = String(request.query.code || "").trim();
    if (!code || !hasWecomConfig()) {
      logger.info("request /wecom/me", {message: `code or hasWecomConfig not existed`})
      response.json({ configured: hasWecomConfig(), authenticated: false, user: null });
      return;
    }
    logger.info("request /wecom/me", {message: `start get user by code`})
    const user = await getWecomUserByCode(code);
    if (!user?.userId || !user?.name) {
      response.json({ configured: true, authenticated: false, user: null });
      return;
    }
    const appUser = await prisma.appUser.upsert({
      where: { wecomUserId: user.userId },
      create: {
        id: crypto.randomUUID(),
        wecomUserId: user.userId,
        name: user.name,
        company: "企业微信",
        department: user.department || "",
      },
      update: {
        name: user.name,
        department: user.department || "",
      },
    });
    const session = signWecomIdentity({
      appUserId: appUser.id,
      wecomUserId: user.userId,
      name: user.name,
    });
    if (!session) {
      response.status(500).json({ configured: true, authenticated: false, user: null, error: "企业微信身份凭证生成失败" });
      return;
    }
    response.json({
      configured: true,
      authenticated: true,
      user: {
        ...user,
        appUserId: appUser.id,
        authToken: session.token,
        authExpiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/department-members", async (request, response, next) => {
  const identity = requestWecomIdentity(request);
  logger.info("[call] getWecomDepartmentMembersRoute step 0", {
    message: "department member demo request received",
    hasIdentity: Boolean(identity),
  });
  try {
    if (!identity) {
      logger.warn("[call] getWecomDepartmentMembersRoute step 1", {
        message: "department member demo request rejected",
        reason: "missing_wecom_identity",
      });
      response.status(401).json({ error: "企业微信身份已失效，请重新登录" });
      return;
    }

    const departmentId = Number(request.query.department_id);
    const fetchChild = String(request.query.fetch_child || "0") === "1";
    const userlist = await getWecomDepartmentMembers(departmentId, fetchChild);
    logger.info("[call] getWecomDepartmentMembersRoute step 2", {
      message: "department member demo response prepared",
      departmentId,
      fetchChild,
      memberCount: userlist.length,
    });
    response.json({
      errcode: 0,
      errmsg: "ok",
      department_id: departmentId,
      fetch_child: fetchChild ? 1 : 0,
      userlist,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/departments", async (request, response, next) => {
  const identity = requestWecomIdentity(request);
  logger.info("[call] getWecomDepartmentsRoute step 0", {
    message: "department ID demo request received",
    hasIdentity: Boolean(identity),
  });
  try {
    if (!identity) {
      logger.warn("[call] getWecomDepartmentsRoute step 1", {
        message: "department ID demo request rejected",
        reason: "missing_wecom_identity",
      });
      response.status(401).json({ error: "企业微信身份已失效，请重新登录" });
      return;
    }

    const parentDepartmentId = String(request.query.id || "").trim();
    const departmentIds = await getWecomDepartmentIds(parentDepartmentId);
    logger.info("[call] getWecomDepartmentsRoute step 2", {
      message: "department ID demo response prepared",
      hasParentDepartmentId: Boolean(parentDepartmentId),
      departmentCount: departmentIds.length,
    });
    response.json({
      errcode: 0,
      errmsg: "ok",
      department_id: departmentIds,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
