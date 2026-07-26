import express from "express";
import { createWeChatJsSdkConfig } from "../utils/wechat.js";

const router = express.Router();

router.get("/js-sdk-config", async (request, response, next) => {
  try {
    const pageUrl = String(request.query.url || "").trim();
    let parsedUrl;
    try {
      parsedUrl = new URL(pageUrl);
    } catch {
      response.status(400).json({ error: "invalid page URL" });
      return;
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
      response.status(400).json({ error: "page URL must use HTTPS" });
      return;
    }
    parsedUrl.hash = "";
    response.json(await createWeChatJsSdkConfig(parsedUrl.toString()));
  } catch (error) {
    next(error);
  }
});

export default router;
