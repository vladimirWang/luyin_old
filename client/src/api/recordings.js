import req from "../utils/request";

// 获取录音
export function getRecordings(params) {
    return req.get("/api/recordings", {params})
}

export function createRecordingAudioShareLink(recordingId) {
    return req.post(`/api/recordings/${encodeURIComponent(recordingId)}/audio-share-url`)
}
