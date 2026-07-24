import { useRef } from "react";
import { Keyboard, Mic, Plus, Send } from "lucide-react";
import {
  ComposerAttachmentChips,
  ComposerAttachmentMenu,
} from "./QuestionComposerParts.jsx";

export function QuestionComposer({
  attachments,
  attachmentsOpen,
  composerMode,
  images,
  listening,
  question,
  rows,
  voiceBusy,
  onAddLocation,
  onAttachmentsOpenChange,
  onCameraImage,
  onComposerModeChange,
  onOpenAttachment,
  onPickAudio,
  onPickFile,
  onPickImages,
  onQuestionChange,
  onRemoveAttachment,
  onRemoveImage,
  onStartVoice,
  onStopVoice,
  onSubmit,
}) {
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const canSubmit = Boolean(question.trim() || images.length || attachments.length);

  return (
    <form className={attachmentsOpen ? "chat-dock attachments-open" : "chat-dock"} onSubmit={onSubmit}>
      <ComposerAttachmentChips
        images={images}
        attachments={attachments}
        onOpen={onOpenAttachment}
        onRemoveImage={onRemoveImage}
        onRemoveAttachment={onRemoveAttachment}
      />

      <div className="chat-input-row">
        <button
          type="button"
          className="chat-mode-button"
          aria-label={composerMode === "voice" ? "切换文字输入" : "切换语音输入"}
          onClick={() => onComposerModeChange(composerMode === "voice" ? "text" : "voice")}
        >
          {composerMode === "voice" ? <Keyboard size={20} /> : <Mic size={20} />}
        </button>

        {composerMode === "voice" ? (
          <button
            className={listening ? "hold-talk-button recording" : "hold-talk-button"}
            type="button"
            disabled={voiceBusy}
            onPointerDown={onStartVoice}
            onPointerUp={onStopVoice}
            onPointerCancel={onStopVoice}
            onPointerLeave={onStopVoice}
            onContextMenu={(event) => event.preventDefault()}
          >
            {listening ? (
              <span className="voice-input-wave" aria-hidden="true">
                {Array.from({ length: 9 }).map((_, index) => (
                  <i key={index} style={{ "--i": index }} />
                ))}
              </span>
            ) : null}
            <span>{voiceBusy ? "正在转文字..." : listening ? "松开转文字" : "按住说话"}</span>
          </button>
        ) : (
          <textarea
            value={question}
            rows={rows}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder=""
            aria-label="输入问题"
          />
        )}

        <button
          type="button"
          className={attachmentsOpen ? "chat-plus-button active" : "chat-plus-button"}
          aria-label={attachmentsOpen ? "收起上传菜单" : "添加内容"}
          onClick={() => onAttachmentsOpenChange(!attachmentsOpen)}
        >
          <Plus size={22} />
        </button>

        {composerMode === "text" ? (
          <button className="chat-send-button" type="submit" aria-label="发送问题" disabled={!canSubmit}>
            <Send size={19} />
          </button>
        ) : null}
      </div>

      {attachmentsOpen ? (
        <ComposerAttachmentMenu
          onPickImages={() => imageInputRef.current?.click()}
          onTakePhoto={() => cameraInputRef.current?.click()}
          onPickAudio={() => audioInputRef.current?.click()}
          onPickFile={() => fileInputRef.current?.click()}
          onAddLocation={onAddLocation}
        />
      ) : null}

      <input ref={imageInputRef} className="upload-input" type="file" accept="image/*" multiple onChange={onPickImages} />
      <input ref={cameraInputRef} className="upload-input" type="file" accept="image/*" capture="environment" onChange={onCameraImage} />
      <input ref={audioInputRef} className="upload-input" type="file" accept="audio/*,.mp3,.m4a,.wav,.webm,.aac" onChange={onPickAudio} />
      <input ref={fileInputRef} className="upload-input" type="file" accept=".txt,.md,.csv,.json,.log,text/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={onPickFile} />
    </form>
  );
}
