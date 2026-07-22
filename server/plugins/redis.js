import { createClient } from "@redis/client";

const redisUrl = process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || "127.0.0.1"}:${process.env.REDIS_PORT || "6379"}`;

const redisClient = createClient({
  url: redisUrl,
});

async function connectRedis() {
  if (redisClient.isReady) return redisClient;
  if (redisClient.isOpen) return redisClient;

  redisClient.on("error", (error) => {
    console.error("Redis error:", error);
  });

  return redisClient
    .connect()
    .then(() => {
      console.log("Redis 连接成功");
      return redisClient;
    })
    .catch((error) => {
      console.error("Redis 连接失败:", error);
      throw error;
    });
}

export { redisClient, connectRedis };
