import crypto from "node:crypto";
import logger from "./log.js";
import { normalizeTencentMeetingEncryptedData, tencentMeetingDecryptData } from "./tencentMeetingCrypto.mjs";
import { splitEnvList } from "./common.mjs";
import { decodedTencentMeetingAesKeyLength } from "./algo.js";

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
