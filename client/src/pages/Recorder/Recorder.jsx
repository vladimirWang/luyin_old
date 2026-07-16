import { useUploadManager } from "../../hooks/useUploadManager.js";
import { RecorderView } from "./RecorderView.jsx";

export default function Recorder() {
  const {
    createUploadCard,
    uploadRecordingSegments,
  } = useUploadManager({
    onRecordingCreated: () => {},
    onRefresh: () => {},
  });

  return (
    <RecorderView
      createUploadCard={createUploadCard}
      uploadRecordingSegments={uploadRecordingSegments}
    />
  );
}
