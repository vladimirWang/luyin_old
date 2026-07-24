import express from "express";
import { createFolderController } from "../controllers/folderController.js";
import { createFolderService } from "../services/folderService.js";

const router = express.Router();
let controller;

export function configure(deps) {
  controller = createFolderController(createFolderService(deps));
}

router.get("/", (request, response, next) => controller.list(request, response, next));
router.post("/", (request, response, next) => controller.create(request, response, next));
router.patch("/:id", (request, response, next) => controller.update(request, response, next));
router.delete("/:id", (request, response, next) => controller.remove(request, response, next));

export default router;
