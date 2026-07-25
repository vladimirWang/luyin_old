import logger from "../utils/log.js";
import { redisClient } from "../plugins/redis.js";

export const RECORDING_CURRENT_SEQ_KEY = "recording_current_seq";

export async function initializeRecordingSequence(options = {}) {
  const prismaClient =
    options.prismaClient ||
    (await import("../plugins/prisma.cjs").then((module) => module.default || module));
  const redis = options.redis || redisClient;
  logger.info("[call] initializeRecordingSequence step 0", { message: "start" });

  const aggregate = await prismaClient.recording.aggregate({ _max: { seq: true } });
  const currentSeq = Math.max(0, Number(aggregate?._max?.seq || 0));
  await redis.set(RECORDING_CURRENT_SEQ_KEY, String(currentSeq));

  logger.info("[call] initializeRecordingSequence step 1", {
    message: `initialized: currentSeq=${currentSeq}`,
    currentSeq,
  });
  return currentSeq;
}

export async function nextRecordingSequence(options = {}) {
  const redis = options.redis || redisClient;
  const seq = Number(await redis.incr(RECORDING_CURRENT_SEQ_KEY));
  if (!Number.isSafeInteger(seq) || seq <= 0) {
    throw new Error("Redis returned an invalid recording sequence.");
  }
  return seq;
}
