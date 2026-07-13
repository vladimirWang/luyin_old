export function createUploadCard({ name = "新录音", durationMs = 0, message = "正在上传服务器" } = {}) {
    const item = {
      id: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: new Date().toISOString(),
      durationMs,
      status: "uploading",
      message,
    };
    return item;
  }
