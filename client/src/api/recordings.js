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

export function getMeetingOutlineFeedback(recordingId) {
    return req.get(`/api/recordings/${encodeURIComponent(recordingId)}/meeting-outline-feedback`)
}

export function saveMeetingOutlineFeedback(recordingId, satisfied) {
    return req.post(`/api/recordings/${encodeURIComponent(recordingId)}/meeting-outline-feedback`, { satisfied })
}
