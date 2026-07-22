import req from "../utils/request";

// 获取录音
export function getRecordings(params) {
    return req.get("/api/recordings", {params})
}