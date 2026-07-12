import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ttsDir } from "../db.mjs";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.post("/", async (request, response) => {
  const { generateQwenTtsAudio } = dependencies;
  try {
    const result = await generateQwenTtsAudio(request.body?.text, {
      voice: request.body?.voice,
      model: request.body?.model,
    });
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "QWEN-TTS 生成失败" });
  }
});

router.get("/:id/audio.:ext", async (request, response) => {
  const { detectTtsAudioFormat, findCachedTtsAudio } = dependencies;
  const id = String(request.params.id || "").replace(/[^a-f0-9]/gi, "").slice(0, 80);
  const requestedExt = String(request.params.ext || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const requestedPath = requestedExt ? path.join(ttsDir, `${id}.${requestedExt}`) : "";
  const cachedAudio =
    id && requestedPath && existsSync(requestedPath)
      ? { filePath: requestedPath, ...detectTtsAudioFormat(await readFile(requestedPath), requestedExt) }
      : await findCachedTtsAudio(id);

  if (!id || !cachedAudio?.filePath || !existsSync(cachedAudio.filePath)) {
    response.status(404).json({ error: "朗读音频不存在" });
    return;
  }

  response.sendFile(cachedAudio.filePath, {
    headers: {
      "Content-Type": cachedAudio.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`tts-${id}.${cachedAudio.ext}`)}`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

export default router;