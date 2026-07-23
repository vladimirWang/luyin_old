import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, getLocalProfile, showToast } from "../../../utils/index.js";

export function useDetailRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const recordingId = new URLSearchParams(location.search).get("id") || "";
  const [recording, setRecording] = useState(null);
  const language = getLocalProfile().language;

  useEffect(() => {
    let cancelled = false;
    if (!recordingId) {
      setRecording(null);
      return () => {
        cancelled = true;
      };
    }

    api(`/api/recordings/${encodeURIComponent(recordingId)}`)
      .then((payload) => {
        if (!cancelled) setRecording(payload.recording || null);
      })
      .catch((error) => {
        if (!cancelled) {
          setRecording(null);
          showToast(error instanceof Error ? error.message : "录音加载失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  function selectRecording(id) {
    navigate(id ? `/detail?id=${encodeURIComponent(id)}` : "/detail");
  }

  return { recording, language, selectRecording };
}
