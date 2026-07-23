import { Camera, FileAudio, FileUp, ImagePlus, Link, X } from "lucide-react";

export function ComposerAttachmentChips({ images, attachments, onOpen, onRemoveImage, onRemoveAttachment }) {
  if (images.length === 0 && attachments.length === 0) return null;

  return (
    <div className="chat-attachment-chips">
      {images.map((item) => (
        <span key={item.id}>
          <button className="attachment-chip-main" type="button" onClick={() => onOpen(item, "image")}>
            <em>{item.name}</em>
          </button>
          <button type="button" aria-label="移除图片" onClick={() => onRemoveImage(item.id)}>
            <X size={13} />
          </button>
        </span>
      ))}
      {attachments.map((item) => (
        <span key={item.id}>
          <button className="attachment-chip-main" type="button" onClick={() => onOpen(item, item.kind || "file")}>
            <em>{item.name}</em>
          </button>
          <button type="button" aria-label="移除附件" onClick={() => onRemoveAttachment(item.id)}>
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ComposerAttachmentMenu({ onPickImages, onTakePhoto, onPickAudio, onPickFile, onAddLocation }) {
  return (
    <div className="chat-attach-panel" aria-label="添加内容">
      <button type="button" onClick={onPickImages}>
        <ImagePlus size={22} />
        图片
      </button>
      <button type="button" onClick={onTakePhoto}>
        <Camera size={22} />
        拍照
      </button>
      <button type="button" onClick={onPickAudio}>
        <FileAudio size={22} />
        录音
      </button>
      <button type="button" onClick={onPickFile}>
        <FileUp size={22} />
        文件
      </button>
      <button type="button" onClick={onAddLocation}>
        <Link size={22} />
        地址
      </button>
    </div>
  );
}
