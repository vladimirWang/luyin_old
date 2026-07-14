import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import logger from "./log.js";

export async function removeFileIfExists(filePath) {
  if (!filePath) return;
  await rm(filePath, { force: true }).catch((err) => {
    logger.error('failed to remove file: ', {message: `Failed to remove file: ${filePath}, err: ${err.message}`});
  });
}