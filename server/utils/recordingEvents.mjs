const subscribers = new Set();
let nextEventId = Date.now();

function publicStatusPayload(recording = {}) {
  return {
    id: String(recording.id || ""),
    name: String(recording.name || ""),
    status: String(recording.status || ""),
    fileStatus: String(recording.fileStatus || ""),
    transcriptStatus: String(recording.transcriptStatus || ""),
    errorMessage: String(recording.errorMessage || ""),
    updatedAt: String(recording.updatedAt || ""),
  };
}

export function subscribeRecordingEvents(listener) {
  if (typeof listener !== "function") throw new TypeError("Recording event listener must be a function.");
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function publishRecordingEvent(type, recording = {}) {
  const event = {
    id: String(++nextEventId),
    type: String(type || "recording.updated"),
    recording,
    data: publicStatusPayload(recording),
  };
  for (const listener of [...subscribers]) {
    try {
      listener(event);
    } catch {
      // One closed or faulty connection must not interrupt the background job.
    }
  }
  return event;
}

export function formatRecordingSseEvent(event = {}) {
  const id = String(event.id || "");
  const type = String(event.type || "recording.updated");
  const payload = JSON.stringify(event.data || {});
  return `${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${payload}\n\n`;
}

export function recordingEventSubscriberCount() {
  return subscribers.size;
}
