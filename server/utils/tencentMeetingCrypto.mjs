
// 说明：对外部输入或模型输出做规整与安全清理。
export function normalizeTencentMeetingEncryptedData(value) {
  return String(value || "").trim().replace(/ /g, "+");
}

// 说明：处理腾讯会议集成中的 tencentMeetingDecryptData 逻辑。
export function tencentMeetingDecryptData(encryptedText, encodingAesKey) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("Tencent Meeting EncodingAESKey must decode to 32 bytes.");
  const iv = key.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(encryptedText || ""), "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}