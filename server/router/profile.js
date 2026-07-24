import express from "express";
import { createProfileController } from "../controllers/profileController.js";
import { createProfileService } from "../services/profileService.js";

const router = express.Router();
let controller;

export function configure(deps) {
  controller = createProfileController(createProfileService(deps));
}

router.get("/", (request, response, next) => controller.getProfile(request, response, next));
router.put("/", (request, response, next) => controller.updateProfile(request, response, next));

export default router;
