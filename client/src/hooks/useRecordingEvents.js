import { useEffect, useRef } from "react";
import { mergeRequestHeaders } from "../utils/index.js";

function parseEventBlock(block) {
  let id = "";
  let type = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, "") : "";
    if (field === "id") id = value;
    if (field === "event") type = value;
    if (field === "data") data.push(value);
  }
  if (!data.length) return null;
  try {
    return { id, type, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

export function useRecordingEvents(onEvent, enabled = true) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return undefined;

    let stopped = false;
    let reconnectTimer = 0;
    let reconnectAttempt = 0;
    let controller = null;

    async function connect() {
      controller = new AbortController();
      try {
        const response = await fetch("/api/recordings/events", {
          method: "GET",
          headers: mergeRequestHeaders({ Accept: "text/event-stream" }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Recording event stream failed with ${response.status}`);
        }

        reconnectAttempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const event = parseEventBlock(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            if (event) onEventRef.current?.(event);
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (!stopped && error?.name !== "AbortError") {
          console.warn("[Recordings] SSE disconnected:", error instanceof Error ? error.message : error);
        }
      } finally {
        if (!stopped) {
          reconnectAttempt += 1;
          const delay = Math.min(15_000, 1000 * 2 ** Math.min(4, reconnectAttempt - 1));
          reconnectTimer = window.setTimeout(connect, delay);
        }
      }
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      controller?.abort();
    };
  }, [enabled]);
}
