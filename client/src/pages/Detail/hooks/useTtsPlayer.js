import { useEffect, useRef, useState } from "react";
import { mediaRequestUrl } from "../../../utils/index.js";
import { createTtsAudio } from "../../../api/detail.js";

const IDLE_STATE = { key: "", itemId: "", index: -1, loading: false, playing: false };

export function useTtsPlayer({ onBeforePlay, onToast } = {}) {
  const audioRef = useRef(null);
  const queueRef = useRef({ itemId: "", segments: [], index: 0 });
  const callbacksRef = useRef({ onBeforePlay, onToast });
  const [state, setState] = useState(IDLE_STATE);
  callbacksRef.current = { onBeforePlay, onToast };

  function stop() {
    const audio = audioRef.current;
    queueRef.current = { itemId: "", segments: [], index: 0 };
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setState(IDLE_STATE);
  }

  async function playSegment(itemId, segments, index = 0, auto = false) {
    const segment = segments[index];
    const audio = audioRef.current;
    if (!segment || !audio) return;

    const key = `${itemId}:${segment.id}`;
    queueRef.current = { itemId, segments, index };
    setState({ key, itemId, index, loading: true, playing: false });

    try {
      callbacksRef.current.onBeforePlay?.();
      const payload = await createTtsAudio(segment.text);
      if (queueRef.current.itemId !== itemId || queueRef.current.index !== index) return;
      audio.src = mediaRequestUrl(payload.url, payload.id || Date.now());
      audio.load();
      await audio.play();
      setState({ key, itemId, index, loading: false, playing: true });
    } catch (error) {
      if (!auto) callbacksRef.current.onToast?.(error instanceof Error ? error.message : "朗读生成失败");
      queueRef.current = { itemId: "", segments: [], index: 0 };
      setState(IDLE_STATE);
    }
  }

  function startQueue(itemId, segments, index = 0) {
    if (!segments.length) {
      callbacksRef.current.onToast?.("没有可朗读的内容");
      return;
    }
    void playSegment(itemId, segments, index);
  }

  function toggleSegment(itemId, segments, index = 0) {
    const segment = segments[index];
    if (!segment) return;
    const key = `${itemId}:${segment.id}`;
    if (state.key === key && (state.playing || state.loading)) {
      stop();
      return;
    }
    startQueue(itemId, segments, index);
  }

  function toggleQueue(itemId, segments) {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.itemId === itemId && state.loading) {
      stop();
      return;
    }
    if (state.itemId === itemId && state.key && !state.loading) {
      if (state.playing) stop();
      else audio.play().catch(() => startQueue(itemId, segments, Math.max(0, state.index)));
      return;
    }
    startQueue(itemId, segments);
  }

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audioRef.current = audio;

    const handlePlay = () => setState((current) => ({ ...current, playing: true, loading: false }));
    const handlePause = () => setState((current) => ({ ...current, playing: false, loading: false }));
    const handleEnded = () => {
      const queue = queueRef.current;
      if (queue.itemId && queue.segments.length > queue.index + 1) {
        void playSegment(queue.itemId, queue.segments, queue.index + 1, true);
        return;
      }
      queueRef.current = { itemId: "", segments: [], index: 0 };
      setState(IDLE_STATE);
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, []);

  return { state, stop, toggleQueue, toggleSegment };
}
