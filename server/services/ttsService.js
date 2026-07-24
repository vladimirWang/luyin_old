import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ttsDir } from "../db.mjs";
import { detectTtsAudioFormat } from "../utils/common.mjs";

export function createTtsService({ generateQwenTtsAudio, findCachedTtsAudio }) {
  return {
    generate(text, options) {
      return generateQwenTtsAudio(text, options);
    },

    async findAudio(id, requestedExt) {
      const requestedPath = requestedExt ? path.join(ttsDir, `${id}.${requestedExt}`) : "";
      const cachedAudio =
        id && requestedPath && existsSync(requestedPath)
          ? { filePath: requestedPath, ...detectTtsAudioFormat(await readFile(requestedPath), requestedExt) }
          : await findCachedTtsAudio(id);
      return cachedAudio?.filePath && existsSync(cachedAudio.filePath) ? cachedAudio : null;
    },
  };
}
