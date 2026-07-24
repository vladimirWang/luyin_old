import express from "express";
import { createTtsController } from "../controllers/ttsController.js";
import { createTtsService } from "../services/ttsService.js";

const router = express.Router();
let controller;

export function configure(deps) {
  controller = createTtsController(createTtsService(deps));
}

router.post("/", (request, response) => controller.generate(request, response));
router.get("/:id/audio.:ext", (request, response, next) => controller.getAudio(request, response, next));

export default router;
