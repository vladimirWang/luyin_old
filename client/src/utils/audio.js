export async function requestMicrophoneStream() {
  const attempts = [
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    { audio: true },
  ];
  // console.log("getUserMedia: ", typeof navigator.mediaDevices.getUserMedia)
  let lastError;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  // alert("都失败了")
  throw lastError;
}

export function getAudioFileDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement(String(file?.type || "").startsWith("video/") ? "video" : "audio");
    const objectUrl = URL.createObjectURL(file);
    const timeout = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    }, 2500);

    audio.preload = "metadata";
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      URL.revokeObjectURL(objectUrl);
      resolve(durationMs);
    };
    audio.onerror = () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    };
  });
}

export function isUploadableMediaFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    /\.(mp3|m4a|wav|webm|aac|mp4|mov|m4v)$/i.test(name)
  );
}