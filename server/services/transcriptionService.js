export function createTranscriptionService({ getTranscriptionDiagnostics }) {
  return {
    getStatus() {
      return { transcription: getTranscriptionDiagnostics() };
    },
  };
}
