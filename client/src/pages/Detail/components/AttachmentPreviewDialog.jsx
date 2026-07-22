import { X } from "lucide-react";
import { getClientId, getStoredAuth } from "../../../utils/index.js";

export function attachmentPreviewType(item = {}) {
  const kind = String(item.kind || item.previewType || "").toLowerCase();
  const type = String(item.type || "").toLowerCase();
  if (kind === "image" || type.startsWith("image/") || item.dataUrl?.startsWith("data:image/")) return "image";
  if (kind === "audio" || type.startsWith("audio/") || item.dataUrl?.startsWith("data:audio/")) return "audio";
  if (kind === "location") return "location";
  return "file";
}

function authenticatedResourceUrl(url = "") {
  if (!url || /^data:/i.test(url)) return url;
  let parsed;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return url;
  }
  if (parsed.origin !== window.location.origin) return url;
  if (!parsed.searchParams.get("clientId")) parsed.searchParams.set("clientId", getClientId());
  const auth = getStoredAuth();
  if (auth?.token && !parsed.searchParams.get("authToken")) parsed.searchParams.set("authToken", auth.token);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function attachmentPreviewUrl(item = {}) {
  return item.dataUrl || authenticatedResourceUrl(item.url || "");
}

export function AttachmentPreviewDialog({ attachment, onClose }) {
  if (!attachment) return null;
  const previewType = attachmentPreviewType(attachment);
  const previewUrl = attachmentPreviewUrl(attachment);
  const typeLabel = previewType === "image" ? "图片" : previewType === "location" ? "地址" : previewType === "audio" ? "录音" : "文件";

  return (
    <div className="attachment-preview-layer" role="dialog" aria-modal="true" aria-label="附件预览" onClick={onClose}>
      <section className="attachment-preview-card" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{attachment.name || "附件"}</strong>
            <span>{typeLabel}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭附件预览">
            <X size={16} />
          </button>
        </header>
        {previewType === "image" && previewUrl ? (
          <img src={previewUrl} alt={attachment.name || "上传图片"} />
        ) : previewType === "audio" && previewUrl ? (
          <audio controls src={previewUrl} />
        ) : attachment.url ? (
          <a href={previewUrl} target="_blank" rel="noreferrer">
            打开附件：{attachment.name || attachment.url}
          </a>
        ) : attachment.text ? (
          <pre>{attachment.text}</pre>
        ) : attachment.dataUrl ? (
          <a href={attachment.dataUrl} target="_blank" rel="noreferrer" download={attachment.name || "attachment"}>
            打开附件：{attachment.name || "附件"}
          </a>
        ) : (
          <p>这个附件目前只有文件名信息，发送后会作为提问上下文的一部分；如需查看完整内容，请选择文本类文件或图片。</p>
        )}
      </section>
    </div>
  );
}
