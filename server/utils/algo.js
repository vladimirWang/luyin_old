export function decodedTencentMeetingAesKeyLength(encodingAesKey) {
  try {
    return Buffer.from(`${encodingAesKey}=`, "base64").length;
  } catch {
    return 0;
  }
}
