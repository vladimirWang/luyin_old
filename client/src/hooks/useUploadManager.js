import { useState } from "react";
import { api, showToast } from "../utils/index.js";

const LONG_RECORDING_DIRECT_UPLOAD_LIMIT = 80;
const LONG_RECORDING_UPLOAD_BATCH_SIZE = 48;

export function useUploadManager({ onRecordingCreated, onRefresh }) {
  const [uploadingRecords, setUploadingRecords] = useState([]);

  function createUploadCard({ name = "新录音", durationMs = 0, message = "正在上传服务器" } = {}) {
    const item = {
      id: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: new Date().toISOString(),
      durationMs,
      status: "uploading",
      message,
    };
    setUploadingRecords((current) => [item, ...current].slice(0, 6));
    return item.id;
  }

  function updateUploadCard(uploadId, patch) {
    if (!uploadId) return;
    setUploadingRecords((current) => current.map((item) => (item.id === uploadId ? { ...item, ...patch } : item)));
  }

  function failUploadCard(uploadId) {
    if (uploadId) setUploadingRecords((current) => current.filter((item) => item.id !== uploadId));
  }

  function finishUploadCard(uploadId, recording) {
    if (uploadId) setUploadingRecords((current) => current.filter((item) => item.id !== uploadId));
    if (recording && onRecordingCreated) {
      onRecordingCreated(recording);
    }
  }

  async function uploadRecordingSegments(segments, durationMs, options = {}) {
    const loadingMsg = options.uploadMessage || "正在上传录音并准备转写";
    const uploadId = options.uploadId || (options.showUploadCard === false || options.silent
      ? ""
      : createUploadCard({
          name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
          durationMs,
          message: loadingMsg,
        }));

    updateUploadCard(uploadId, {
      name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
      durationMs,
      message: loadingMsg,
    });

    let longUploadSessionId = "";
    try {
      let payload;
      console.log("segments.length", segments.length, "LONG_RECORDING_DIRECT_UPLOAD_LIMIT", LONG_RECORDING_DIRECT_UPLOAD_LIMIT);
      if (segments.length > LONG_RECORDING_DIRECT_UPLOAD_LIMIT) {
        const session = await api("/api/recording-upload-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
            durationMs,
            mimeType: segments[0]?.type || "audio/webm",
            folderId: options.folderId || null,
          }),
        });
        longUploadSessionId = session.sessionId || "";
        const batchSize = Math.max(1, Number(session.batchSize || LONG_RECORDING_UPLOAD_BATCH_SIZE));
        for (let start = 0; start < segments.length; start += batchSize) {
          const batch = segments.slice(start, start + batchSize);
          const batchForm = new FormData();
          batchForm.append("startIndex", String(start));
          batch.forEach((blob, index) => {
            batchForm.append("audio", blob, `recording-${Date.now()}-${start + index + 1}.webm`);
          });
          updateUploadCard(uploadId, {
            message: `正在后台上传 ${Math.min(start + batch.length, segments.length)}/${segments.length} 段`,
          });
          await api(`/api/recording-upload-sessions/${session.sessionId}/segments`, {
            method: "POST",
            body: batchForm,
          });
        }
        updateUploadCard(uploadId, { message: "正在合并录音并准备转写" });
        payload = await api(`/api/recording-upload-sessions/${session.sessionId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ durationMs }),
        });
      } else {
        console.log("uploading segments directly, segments.length:", `name: ${options.name}`, `fileName: ${options.fileName}`, `mimetype: ${segments[0]?.type}, folderId: ${options.folderId}`);
        const formData = new FormData();
        segments.forEach((blob, index) => {
          formData.append("audio", blob, options.fileName || `recording-${Date.now()}-${index + 1}.webm`);
        });
        formData.append("durationMs", String(durationMs));
        formData.append("mimeType", segments[0]?.type || "audio/webm");
        if (options.name) formData.append("name", options.name);
        if (options.folderId) formData.append("folderId", options.folderId);
        payload = await api("/api/recordings/segments", {
          method: "POST",
          body: formData,
        });
      }

      finishUploadCard(uploadId, payload.recording);
      if (options.toastMessage) {
        showToast(options.toastMessage);
      } else if (!options.silent) {
        showToast("录音已上传服务器，可在记录里查看");
      }
      if (onRefresh) {
        window.setTimeout(onRefresh, 2600);
      }
      return payload.recording;
    } catch (error) {
      if (longUploadSessionId) {
        api(`/api/recording-upload-sessions/${longUploadSessionId}`, { method: "DELETE" }).catch(() => {});
      }
      failUploadCard(uploadId);
      throw error;
    }
  }

  return {
    uploadingRecords,
    uploadBusy: uploadingRecords.length > 0,
    createUploadCard,
    updateUploadCard,
    failUploadCard,
    finishUploadCard,
    // uploadRecording,
    uploadRecordingSegments,
  };
}
