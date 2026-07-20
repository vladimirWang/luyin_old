import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../config.js";
import { decodeTencentMeetingEventData } from "../utils/algo.js";
import { splitEnvList } from "../utils/common.mjs";

const router = express.Router();
const encryptedDataFile = path.join(projectRoot, "tencentMeetingEncryptedData.txt");

function encodingAesKeys() {
  return [
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_ENCODING_AES_KEY),
    ...splitEnvList(process.env.TENCENT_MEETING_ENCODING_AES_KEY),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_ENCODING_AES_KEY),
    ...splitEnvList(process.env.WEMEET_ENCODING_AES_KEY),
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_ENCODING_AES_KEYS),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_ENCODING_AES_KEYS),
  ].filter((key, index, keys) => keys.indexOf(key) === index);
}

function decodeWithConfiguredKey(data) {
  const keys = encodingAesKeys();
  if (!keys.length) {
    const error = new Error("Tencent Meeting EncodingAESKey is not configured.");
    error.statusCode = 503;
    throw error;
  }

  for (const key of keys) {
    try {
      return decodeTencentMeetingEventData(data, key);
    } catch {
      // 多密钥轮换期间逐个尝试，最终统一返回安全的错误信息。
    }
  }

  const error = new Error("Tencent Meeting data could not be decrypted.");
  error.statusCode = 400;
  throw error;
}

router.get("/decode", async (req, response, next) => {
  try {
    const host = req.get('host');
    // 2. 协议 http / https
    const protocol = req.protocol;
    // 完整域名地址：https://xxx.com:3000
    const fullDomain = `${protocol}://${host}`;
    const filePath = path.join(projectRoot, "recording_completed1.txt");
    const data = await readFile(filePath, "utf8");
    response.json({ ok: true, data: decodeWithConfiguredKey(data), fullDomain });
  } catch (error) {
    next(error);
  }
});

router.post("/decode", (request, response, next) => {
  try {
    response.json({ ok: true, data: decodeWithConfiguredKey(request.body?.data) });
  } catch (error) {
    next(error);
  }
});

export default router;
