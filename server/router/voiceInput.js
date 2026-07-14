import express from "express";
import multer from "multer";
import path from "node:path";
import {removeFileIfExists} from '../utils/file.js'

const router = express.Router();

let dependencies = {};
let upload = null;

export function configure(deps) {
  dependencies = deps;
  upload = multer({
    dest: deps.tempDir,
    limits: {
      fileSize: 1024 * 1024 * 1024,
    },
  });
}

router.post("/", (request, response, next) => {
  if (!upload) {
    response.status(500).json({ error: "路由未配置" });
    return;
  }
  upload.single("audio")(request, response, (err) => {
    if (err) {
      next(err);
      return;
    }
    handleVoiceInput(request, response, next);
  });
});

async function handleVoiceInput(request, response, next) {
  const { crypto, tempDir, convertAudioFileToMp3, fileInfo, getTranscriptionMode, expandTranscriptSegments, transcribeVoiceInputRecording } = dependencies;
  
  let voicePath = "";
  let convertedPath = "";

  try {
    if (!request.file) {
      response.status(400).json({ error: "缺少语音文件" });
      return;
    }

    const id = crypto.randomUUID();
    const sourceExt = path.extname(request.file.originalname || "").toLowerCase();
    const directExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".amr"]);
    const directVoice = directExts.has(sourceExt);
    if (directVoice) {
      voicePath = request.file.path;
    } else {
      convertedPath = path.join(tempDir, `${id}.mp3`);
      await convertAudioFileToMp3(request.file.path, convertedPath);
      await removeFileIfExists(request.file.path);
      voicePath = convertedPath;
    }
    const info = await fileInfo(voicePath);
    const fileName = directVoice ? `voice-${id}${sourceExt}` : `${id}.mp3`;
    const recording = {
      id,
      seq: 0,
      name: "voice-input",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      durationMs: Number(request.body?.durationMs || 0),
      mimeType: directVoice ? request.file.mimetype || "audio/mpeg" : "audio/mpeg",
      size: info.size,
      fileName,
      storagePath: voicePath,
      speakerName: "speaker-1",
      speakerMap: {},
      tag: "",
      status: "uploaded",
      transcriptProvider: getTranscriptionMode(),
    };

    const segments = expandTranscriptSegments(await transcribeVoiceInputRecording(recording), recording.durationMs || 0);
    const text = segments.map((segment) => segment.text).join(" ").trim();
    response.json({ text, segments });
  } catch (error) {
    next(error);
  } finally {
    await removeFileIfExists(request.file?.path);
    await removeFileIfExists(convertedPath);
  }
}

export default router;