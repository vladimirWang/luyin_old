import crypto from "node:crypto";

export function decodedTencentMeetingAesKeyLength(encodingAesKey) {
  try {
    return Buffer.from(`${encodingAesKey}=`, "base64").length;
  } catch {
    return 0;
  }
}

/**
 * 按腾讯会议事件加解密规范解密 data，并将明文解析为 JSON。
 */
export function decodeTencentMeetingEventData(encryptedData, encodingAesKey) {
  const data = String(encryptedData || "").trim().replace(/ /g, "+");
  if (!data) throw new Error("Tencent Meeting encrypted data is required.");

  const key = Buffer.from(`${String(encodingAesKey || "").trim()}=`, "base64");
  if (key.length !== 32) {
    throw new Error("Tencent Meeting EncodingAESKey must decode to 32 bytes.");
  }

  const ciphertext = Buffer.from(data, "base64");
  if (!ciphertext.length || ciphertext.length % 16 !== 0) {
    throw new Error("Tencent Meeting encrypted data is not valid AES ciphertext.");
  }

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  try {
    const decoded = JSON.parse(plaintext);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
    return decoded;
  } catch {
    throw new Error("Tencent Meeting decrypted data is not a JSON object.");
  }
}
