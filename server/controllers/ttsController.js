export function createTtsController(service) {
  return {
    async generate(request, response) {
      try {
        const result = await service.generate(request.body?.text, {
          voice: request.body?.voice,
          model: request.body?.model,
        });
        response.json(result);
      } catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : "QWEN-TTS 生成失败" });
      }
    },

    async getAudio(request, response, next) {
      try {
        const id = String(request.params.id || "").replace(/[^a-f0-9]/gi, "").slice(0, 80);
        const ext = String(request.params.ext || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const audio = id ? await service.findAudio(id, ext) : null;
        if (!audio) {
          response.status(404).json({ error: "朗读音频不存在" });
          return;
        }
        response.sendFile(audio.filePath, {
          headers: {
            "Content-Type": audio.contentType,
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`tts-${id}.${audio.ext}`)}`,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
