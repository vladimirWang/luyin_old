import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import logger from "./log.js";
import { normalizeTencentMeetingEncryptedData, tencentMeetingDecryptData } from "./tencentMeetingCrypto.mjs";
import { firstEnv, parseJsonObject, splitEnvList } from "./common.mjs";
import { decodedTencentMeetingAesKeyLength } from "./algo.js";
import { projectRoot } from "../config.js";

let stsTokenRequestInFlight = null;
const stsTokenCache = { loaded: false, value: "", expiresAt: 0, reqId: "" };
const stsTokenPath = path.join(projectRoot, "storage", "tencent-meeting-sts-token.json");

export async function requestTencentMeetingStsTokenIfNeeded() {
  const operatorId = process.env.TENCENT_MEETING_STS_OPERATOR_ID
  if (!operatorId) {
    return { requested: false, reason: "missing_operator_id" };
  }
  if (stsTokenRequestInFlight) return stsTokenRequestInFlight;

  stsTokenRequestInFlight = (async () => {
    // const validTime = Number(firstEnv("TENCENT_MEETING_STS_VALID_TIME_HOURS", "WEMEET_STS_VALID_TIME_HOURS") || 24);
    const body = {
      operator_id: operatorId,
      operator_id_type: 1,
      // valid_time: [6, 12, 24].includes(validTime) ? validTime : 24,
      valid_time: 24
    };
    console.log("sts token request: ", JSON.stringify(body))
    try {
      await tencentMeetingApiRequest("POST", "/v1/app/sts-token", body, { skipStsToken: true });
      return { requested: true };
    } catch (error) {
      logger.warn("[Tencent Meeting] STS token request failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return { requested: false, reason: "request_failed" };
    } finally {
      stsTokenRequestInFlight = null;
    }
  })();

  return stsTokenRequestInFlight;
}

function tencentMeetingStsExpireMs(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 10_000_000_000 ? number : number * 1000;
}

export async function loadTencentMeetingStsToken() {
  const envToken = firstEnv("TENCENT_MEETING_STS_TOKEN", "WEMEET_STS_TOKEN");
  if (envToken) {
    const envExpiresAt = tencentMeetingStsExpireMs(firstEnv("TENCENT_MEETING_STS_EXPIRE_TS", "WEMEET_STS_EXPIRE_TS")) || Date.now() + 1000 * 60 * 30;
    return isTencentMeetingStsTokenFresh({ value: envToken, expiresAt: envExpiresAt }) ? envToken : "";
  }

  if (stsTokenCache.loaded) {
    return isTencentMeetingStsTokenFresh(stsTokenCache) ? stsTokenCache.value : "";
  }

  stsTokenCache.loaded = true;
  try {
    const raw = await readFile(stsTokenPath, "utf8");
    const parsed = parseJsonObject(raw) || {};
    stsTokenCache.value = String(parsed.value || parsed.sts_token || "");
    stsTokenCache.expiresAt = tencentMeetingStsExpireMs(parsed.expiresAt || parsed.expire_ts);
    stsTokenCache.reqId = String(parsed.reqId || parsed.req_id || "");
  } catch {
    stsTokenCache.value = "";
    stsTokenCache.expiresAt = 0;
    stsTokenCache.reqId = "";
  }
  return isTencentMeetingStsTokenFresh(stsTokenCache) ? stsTokenCache.value : "";
}

export async function saveTencentMeetingStsToken(tokenInfo = {}) {
  logger.debug("save sts token step2: ", {message: JSON.stringify(tokenInfo)})
  const value = String(tokenInfo.sts_token || tokenInfo.stsToken || tokenInfo.token || "").trim();
  if (!value) return false;
  const expiresAt = tencentMeetingStsExpireMs(tokenInfo.expire_ts || tokenInfo.expireTs || tokenInfo.expiresAt);
  const reqId = String(tokenInfo.req_id || tokenInfo.reqId || "").trim();
  const record = {
    value,
    expiresAt,
    reqId,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(stsTokenPath), { recursive: true });
  logger.debug("save sts token makedir success: ", {message: ''})
  await writeFile(stsTokenPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  logger.debug("save sts token save success: ", {message: ''})
  stsTokenCache.loaded = true;
  stsTokenCache.value = value;
  stsTokenCache.expiresAt = expiresAt;
  stsTokenCache.reqId = reqId;
  return true;
}

export function tencentMeetingApiConfig() {
  const secretId = firstEnv("TENCENT_MEETING_SECRET_ID", "WEMEET_SECRET_ID");
  const secretKey = firstEnv("TENCENT_MEETING_SECRET_KEY", "WEMEET_SECRET_KEY");
  const appId = firstEnv("TENCENT_MEETING_ENTERPRISE_ID", "WEMEET_ENTERPRISE_ID", "TENCENT_MEETING_APP_ID", "WEMEET_APP_ID");
  const sdkId = firstEnv("TENCENT_MEETING_SDK_ID", "TENCENT_MEETING_APPLICATION_ID", "WEMEET_SDK_ID", "WEMEET_APPLICATION_ID");
  return {
    baseUrl: firstEnv("TENCENT_MEETING_API_BASE_URL", "WEMEET_API_BASE_URL") || "https://api.meeting.qq.com",
    secretId,
    secretKey,
    appId,
    sdkId,
  };
}

export async function tencentMeetingApiHeaders(method, uri, bodyText = "", options = {}) {
  const config = tencentMeetingApiConfig();
  if (!config.secretId || !config.secretKey || !config.appId) {
    throw new Error("Tencent Meeting API is not configured.");
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = String(crypto.randomInt(100000, 2147483647));
  const headerString = `X-TC-Key=${config.secretId}&X-TC-Nonce=${nonce}&X-TC-Timestamp=${timestamp}`;
  const stringToSign = [String(method || "GET").toUpperCase(), headerString, uri, bodyText].join("\n");
  const hexDigest = crypto.createHmac("sha256", config.secretKey).update(stringToSign).digest("hex");
  const signature = Buffer.from(hexDigest, "utf8").toString("base64");
  const headers = {
    "Content-Type": "application/json",
    "X-TC-Key": config.secretId,
    "X-TC-Timestamp": timestamp,
    "X-TC-Nonce": nonce,
    "X-TC-Signature": signature,
    "X-TC-Registered": firstEnv("TENCENT_MEETING_REGISTERED", "WEMEET_REGISTERED") || "1",
    AppId: config.appId,
  };
  const sendSdkId = firstEnv("TENCENT_MEETING_SEND_SDK_ID", "WEMEET_SEND_SDK_ID");
  if (config.sdkId && sendSdkId !== "false") headers.SdkId = config.sdkId;
  if (!options.skipStsToken) {
    const stsToken = await loadTencentMeetingStsToken();
    if (stsToken) headers["STS-Token"] = stsToken;
  }
  return headers;
}

export async function tencentMeetingApiRequest(method, uri, body = null, options = {}) {
  const config = tencentMeetingApiConfig();
  const bodyText = body ? JSON.stringify(body) : "";
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${uri}`, {
    method,
    headers: await tencentMeetingApiHeaders(method, uri, bodyText, options),
    body: bodyText || undefined,
    signal: AbortSignal.timeout(Math.max(5000, Number(process.env.TENCENT_MEETING_API_TIMEOUT_MS || 30000))),
  });
  const text = await response.text();
  const payload = parseJsonObject(text) || { raw: text };
  const apiError = payload?.error_info || payload?.errorInfo || payload?.error;
  const apiErrorCode = apiError?.new_error_code || apiError?.error_code || apiError?.code || payload?.code;
  if (!response.ok || apiErrorCode) {
    const message = apiError?.message || apiError?.msg || payload?.message || text || response.statusText;
    throw new Error(`Tencent Meeting API ${method} ${uri} failed: ${response.status} ${apiErrorCode || ""} ${String(message).slice(0, 160)}`.trim());
  }
  return payload;
}

export function expandTencentMeetingKeyCandidates(keys) {
  const output = [];
  const seen = new Set();
  const add = (value) => {
    const key = String(value || "").trim();
    if (!key || seen.has(key) || decodedTencentMeetingAesKeyLength(key) !== 32) return;
    seen.add(key);
    output.push(key);
  };

  for (const original of keys) {
    const key = String(original || "").trim();
    add(key);
    let variants = [""];
    for (const char of key) {
      const alternatives = ["I", "l", "L"].includes(char) ? ["I", "l", "L"] : [char];
      const next = [];
      for (const variant of variants) {
        for (const alternative of alternatives) {
          next.push(`${variant}${alternative}`);
        }
      }
      variants = [...new Set(next)].slice(0, 512);
    }
    variants.forEach(add);
  }

  return output.slice(0, 512);
}

// 说明：对外部输入或模型输出做规整与安全清理。
function safeEqualText(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

// 说明：处理腾讯会议集成中的 tencentMeetingSignature 逻辑。
function tencentMeetingSignature(token, timestamp, nonce, data) {
  return [token, timestamp, nonce, data]
    .map((value) => String(value || ""))
    .sort()
    .join("");
}

// 说明：处理腾讯会议集成中的 tencentMeetingCallbackSignature 逻辑。
function tencentMeetingCallbackSignature(token, timestamp, nonce, data) {
  return crypto.createHash("sha1").update(tencentMeetingSignature(token, timestamp, nonce, data)).digest("hex");
}

// 说明：校验腾讯会议 webhook 签名并解密密文，只接受可信回调。
export function tencentMeetingVerifiedPlaintext(request, encryptedData) {
  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: encryptedData})
  const config = tencentMeetingWebhookConfig();
  if (!config.tokens.length || !config.encodingAesKeys.length) {
    const error = new Error("Tencent Meeting webhook is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const timestamp = String(request.get("timestamp") || request.get("Timestamp") || "").trim();
  const nonce = String(request.get("nonce") || request.get("Nonce") || "").trim();
  const signature = String(request.get("signature") || request.get("Signature") || "").trim();
  const data = normalizeTencentMeetingEncryptedData(encryptedData);
  if (!timestamp || !nonce || !signature || !data) {
    logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: "timestamp || nonce || signature || data 其中之一不存在"})
    const error = new Error("Tencent Meeting callback is missing signature headers or data.");
    error.statusCode = 400;
    throw error;
  }

  const verified = config.tokens.some((token) => {
    const expected = tencentMeetingCallbackSignature(token, timestamp, nonce, data);
    return safeEqualText(signature, expected);
  });
  if (!verified) {
  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: "webhook签名验证未通过， signature和本地token算出的签名未对上"})
    const error = new Error("Tencent Meeting callback signature verification failed.");
    error.statusCode = 401;
    throw error;
  }

  const decryptErrors = [];
  for (const encodingAesKey of config.encodingAesKeys) {
    try {
      return tencentMeetingDecryptData(data, encodingAesKey);
    } catch (error) {
  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: error.message})
      decryptErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: "AES 解密失败"})
  const error = new Error(`Tencent Meeting callback AES decrypt failed for ${config.encodingAesKeys.length} candidate key(s).`);
  error.statusCode = 400;
  error.cause = decryptErrors[0] || "";
  throw error;
}

// 说明：处理账号、客户端身份或资料相关逻辑。
export function isTencentMeetingStsTokenFresh(token) {
  const isFresh = Boolean(token?.value && token.expiresAt && token.expiresAt > Date.now() + 1000 * 60 * 3);
  logger.info("[CALL] isTencentMeetingStsTokenFresh ", {message: `token: ${JSON.stringify(token).slice(0, 50)}, isFresh: ${isFresh}`})
  return isFresh
}

// 说明：处理腾讯会议集成中的 tencentMeetingWebhookConfig 逻辑。
export function tencentMeetingWebhookConfig() {
  const tokens = [
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_TOKEN),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_TOKEN),
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_TOKENS),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_TOKENS),
  ].filter((token, index, list) => list.indexOf(token) === index);
  const encodingAesKeys = expandTencentMeetingKeyCandidates([
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_ENCODING_AES_KEY),
    ...splitEnvList(process.env.TENCENT_MEETING_ENCODING_AES_KEY),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_ENCODING_AES_KEY),
    ...splitEnvList(process.env.WEMEET_ENCODING_AES_KEY),
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_ENCODING_AES_KEYS),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_ENCODING_AES_KEYS),
  ]);

  return {
    token: tokens[0] || "",
    tokens,
    encodingAesKey: encodingAesKeys[0] || "",
    encodingAesKeys,
  };
}
