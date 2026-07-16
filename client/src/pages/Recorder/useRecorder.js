import { useEffect, useRef, useState } from "react";
import {
  canRequestMicrophone,
  clearRecordingSessionManifest,
  formatDate,
  getSupportedMimeType,
  idbRequest,
  microphoneErrorMessage,
  normalizeRecordingSessionManifest,
  openRecordingRecoveryDb,
  readRecoverableRecordingManifests,
  readRecordingSessionManifest,
  removeRecordingRecoveryManifest,
  showToast,
  upsertRecordingRecoveryManifest,
  writeRecordingRecoveryQueue,
  writeRecordingSessionManifest,
} from "../../utils/index.js";
import { RECORDING_RECOVERY_STORE } from "../../constant.js";
import { requestMicrophoneStream } from "../../utils/audio.js";

const RECORDING_DATA_SLICE_MS = 60 * 1000;
const RECORDING_AUTOSAVE_CHUNK_MS = 5 * 60 * 1000;
const RECORDING_ROLLOVER_MS = 10 * 60 * 1000;
const RECORDING_WATCHDOG_MS = 5 * 1000;

async function putRecordingRecoverySegment(row) {
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECORDING_RECOVERY_STORE).put(row);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB write failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB write aborted"));
    });
  } finally {
    db.close();
  }
}

async function getRecordingRecoverySegment(id) {
  if (!id) return null;
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readonly");
    return (await idbRequest(transaction.objectStore(RECORDING_RECOVERY_STORE).get(id))) || null;
  } finally {
    db.close();
  }
}

async function deleteRecordingRecoverySegment(id) {
  if (!id) return;
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECORDING_RECOVERY_STORE).delete(id);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB delete failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB delete aborted"));
    });
  } finally {
    db.close();
  }
}

async function clearRecordingRecoverySession(sessionId) {
  const targetSessionId = sessionId || "";
  const manifests = targetSessionId ? readRecoverableRecordingManifests().filter((item) => item.id === targetSessionId) : readRecoverableRecordingManifests();
  const segmentIds = manifests
    .flatMap((manifest) => manifest.segments || [])
    .filter((segment) => !targetSessionId || segment.sessionId === targetSessionId)
    .map((segment) => segment.id)
    .filter(Boolean);
  await Promise.all(segmentIds.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  if (targetSessionId) removeRecordingRecoveryManifest(targetSessionId);
  else writeRecordingRecoveryQueue([]);
  clearRecordingSessionManifest(targetSessionId);
}

async function clearRecordingRecoveryManifest(manifest) {
  const segmentIds = (manifest?.segments || []).map((segment) => segment.id).filter(Boolean);
  await Promise.all(segmentIds.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  removeRecordingRecoveryManifest(manifest?.id);
  clearRecordingSessionManifest(manifest?.id);
}

async function requestPersistentRecordingStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Long recording still works without persistent storage.
  }
}

export function useRecorder({ createUploadCard, uploadRecordingSegments }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0.12);
  const [status, setStatus] = useState("点击麦克风开始");
  const [recordingError, setRecordingError] = useState("");
  const [resumeAvailable, setResumeAvailable] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const sessionSegmentsRef = useRef([]);
  const sessionDurationsRef = useRef([]);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRafRef = useRef(0);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const totalElapsedBeforeSegmentRef = useRef(0);
  const stopReasonRef = useRef("idle");
  const resumeTimerRef = useRef(0);
  const rolloverTimerRef = useRef(0);
  const autosaveTimerRef = useRef(0);
  const recordingWatchdogTimerRef = useRef(0);
  const resumeAvailableRef = useRef(false);
  const isRecordingRef = useRef(false);
  const manualStopRequestedRef = useRef(false);
  const finalizingRecordingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const autosavedSegmentCountRef = useRef(0);
  const autosavedDurationMsRef = useRef(0);
  const recordingSessionIdRef = useRef("");
  const recordingSessionStartedAtRef = useRef("");
  const recordingSessionPersistedIdsRef = useRef([]);
  const recordingPersistingRef = useRef(false);
  const recordingPersistPromiseRef = useRef(Promise.resolve());
  const recoveryUploadInFlightRef = useRef(false);
  const backgroundUploadSessionIdsRef = useRef(new Set());
  const stoppedRecordingSnapshotsRef = useRef(new WeakMap());
  const hiddenStartedAtRef = useRef(0);
  const lastRecorderDataAtRef = useRef(0);
  const lastRecorderWatchdogActionAtRef = useRef(0);


useEffect(() => {
  isRecordingRef.current = isRecording;
}, [isRecording]);

useEffect(() => {
  resumeAvailableRef.current = resumeAvailable;
}, [resumeAvailable]);

