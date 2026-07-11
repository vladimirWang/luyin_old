import { Mic } from "lucide-react";
import { formatDuration } from "./utils/index.js";
import { WaveCanvas } from "./WaveCanvas.jsx";

export function RecorderView({ elapsedMs, isRecording, level, recordingError, onToggleRecording }) {
  const ringLevel = isRecording ? Math.max(0.04, Math.min(1, level)) : 0;

  return (
    <section className="screen recorder-screen" aria-label="录音">
      <div className="wave-stage">
        <WaveCanvas active={isRecording} level={level} />
      </div>

      <div className="record-time">{formatDuration(elapsedMs, true)}</div>
      <div className="record-message-stack">
        {recordingError ? <div className="inline-alert">{recordingError}</div> : null}
      </div>

      <div className={isRecording ? "mic-zone recording" : "mic-zone"} style={{ "--level": ringLevel }}>
        <span className="pulse-ring ring-one" />
        <span className="pulse-ring ring-two" />
        <span className="pulse-ring ring-three" />
        <button className="record-button" type="button" onClick={onToggleRecording} aria-label={isRecording ? "停止录音" : "开始录音"}>
          {isRecording ? <span className="end-label">结束</span> : <Mic className="mic-logo" size={56} strokeWidth={2.1} />}
        </button>
      </div>
    </section>
  );
}
