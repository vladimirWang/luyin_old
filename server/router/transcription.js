import express from "express";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/status", async (_request, response) => {
  const { getTranscriptionDiagnostics } = dependencies;
  response.json({ transcription: getTranscriptionDiagnostics() });
});

export default router;