useEffect(() => {
  return () => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(resumeTimerRef.current);
    window.clearTimeout(rolloverTimerRef.current);
    window.clearTimeout(autosaveTimerRef.current);
    window.clearInterval(recordingWatchdogTimerRef.current);
    cancelAnimationFrame(analyserRafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    releaseRecordingWakeLock();
  };
}, []);

function cleanupCapture() {
  window.clearInterval(timerRef.current);
  window.clearTimeout(rolloverTimerRef.current);
  window.clearTimeout(autosaveTimerRef.current);
  window.clearInterval(recordingWatchdogTimerRef.current);
  recordingWatchdogTimerRef.current = 0;
  cancelAnimationFrame(analyserRafRef.current);
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  audioContextRef.current?.close();
  audioContextRef.current = null;
  setLevel(0.12);
}

async function requestRecordingWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState === "hidden") return;
  try {
    if (wakeLockRef.current && !wakeLockRef.current.released) return;
    const lock = await navigator.wakeLock.request("screen");
    wakeLockRef.current = lock;
    lock.addEventListener?.("release", () => {
      if (wakeLockRef.current === lock) wakeLockRef.current = null;
    });
  } catch {
    // Wake Lock is a best-effort mobile helper; recording still works without it.
  }
}

function releaseRecordingWakeLock() {
  try {
    wakeLockRef.current?.release?.();
  } catch {
    // Ignore unsupported or already released wake locks.
  }
  wakeLockRef.current = null;
}

useEffect(() => {
  const tryResume = () => {
    if (manualStopRequestedRef.current || !resumeAvailableRef.current || isRecordingRef.current || document.visibilityState === "hidden") return;
    requestRecordingWakeLock();
    scheduleResumeRecording();
  };

  const saveCurrentChunk = () => {
    const recorder = mediaRecorderRef.current;
    if (!isRecordingRef.current || !recorder) return;
    preserveCurrentChunk(recorder);
    window.setTimeout(() => {
      if (mediaRecorderRef.current !== recorder || stopReasonRef.current !== "recording") return;
      persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
    }, 180);
  };

  const keepSessionAlive = () => {
    if (isRecordingRef.current || resumeAvailableRef.current) requestRecordingWakeLock();
    tryResume();
  };

  const reconcileAfterBackground = (hiddenMs) => {
    const recorder = mediaRecorderRef.current;
    if (
      hiddenMs < 5000 ||
      manualStopRequestedRef.current ||
      !isRecordingRef.current ||
      !recorder ||
      recorder.state !== "recording" ||
      stopReasonRef.current !== "recording"
    ) {
      return;
    }

    setStatus("已返回前台，正在校验录音状态");
    preserveCurrentChunk(recorder);
    window.setTimeout(() => {
      if (
        manualStopRequestedRef.current ||
        mediaRecorderRef.current !== recorder ||
        recorder.state !== "recording" ||
        stopReasonRef.current !== "recording"
      ) {
        return;
      }
      const now = Date.now();
      const lastDataAt = lastRecorderDataAtRef.current || startedAtRef.current || now;
      if (now - lastDataAt > Math.max(RECORDING_DATA_SLICE_MS * 2, 120 * 1000)) {
        handleCaptureInterrupted("录音被系统暂停，已保存已录到的内容，恢复后会继续录音");
        return;
      }

      setStatus("录音中");
    }, 900);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      hiddenStartedAtRef.current = Date.now();
      saveCurrentChunk();
      return;
    }
    const hiddenMs = hiddenStartedAtRef.current ? Date.now() - hiddenStartedAtRef.current : 0;
    hiddenStartedAtRef.current = 0;
    keepSessionAlive();
    reconcileAfterBackground(hiddenMs);
  };

  const warnBeforeLeaving = (event) => {
    if (!isRecordingRef.current && !resumeAvailableRef.current) return;
    saveCurrentChunk();
    event.preventDefault();
    event.returnValue = "";
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", keepSessionAlive);
  window.addEventListener("pageshow", keepSessionAlive);
  window.addEventListener("pagehide", saveCurrentChunk);
  window.addEventListener("beforeunload", warnBeforeLeaving);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", keepSessionAlive);
    window.removeEventListener("pageshow", keepSessionAlive);
    window.removeEventListener("pagehide", saveCurrentChunk);
    window.removeEventListener("beforeunload", warnBeforeLeaving);
  };
}, []);

function startAnalyser(stream) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;

  const audioContext = new AudioContextCtor();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const data = new Uint8Array(analyser.frequencyBinCount);
  audioContext.createMediaStreamSource(stream).connect(analyser);
  audioContextRef.current = audioContext;

  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const normalized = (data[index] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / data.length);
    setLevel(Math.min(1, rms * 5.8));
    analyserRafRef.current = requestAnimationFrame(tick);
  };

  tick();
}

