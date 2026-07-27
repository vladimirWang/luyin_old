import req from "../utils/request";

// 获取录音
export function getRecordings(params) {
    return req.get("/api/recordings", {params})
}

export function createRecordingAudioShareLink(recordingId) {
    return req.post(`/api/recordings/${encodeURIComponent(recordingId)}/audio-share-url`)
}

export function renameRecording(recordingId, name) {
    return req.patch(`/api/recordings/${encodeURIComponent(recordingId)}`, { name })
}

export function getRecordingFeedback(recordingId, contentType) {
    return req.get(`/api/recordings/${encodeURIComponent(recordingId)}/feedback/${encodeURIComponent(contentType)}`)
}

export function saveRecordingFeedback(recordingId, contentType, satisfied) {
    return req.post(`/api/recordings/${encodeURIComponent(recordingId)}/feedback/${encodeURIComponent(contentType)}`, { satisfied })
}
