import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, getLocalProfile, showToast } from "../../utils/index.js";
import { DetailView } from "./DetailView.jsx";

export default function Detail() {
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

  return (
    <DetailView
      recording={recording}
      onBack={() => navigate("/records")}
      language={language}
      onSelectRecording={(id) => navigate(id ? `/detail?id=${encodeURIComponent(id)}` : "/detail")}
    />
  );
}
