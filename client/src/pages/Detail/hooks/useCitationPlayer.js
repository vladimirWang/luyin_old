import { useEffect, useRef, useState } from "react";
import { mediaRequestUrl } from "../../../utils/index.js";

const EMPTY_ACTIVE = { key: "", startMs: 0, endMs: 0 };

export function useCitationPlayer({ recordings, fallbackRecording, getEndMs, onBeforePlay } = {}) {
  const audioRef = useRef(null);
  const sourceRef = useRef("");
  const activeRef = useRef(EMPTY_ACTIVE);
  const callbacksRef = useRef({ getEndMs, onBeforePlay });
  const [activeKey, setActiveKey] = useState("");
  const [playback, setPlayback] = useState({ key: "", currentMs: 0, durationMs: 0 });
  callbacksRef.current = { getEndMs, onBeforePlay };

  function pause() {
    audioRef.current?.pause();
    setActiveKey("");
    activeRef.current = EMPTY_ACTIVE;
  }

  function play(citation, key, nextMs = citation.startMs || 0) {
    const target = recordings.find((item) => item.id === citation.recordingId) || fallbackRecording;
    const audio = audioRef.current;
    if (!target || !audio) return;
    callbacksRef.current.onBeforePlay?.();

    if (activeKey === key) {
      if (audio.paused) audio.play().catch(() => setActiveKey(""));
      else audio.pause();
      return;
    }

    const nextSrc = new URL(
      mediaRequestUrl(target.audioUrl, target.updatedAt || target.createdAt || ""),
      window.location.href,
    ).href;
    if (sourceRef.current !== nextSrc) {
      audio.src = nextSrc;
      sourceRef.current = nextSrc;
      audio.load();
    }

    const citationStartMs = Math.max(0, citation.startMs || 0);
    const citationEndMs = callbacksRef.current.getEndMs?.(citation) || citation.endMs || citationStartMs;
    const startMs = Math.min(citationEndMs, Math.max(citationStartMs, nextMs));
    activeRef.current = {
      key,
      startMs: citationStartMs,
      endMs: citationEndMs,
    };
    setActiveKey(key);
    setPlayback({ key, currentMs: startMs, durationMs: Math.max(1000, citationEndMs - citationStartMs) });

    const startPlayback = () => {
      audio.currentTime = startMs / 1000;
      audio.play().catch(() => setActiveKey(""));
    };
    if (audio.readyState >= 1) startPlayback();
    else audio.addEventListener("loadedmetadata", startPlayback, { once: true });
  }

  function seek(citation, key, nextMs) {
    const audio = audioRef.current;
    if (!audio) return;
    if (activeKey !== key) {
      play(citation, key, nextMs);
      return;
    }
    audio.currentTime = Math.max(0, nextMs) / 1000;
    setPlayback((current) => ({ ...current, currentMs: Math.max(0, nextMs) }));
  }

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      setPlayback((current) => ({ ...current, durationMs: Math.round((audio.duration || 0) * 1000) }));
    };
    const handleTimeUpdate = () => {
      const currentMs = Math.round((audio.currentTime || 0) * 1000);
      setPlayback((current) => ({ ...current, currentMs }));
      const active = activeRef.current;
      if (active.key && active.endMs && currentMs >= active.endMs) pause();
    };
    const handleEnded = () => pause();
    const handlePause = () => {
      if (!activeRef.current.key) setActiveKey("");
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
      sourceRef.current = "";
    };
  }, []);

  return { activeKey, playback, pause, play, seek };
}
