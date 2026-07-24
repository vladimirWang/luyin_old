import express from "express";
import { createTranscriptionController } from "../controllers/transcriptionController.js";
import { createTranscriptionService } from "../services/transcriptionService.js";

const router = express.Router();
let controller;

export function configure(deps) {
  controller = createTranscriptionController(createTranscriptionService(deps));
}

router.get("/status", (request, response) => controller.getStatus(request, response));

export default router;