function ensureRecordingSessionManifest() {
  if (recordingSessionIdRef.current) {
    return {
      id: recordingSessionIdRef.current,
      startedAt: recordingSessionStartedAtRef.current || new Date().toISOString(),
    };
  }

  const existing = readRecordingSessionManifest();
  if (existing?.id && (existing.segments || []).length === 0) {
    recordingSessionIdRef.current = existing.id;
    recordingSessionStartedAtRef.current = existing.startedAt || existing.createdAt || new Date().toISOString();
    recordingSessionPersistedIdsRef.current = [];
    return existing;
  }

  const startedAt = new Date().toISOString();
  const session = {
    id: `recording-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt,
    createdAt: startedAt,
    clientId: getClientId(),
    clientName: getClientName(),
    segments: [],
  };
  recordingSessionIdRef.current = session.id;
  recordingSessionStartedAtRef.current = startedAt;
  recordingSessionPersistedIdsRef.current = [];
  writeRecordingSessionManifest(session);
  return session;
}

async function persistCurrentRecordingSegment(index, blob, durationMs, mimeType) {
  if (!blob?.size) return "";
  const session = ensureRecordingSessionManifest();
  const id = `${session.id}-${String(index + 1).padStart(4, "0")}`;
  const row = {
    id,
    sessionId: session.id,
    index,
    durationMs,
    size: blob.size,
    mimeType: mimeType || blob.type || "audio/webm",
    createdAt: new Date().toISOString(),
    blob,
  };
  await putRecordingRecoverySegment(row);

  const manifest = readRecordingSessionManifest() || session;
  const segments = (manifest.segments || []).filter((segment) => segment.id !== id);
  segments.push({
    id,
    sessionId: session.id,
    index,
    durationMs,
    size: blob.size,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
  });
  segments.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  writeRecordingSessionManifest({
    ...manifest,
    id: session.id,
    startedAt: session.startedAt || manifest.startedAt || recordingSessionStartedAtRef.current,
    clientId: manifest.clientId || getClientId(),
    clientName: manifest.clientName || getClientName(),
    updatedAt: new Date().toISOString(),
    segments,
  });
  return id;
}

async function appendRecordingSessionSegment(blob, durationMs, mimeType) {
  if (!blob?.size) return;
  const segmentIndex = sessionDurationsRef.current.length;
  sessionSegmentsRef.current.push(blob);
  sessionDurationsRef.current.push(durationMs);
  totalElapsedBeforeSegmentRef.current += durationMs;
  try {
    const persistedId = await persistCurrentRecordingSegment(segmentIndex, blob, durationMs, mimeType || blob.type || "audio/webm");
    if (persistedId) {
      recordingSessionPersistedIdsRef.current[segmentIndex] = persistedId;
      sessionSegmentsRef.current[segmentIndex] = null;
    }
  } catch {
    // Keep the in-memory blob if mobile persistent storage is unavailable.
  }
}

async function persistBufferedRecordingChunk(mimeType = "") {
  const task = recordingPersistPromiseRef.current
    .catch(() => {})
    .then(async () => {
      const chunks = chunksRef.current;
      if (chunks.length === 0) return;
      recordingPersistingRef.current = true;
      const chunksToPersist = chunks.slice();
      chunks.length = 0;
      try {
        const now = Date.now();
        const durationMs = Math.max(0, now - startedAtRef.current);
        startedAtRef.current = now;
        const blob = new Blob(chunksToPersist, { type: mimeType || "audio/webm" });
        await appendRecordingSessionSegment(blob, durationMs, mimeType || blob.type || "audio/webm");
      } finally {
        recordingPersistingRef.current = false;
      }
    });
  recordingPersistPromiseRef.current = task.catch(() => {});
  return task;
}

async function recordingSegmentsForRange(startIndex, endIndex = sessionDurationsRef.current.length) {
  const segments = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const memoryBlob = sessionSegmentsRef.current[index];
    if (memoryBlob?.size > 0) {
      segments.push(memoryBlob);
      continue;
    }

    const persistedId = recordingSessionPersistedIdsRef.current[index];
    if (!persistedId) continue;
    try {
      const row = await getRecordingRecoverySegment(persistedId);
      if (row?.blob?.size > 0) segments.push(row.blob);
    } catch(error) {
      console.error("call recordingSegmentsForRange failed: ", `persistedId: ${persistedId} err: ${error.message}`);
      // If persistent recovery is unavailable, skip missing chunks instead of blocking saved audio.
    }
  }
  return segments;
}

async function removePersistedSegmentRange(startIndex, endIndex = sessionDurationsRef.current.length) {
  const ids = recordingSessionPersistedIdsRef.current.slice(startIndex, endIndex).filter(Boolean);
  await Promise.all(ids.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));

  const manifest = readRecordingSessionManifest();
  if (!manifest?.id) return;
  const remaining = (manifest.segments || []).filter((segment) => Number(segment.index || 0) < startIndex || Number(segment.index || 0) >= endIndex);
  if (remaining.length === 0) {
    removeRecordingRecoveryManifest(manifest.id);
    clearRecordingSessionManifest(manifest.id);
    return;
  }
  writeRecordingSessionManifest({ ...manifest, segments: remaining, updatedAt: new Date().toISOString() });
}

async function clearCurrentRecordingRecovery() {
  const sessionId = recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "";
  if (!sessionId) return;
  await clearRecordingRecoverySession(sessionId);
}

async function recoverSingleRecordingManifest(manifestSnapshot) {
  const manifest = normalizeRecordingSessionManifest(manifestSnapshot);
  const manifestSegments = (manifest?.segments || []).slice().sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  if (!manifest?.id || manifestSegments.length === 0) return true;

  try {
    const rows = [];
    for (const segment of manifestSegments) {
      try {
        const row = await getRecordingRecoverySegment(segment.id);
        if (row?.blob?.size > 0) rows.push(row);
      } catch (err) {
        console.error("reverSignleRecordingManifest failed: ", err.message)
        // Continue with the segments that can still be recovered.
      }
    }

    if (rows.length === 0) {
      await clearRecordingRecoveryManifest(manifest);
      return true;
    }

    const durationMs = Math.max(1000, rows.reduce((total, row) => total + Math.max(0, Number(row.durationMs || 0)), 0));
    const startedAt = manifest.startedAt || rows[0]?.createdAt || new Date().toISOString();
    const uploadId = createUploadCard({
      name: `中断自动保存 ${formatDate(startedAt)}`,
      durationMs,
      message: "正在恢复上次中断前的录音",
    });
    console.log(`[call] recoverSingleRecordingManifest  rows.length: ${rows.length}`)
    const recording = await uploadRecordingSegments(
      rows.map((row) => row.blob),
      durationMs,
      {
        uploadId,
        name: `中断自动保存 ${formatDate(startedAt)}`,
        toastMessage: "上次中断前的录音已自动恢复上传",
      },
    );
    await clearRecordingRecoveryManifest(manifest);
    return true;
  } catch (error) {
    console.error("call recoverSingleRecordingManifest failed: "+ error.message)
    showToast(`调用 recoverSingleRecordingManifest failed: ${error.message}`, 4000);
    return false;
  }
}

// 恢复中断的录音
async function recoverInterruptedRecordingSession(manifestSnapshot = null) {
  if (recoveryUploadInFlightRef.current) return false;
  const manifests = manifestSnapshot ? [manifestSnapshot] : readRecoverableRecordingManifests();
  if (manifests.length === 0) return true;
  recoveryUploadInFlightRef.current = true;

  try {
    let ok = true;
    for (const manifest of manifests) {
      if (backgroundUploadSessionIdsRef.current.has(manifest.id)) continue;
      const recovered = await recoverSingleRecordingManifest(manifest);
      if (!recovered) ok = false;
    }
    return ok;
  } finally {
    recoveryUploadInFlightRef.current = false;
  }
}

useEffect(() => {
  requestPersistentRecordingStorage();
  recoverInterruptedRecordingSession().catch(() => {});
}, []);

function resetRecordingSession(options = {}) {
  const clearPersisted = Boolean(options.clearPersisted);
  const sessionId = recordingSessionIdRef.current;
  sessionSegmentsRef.current = [];
  sessionDurationsRef.current = [];
  totalElapsedBeforeSegmentRef.current = 0;
  autosavedSegmentCountRef.current = 0;
  autosavedDurationMsRef.current = 0;
  recordingSessionIdRef.current = "";
  recordingSessionStartedAtRef.current = "";
  recordingSessionPersistedIdsRef.current = [];
  if (clearPersisted && sessionId) clearRecordingRecoverySession(sessionId).catch(() => {});
  setResumeAvailable(false);
}

function preserveCurrentChunk(recorder) {
  try {
    if (recorder?.state === "recording") recorder.requestData();
  } catch {
    // Some mobile WebViews throw when the recorder is already being stopped.
  }
}

function durationForSegmentRange(startIndex, endIndex = sessionDurationsRef.current.length) {
  return sessionDurationsRef.current.slice(startIndex, endIndex).reduce((total, duration) => total + Math.max(0, duration || 0), 0);
}

// TODO 待删除多余方法
// function stoppedRecordingSnapshot() {
//   return {
//     sessionId: recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "",
//     startedAtMs: startedAtRef.current || Date.now(),
//     stoppedAtMs: Date.now(),
//     uploadStartIndex: Math.min(autosavedSegmentCountRef.current, sessionSegmentsRef.current.length),
//     sessionSegments: sessionSegmentsRef.current.slice(),
//     sessionDurations: sessionDurationsRef.current.slice(),
//     persistedIds: recordingSessionPersistedIdsRef.current.slice(),
//     chunks: chunksRef.current,
//     autosavedSegmentCount: autosavedSegmentCountRef.current,
//     autosavedDurationMs: autosavedDurationMsRef.current,
//   };
// }

// TODO 待删除多余方法
// function resetRecorderUiForNext(sessionId = "") {
//   resetRecordingSession();
//   releaseRecordingWakeLock();
//   setElapsedMs(0);
//   setIsRecording(false);
//   isRecordingRef.current = false;
//   setResumeAvailable(false);
//   resumeAvailableRef.current = false;
//   stopReasonRef.current = "idle";
//   manualStopRequestedRef.current = false;
//   finalizingRecordingRef.current = false;
//   setLevel(0.12);
//   setStatus("点击麦克风开始");
// }

async function clearRecordingRecoverySnapshot(snapshot) {
  const ids = (snapshot?.persistedIds || []).filter(Boolean);
  await Promise.all(ids.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  removeRecordingRecoveryManifest(snapshot?.sessionId);
  clearRecordingSessionManifest(snapshot?.sessionId);
}

async function recordingSegmentsForSnapshot(snapshot, startIndex, endIndex = snapshot.sessionDurations.length) {
  const segments = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const memoryBlob = snapshot.sessionSegments[index];
    if (memoryBlob?.size > 0) {
      segments.push(memoryBlob);
      continue;
    }

    const persistedId = snapshot.persistedIds[index];
    if (!persistedId) continue;
    try {
      const row = await getRecordingRecoverySegment(persistedId);
      if (row?.blob?.size > 0) segments.push(row.blob);
    } catch {
      // Keep uploading whatever segments are still available.
    }
  }
  return segments;
}

function durationForSnapshotRange(snapshot, startIndex, endIndex = snapshot.sessionDurations.length) {
  return snapshot.sessionDurations.slice(startIndex, endIndex).reduce((total, duration) => total + Math.max(0, duration || 0), 0);
}

async function uploadStoppedRecordingSnapshot(snapshot, mimeType = "audio/webm") {
  if (!snapshot) return;
  const finalChunks = Array.isArray(snapshot.chunks) ? snapshot.chunks.slice() : [];
  const sessionSegments = snapshot.sessionSegments.slice();
  const sessionDurations = snapshot.sessionDurations.slice();
  const persistedIds = snapshot.persistedIds.slice();
  if (finalChunks.length > 0) {
    const finalBlob = new Blob(finalChunks, { type: mimeType || finalChunks[0]?.type || "audio/webm" });
    const finalDurationMs = Math.max(0, (snapshot.stoppedAtMs || Date.now()) - (snapshot.startedAtMs || Date.now()));
    sessionSegments.push(finalBlob);
    sessionDurations.push(finalDurationMs);
    persistedIds.push("");
  }

  const uploadSnapshot = {
    ...snapshot,
    sessionSegments,
    sessionDurations,
    persistedIds,
  };
  const uploadStartIndex = Math.min(snapshot.uploadStartIndex || 0, sessionSegments.length);
  const segments = await recordingSegmentsForSnapshot(uploadSnapshot, uploadStartIndex);
  const durationMs = Math.max(1000, durationForSnapshotRange(uploadSnapshot, uploadStartIndex));
  const sessionId = snapshot.sessionId || "";

  if (segments.length === 0) {
    if (sessionId) await clearRecordingRecoverySession(sessionId).catch(() => {});
    if (uploadStartIndex > 0) showToast("中断前录音已自动保存");
    backgroundUploadSessionIdsRef.current.delete(sessionId);
    return;
  }

  let uploaded = false;
  try {
    await uploadRecordingSegments(segments, durationMs, { keepSelection: true });
    uploaded = true;
    setRecordingError("");
  } catch (error) {
    console.error("call uploadStoppedRecordingSnapshot: ", error.message)
    setRecordingError("");
    showToast(`调用 uploadStoppedRecordingSnapshot failed: ${error.message}`, 4000);
  } finally {
    if (uploaded) {
      await clearRecordingRecoverySnapshot(uploadSnapshot).catch(() => {});
    }
    if (sessionId) {
      backgroundUploadSessionIdsRef.current.delete(sessionId);
    }
  }
}

async function autoSaveInterruptedRecording() {
  const startIndex = autosavedSegmentCountRef.current;
  const endIndex = sessionSegmentsRef.current.length;
  const segments = await recordingSegmentsForRange(startIndex, endIndex);
  if (segments.length === 0) return;

  const durationMs = Math.max(1000, durationForSegmentRange(startIndex, endIndex));
  try {
    await uploadRecordingSegments(segments, durationMs, {
      name: `中断自动保存 ${formatDate(new Date().toISOString())}`,
      keepSelection: true,
      silent: true,
      toastMessage: "意外中断前的录音已自动保存",
    });
    await removePersistedSegmentRange(startIndex, endIndex);
    autosavedSegmentCountRef.current = endIndex;
    autosavedDurationMsRef.current += durationMs;
  } catch (error) {
    console.error('call recordingUploadErrorMessage failed: ', error.message)
    setRecordingError("");
    showToast(`调用 autoSaveInterruptedRecording failed: ${error.message}`, 4000);
  }
}

function rolloverRecorderSegment() {
  const recorder = mediaRecorderRef.current;
  if (!recorder || recorder.state !== "recording" || stopReasonRef.current !== "recording") return;
  stopReasonRef.current = "rollover";
  try {
    recorder.stop();
  } catch {
    stopReasonRef.current = "recording";
    scheduleResumeRecording();
  }
}

function scheduleRecorderRollover() {
  window.clearTimeout(rolloverTimerRef.current);
  rolloverTimerRef.current = window.setTimeout(rolloverRecorderSegment, RECORDING_ROLLOVER_MS);
}

function scheduleRecordingAutosave() {
  if (RECORDING_AUTOSAVE_CHUNK_MS <= 0) return;
  window.clearTimeout(autosaveTimerRef.current);
  autosaveTimerRef.current = window.setTimeout(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording" || stopReasonRef.current !== "recording") return;
    preserveCurrentChunk(recorder);
    window.setTimeout(() => {
      persistBufferedRecordingChunk(recorder.mimeType || "audio/webm")
        .catch(() => {})
        .finally(() => {
          if (recorder.state === "recording" && stopReasonRef.current === "recording") scheduleRecordingAutosave();
        });
    }, 120);
  }, RECORDING_AUTOSAVE_CHUNK_MS);
}

function stopRecordingWatchdog() {
  window.clearInterval(recordingWatchdogTimerRef.current);
  recordingWatchdogTimerRef.current = 0;
}

function scheduleRecordingWatchdog() {
  stopRecordingWatchdog();
  recordingWatchdogTimerRef.current = window.setInterval(() => {
    if (manualStopRequestedRef.current || stopReasonRef.current !== "recording") return;
    const recorder = mediaRecorderRef.current;

    if (!recorder) {
      if (isRecordingRef.current || resumeAvailableRef.current) {
        handleCaptureInterrupted("录音器被系统暂停，已保留当前片段并准备自动续录。");
      }
      return;
    }

    if (recorder.state === "paused") {
      try {
        recorder.resume();
        setStatus("录音已自动恢复，正在继续");
        return;
      } catch {
        handleCaptureInterrupted("录音被系统暂停，已保留当前片段并准备自动续录。");
        return;
      }
    }

    if (recorder.state === "inactive") {
      handleCaptureInterrupted("录音器意外停止，已保留当前片段并准备自动续录。");
      return;
    }

    const now = Date.now();
    const lastDataAt = lastRecorderDataAtRef.current || startedAtRef.current || now;
    const staleMs = now - lastDataAt;
    const staleThresholdMs = Math.max(RECORDING_DATA_SLICE_MS * 3, 90 * 1000);
    if (staleMs < staleThresholdMs || now - lastRecorderWatchdogActionAtRef.current < 30 * 1000) return;

    lastRecorderWatchdogActionAtRef.current = now;
    preserveCurrentChunk(recorder);
    window.setTimeout(() => {
      if (mediaRecorderRef.current !== recorder || stopReasonRef.current !== "recording") return;
      persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
    }, 160);
  }, RECORDING_WATCHDOG_MS);
}

function handleCaptureInterrupted(reason = "电话或系统声音占用了麦克风，已保留当前片段，返回页面后会自动续录。") {
  if (manualStopRequestedRef.current || stopReasonRef.current !== "recording") return;
  const recorder = mediaRecorderRef.current;
  stopReasonRef.current = "interrupted";
  setRecordingError(reason);
  setStatus("麦克风暂时被占用，等待自动续录");
  preserveCurrentChunk(recorder);
  try {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
  } catch {
    // Fall through to the recovery path below.
  }

  window.clearInterval(timerRef.current);
  cleanupCapture();
  mediaRecorderRef.current = null;
  setIsRecording(false);
  isRecordingRef.current = false;
  setResumeAvailable(true);
  resumeAvailableRef.current = true;
  persistBufferedRecordingChunk(recorder?.mimeType || "audio/webm")
    .then(() => autoSaveInterruptedRecording())
    .catch(() => {})
    .finally(() => scheduleResumeRecording());
}

function scheduleResumeRecording() {
  window.clearTimeout(resumeTimerRef.current);
  resumeTimerRef.current = window.setTimeout(() => {
    if (manualStopRequestedRef.current || !resumeAvailableRef.current || isRecordingRef.current || document.visibilityState === "hidden") return;
    beginRecording({ resume: true, automatic: true }).catch(() => {});
  }, 900);
}

async function finishRecordingSession() {
  finalizingRecordingRef.current = true;
  const sessionId = recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "";
  const sessionManifest = readRecordingSessionManifest();
  const uploadStartIndex = Math.min(autosavedSegmentCountRef.current, sessionSegmentsRef.current.length);
  const segments = await recordingSegmentsForRange(uploadStartIndex);
  const durationMs = Math.max(1000, durationForSegmentRange(uploadStartIndex));
  const releaseRecorderUi = () => {
    resetRecordingSession();
    releaseRecordingWakeLock();
    setElapsedMs(0);
    stopReasonRef.current = "idle";
    manualStopRequestedRef.current = false;
    finalizingRecordingRef.current = false;
    setStatus("点击麦克风开始");
  };

  if (segments.length === 0) {
    if (sessionId) await clearRecordingRecoverySession(sessionId).catch(() => {});
    releaseRecorderUi();
    if (uploadStartIndex > 0) showToast("中断前录音已自动保存");
    return;
  }

  if (sessionId) backgroundUploadSessionIdsRef.current.add(sessionId);
  releaseRecorderUi();

  let uploaded = false;
  try {
    const recording = await uploadRecordingSegments(segments, durationMs);
    uploaded = true;
    setRecordingError("");
  } catch (error) {
    console.error("call finishRecordingSession failed: ", error.message)
    setRecordingError("");
    showToast(`调用 finishRecordingSession failed: ${error.message}`, 4000);
  } finally {
    if (uploaded && sessionManifest?.id) {
      await clearRecordingRecoveryManifest(sessionManifest).catch(() => {});
    }
    if (sessionId) {
      backgroundUploadSessionIdsRef.current.delete(sessionId);
    }
  }
}

async function beginRecording(options = {}) {
  if (finalizingRecordingRef.current) return;
  const resume = Boolean(options.resume);
  if (!resume) manualStopRequestedRef.current = false;
  setRecordingError("");

  if (!canRequestMicrophone()) {
    setRecordingError("手机端录音必须通过 HTTPS 打开。请部署到 HTTPS 域名后，再从企业微信应用入口访问。");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setRecordingError("当前环境不支持网页录音，请升级企业微信或使用系统浏览器打开。");
    return;
  }

  try {
    if (!resume) {
      const staleManifests = readRecoverableRecordingManifests().filter((manifest) => !backgroundUploadSessionIdsRef.current.has(manifest.id));
      if (staleManifests.length > 0) {
        recoverInterruptedRecordingSession().catch(() => {});
        showToast("正在后台恢复中断前的录音");
      }
      resetRecordingSession();
      ensureRecordingSessionManifest();
      await requestPersistentRecordingStorage();
    }
    // 请求麦克风权限
    const stream = await requestMicrophoneStream();
    await requestRecordingWakeLock();
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    const recorderChunks = [];
    chunksRef.current = recorderChunks;
    streamRef.current = stream;
    mediaRecorderRef.current = recorder;
    startedAtRef.current = Date.now();
    lastRecorderDataAtRef.current = startedAtRef.current;
    lastRecorderWatchdogActionAtRef.current = 0;
    stopReasonRef.current = "recording";

    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        lastRecorderDataAtRef.current = Date.now();
        recorderChunks.push(event.data);
        if (stopReasonRef.current === "recording") {
          persistBufferedRecordingChunk(recorder.mimeType || event.data.type || "audio/webm").catch(() => {});
        }
      }
    };

    recorder.onstop = async () => {
      const manualSnapshot = stoppedRecordingSnapshotsRef.current.get(recorder);
      if (manualSnapshot) {
        stoppedRecordingSnapshotsRef.current.delete(recorder);
        await uploadStoppedRecordingSnapshot(manualSnapshot, recorder.mimeType || "audio/webm");
        return;
      }

      const reason = stopReasonRef.current === "recording" ? "interrupted" : stopReasonRef.current;
      await persistBufferedRecordingChunk(recorder.mimeType || "audio/webm");
      if (mediaRecorderRef.current === recorder) {
        cleanupCapture();
        mediaRecorderRef.current = null;
      }

      if (reason === "manual") {
        await finishRecordingSession();
        return;
      }

      if (reason === "rollover") {
        if (manualStopRequestedRef.current) {
          await finishRecordingSession();
          return;
        }
        setIsRecording(false);
        isRecordingRef.current = false;
        setResumeAvailable(true);
        resumeAvailableRef.current = true;
        setStatus("长录音保护分段中，正在继续录音");
        beginRecording({ resume: true, automatic: true }).catch(() => scheduleResumeRecording());
        return;
      }

      if (reason === "interrupted") {
        if (manualStopRequestedRef.current) return;
        await autoSaveInterruptedRecording();
        setIsRecording(false);
        isRecordingRef.current = false;
        setResumeAvailable(true);
        resumeAvailableRef.current = true;
        setStatus("麦克风已被系统暂停，返回后自动续录");
        scheduleResumeRecording();
        return;
      }

      stopReasonRef.current = "idle";
    };

    recorder.onerror = () => handleCaptureInterrupted("录音被系统中断，已保留当前片段，返回页面后会自动续录。");
    stream.oninactive = () => handleCaptureInterrupted("麦克风音频流被系统暂停，已保留当前片段，返回页面后会自动续录。");
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => handleCaptureInterrupted("电话或系统声音占用了麦克风，已保留当前片段，返回页面后会自动续录。");
      track.onmute = () => {
        if (stopReasonRef.current === "recording") setStatus("麦克风暂时被系统占用，正在等待恢复");
      };
      track.onunmute = () => {
        if (stopReasonRef.current === "recording") setStatus("录音中，再点一次停止");
      };
    });

    if (RECORDING_DATA_SLICE_MS > 0) recorder.start(RECORDING_DATA_SLICE_MS);
    else recorder.start();
    setIsRecording(true);
    isRecordingRef.current = true;
    setResumeAvailable(false);
    resumeAvailableRef.current = false;
    setStatus(resume ? "续录中，再点一次停止" : "录音中，再点一次停止");
    scheduleRecorderRollover();
    scheduleRecordingAutosave();
    scheduleRecordingWatchdog();
    startAnalyser(stream);
    timerRef.current = window.setInterval(() => {
      setElapsedMs(totalElapsedBeforeSegmentRef.current + Date.now() - startedAtRef.current);
    }, 80);
  } catch (error) {
    alert("录音失败，请检查麦克风权限或网络连接: ", error.message);
    setRecordingError(microphoneErrorMessage(error));
    cleanupCapture();
    if (resume || sessionSegmentsRef.current.length > 0) {
      setResumeAvailable(true);
      setStatus("麦克风尚未恢复，点击麦克风继续录音");
    }
  }
}

async function stopRecording() {
  if (finalizingRecordingRef.current) return;
  const recorder = mediaRecorderRef.current;
  if (recorder && recorder.state !== "inactive") {
    manualStopRequestedRef.current = true;
    stopReasonRef.current = "manual";
    finalizingRecordingRef.current = true;
    preserveCurrentChunk(recorder);
    await new Promise((resolve) => window.setTimeout(resolve, 140));
    await Promise.race([
      recordingPersistPromiseRef.current.catch(() => {}),
      new Promise((resolve) => window.setTimeout(resolve, 800)),
    ]);
    window.clearInterval(timerRef.current);
    window.clearTimeout(resumeTimerRef.current);
    window.clearTimeout(rolloverTimerRef.current);
    window.clearTimeout(autosaveTimerRef.current);
    setIsRecording(false);
    isRecordingRef.current = false;
    setResumeAvailable(false);
    resumeAvailableRef.current = false;
    setStatus("正在保存录音");
    try {
      recorder.stop();
    } catch {
      await persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
      cleanupCapture();
      mediaRecorderRef.current = null;
      await finishRecordingSession().catch((error) => {
        showToast(`调用 finishRecordingSession failed: ${error.message}`, 4000);
        finalizingRecordingRef.current = false;
      });
    }
    return;
  }

  if (isRecordingRef.current || resumeAvailableRef.current || sessionDurationsRef.current.length > 0 || chunksRef.current.length > 0) {
    manualStopRequestedRef.current = true;
    stopReasonRef.current = "manual";
    finalizingRecordingRef.current = true;
    await persistBufferedRecordingChunk(recorder?.mimeType || "audio/webm").catch(() => {});
    cleanupCapture();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    isRecordingRef.current = false;
    setResumeAvailable(false);
    resumeAvailableRef.current = false;
    await finishRecordingSession().catch((error) => {
      showToast(`调用 finishRecordingSession failed: ${error.message}`, 4000);
      finalizingRecordingRef.current = false;
    });
  }
}

function toggleRecording() {
  console.log("toggleRecording");
  const recorder = mediaRecorderRef.current;
  if (isRecordingRef.current || recorder?.state === "recording") stopRecording();
  else beginRecording();
}

  return { elapsedMs, isRecording, level, recordingError, toggleRecording };
}
