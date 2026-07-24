import request from "../utils/request.js";

export function getDetailRecordings() {
  return request.get("/api/recordings", {
    params: { folderId: "all", q: "" },
  });
}

export function getRecording(id) {
  return request.get(`/api/recordings/${encodeURIComponent(id)}`);
}

export function getQaMessages(limit = 60) {
  return request.get("/api/qa-messages", { params: { limit } });
}

export function getQaMessage(id) {
  return request.get(`/api/qa-messages/${encodeURIComponent(id)}`);
}

export function createQuestion(payload) {
  return request.post("/api/ask", payload);
}

export function updateQaMessage(id, patch) {
  return request.patch(`/api/qa-messages/${encodeURIComponent(id)}`, patch);
}

export function deleteQaMessage(id) {
  return request.delete(`/api/qa-messages/${encodeURIComponent(id)}`);
}

export function transcribeVoiceInput(formData) {
  return request.post("/api/voice-input", formData);
}

export function getTodayMeetingBrief() {
  return request.get("/api/meeting-briefs/today");
}

export function generateTodayMeetingBrief() {
  return request.post("/api/meeting-briefs/today");
}

export function getMeetingBriefs(limit = 30) {
  return request.get("/api/meeting-briefs", { params: { limit } });
}

export function getMeetingBrief(date) {
  return request.get(`/api/meeting-briefs/${encodeURIComponent(date)}`);
}

export function generateMeetingBrief(date) {
  return request.post(`/api/meeting-briefs/${encodeURIComponent(date)}`);
}

export function createTtsAudio(text, options = {}) {
  return request.post("/api/tts", {
    text,
    voice: options.voice,
    model: options.model,
  });
}
