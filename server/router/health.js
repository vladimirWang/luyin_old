import express from "express";
import { createHealthController } from "../controllers/healthController.js";
import { createHealthService } from "../services/healthService.js";

const router = express.Router();
let controller;

export function configure(deps) {
  controller = createHealthController(createHealthService(deps));
}

router.get("/", (request, response) => controller.getHealth(request, response));

export default router;
