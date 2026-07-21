import { useState } from "react";
import { KeyRound, Mic, UserRound, X } from "lucide-react";
import { api, formatDuration, showToast } from "../../utils/index.js";
import { useWecomAuthStore } from "../../stores/useWecomAuthStore.js";
import { WaveCanvas } from "./WaveCanvas.jsx";
import { useRecorder } from "./useRecorder.js";

export function RecorderView({ createUploadCard, uploadRecordingSegments }) {
  const [queriedUser, setQueriedUser] = useState(null);
  const [stsTokenRequesting, setStsTokenRequesting] = useState(false);
  const { elapsedMs, isRecording, level, recordingError, toggleRecording } = useRecorder({
    createUploadCard,
    uploadRecordingSegments,
  });
  const ringLevel = isRecording ? Math.max(0.04, Math.min(1, level)) : 0;



  return (
    <section className="screen recorder-screen" aria-label="录音">
      <div className="zustand-user-query">
        {/* <button
          className="zustand-user-query-button"
          type="button"
          onClick={() => setQueriedUser(useWecomAuthStore.getState().user || {})}
        >
          <UserRound size={16} />
          查询 Zustand 用户
        </button> */}
        {queriedUser ? (
          <div className="zustand-user-result" role="status">
            <button type="button" aria-label="关闭用户信息" onClick={() => setQueriedUser(null)}>
              <X size={15} />
            </button>
            <pre>{JSON.stringify(queriedUser, null, 2)}</pre>
          </div>
        ) : null}
      </div>
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
        <button className="record-button" type="button" onClick={toggleRecording} aria-label={isRecording ? "停止录音" : "开始录音"}>
          {isRecording ? <span className="end-label">结束</span> : <Mic className="mic-logo" size={56} strokeWidth={2.1} />}
        </button>
      </div>
    </section>
  );
}
