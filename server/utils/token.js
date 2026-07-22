import crypto from "node:crypto";

import { redisClient } from "../plugins/redis.js";
import logger from "./log.js";

const TM_TOKEN_KEY = "tencent-meeting:sts-token";
const TM_TOKEN_REQUEST_LOCK_KEY = "tencent-meeting:sts-token:request-lock";
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_COOLDOWN_MS = 2 * 60 * 1000;

let requestInFlight = null;

function positiveDuration(value, fallback) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function refreshWindowMs() {
  return positiveDuration(process.env.TENCENT_MEETING_STS_REFRESH_WINDOW_MS, DEFAULT_REFRESH_WINDOW_MS);
}

function requestCooldownMs() {
  return positiveDuration(process.env.TENCENT_MEETING_STS_REQUEST_COOLDOWN_MS, DEFAULT_REQUEST_COOLDOWN_MS);
}

function operatorId() {
  return [
    process.env.TENCENT_MEETING_STS_OPERATOR_ID,
    process.env.WEMEET_STS_OPERATOR_ID,
    process.env.TENCENT_MEETING_OPERATOR_ID,
    process.env.WEMEET_OPERATOR_ID,
  ].map((value) => String(value || "").trim()).find(Boolean) || "";
}

function expirationMs(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
}

function parseStoredToken(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const token = String(parsed?.value || "").trim();
    const expiresAt = expirationMs(parsed?.expiresAt);
    if (!token || !expiresAt) return null;
    return {
      value: token,
      expiresAt,
      reqId: String(parsed?.reqId || "").trim(),
    };
  } catch {
    return null;
  }
}

export async function getTMToken(options = {}) {
  if (!redisClient.isReady) return null;
  try {
    const token = parseStoredToken(await redisClient.get(TM_TOKEN_KEY));
    const minimumValidityMs = Math.max(0, Number(options.minimumValidityMs || 0));
    if (!token || token.expiresAt <= Date.now() + minimumValidityMs) return null;
    return token;
  } catch (error) {
    logger.warn("[Tencent Meeting] failed to read STS token from Redis", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function acquireRequestLock(owner, ttlMs) {
  if (!redisClient.isReady) return false;
  const result = await redisClient.set(TM_TOKEN_REQUEST_LOCK_KEY, owner, {
    NX: true,
    PX: ttlMs,
  });
  return result === "OK";
}

async function releaseOwnedRequestLock(owner) {
  if (!redisClient.isReady) return;

  await redisClient.sendCommand([
    "EVAL",
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    "1",
    TM_TOKEN_REQUEST_LOCK_KEY,
    owner,
  ]);
}

/**
 * Return the current Tencent Meeting STS token and request a replacement only
 * when it is missing or inside the refresh window. A successful request is
 * asynchronous: Tencent Meeting delivers the new token through the
 * `common.sts-token` webhook, which must call {@link setTMToken}.
 */
export async function requestTMToken() {
  if (requestInFlight) return requestInFlight;

  requestInFlight = (async () => {
    if (!redisClient.isReady) {
      return { token: "", expiresAt: 0, requested: false, reason: "redis_unavailable" };
    }

    const now = Date.now();
    const current = await getTMToken();
    const tokenUsable = Boolean(current?.value && current.expiresAt > now);
    const refreshDue = !tokenUsable || current.expiresAt <= now + refreshWindowMs();

    if (!refreshDue) {
      return {
        token: current.value,
        expiresAt: current.expiresAt,
        requested: false,
        reason: "token_fresh",
      };
    }

    const tmOperatorId = operatorId();
    if (!tmOperatorId) {
      return {
        token: tokenUsable ? current.value : "",
        expiresAt: tokenUsable ? current.expiresAt : 0,
        requested: false,
        reason: "missing_operator_id",
      };
    }

    const lockOwner = `${process.pid}:${crypto.randomUUID()}`;
    const cooldownMs = requestCooldownMs();
    let lockAcquired = false;
    try {
      lockAcquired = await acquireRequestLock(lockOwner, cooldownMs);
      if (!lockAcquired) {
        return {
          token: tokenUsable ? current.value : "",
          expiresAt: tokenUsable ? current.expiresAt : 0,
          requested: false,
          reason: "request_pending",
        };
      }

      const { tencentMeetingApiRequest } = await import("./tencentMeeting.mjs");
      await tencentMeetingApiRequest("POST", "/v1/app/sts-token", {
        operator_id: tmOperatorId,
        operator_id_type: 1,
        valid_time: 24,
      }, { skipStsToken: true });

      return {
        token: tokenUsable ? current.value : "",
        expiresAt: tokenUsable ? current.expiresAt : 0,
        requested: true,
        reason: "requested",
      };
    } catch (error) {
      if (lockAcquired) {
        await releaseOwnedRequestLock(lockOwner).catch(() => {});
      }
      logger.warn("[Tencent Meeting] STS token request failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        token: tokenUsable ? current.value : "",
        expiresAt: tokenUsable ? current.expiresAt : 0,
        requested: false,
        reason: "request_failed",
      };
    }
  })().finally(() => {
    requestInFlight = null;
  });

  return requestInFlight;
}

/**
 * Persist the canonical `token_info` object received from the Tencent Meeting
 * `common.sts-token` webhook and release the request cooldown.
 */
export async function setTMToken(tokenInfo = {}) {
  const value = String(tokenInfo.sts_token || "").trim();
  const expiresAt = expirationMs(tokenInfo.expire_ts);
  const reqId = String(tokenInfo.req_id || "").trim();

  if (!value) throw new TypeError("Tencent Meeting token_info.sts_token is required.");
  if (!expiresAt || expiresAt <= Date.now()) {
    throw new TypeError("Tencent Meeting token_info.expire_ts must be a future timestamp.");
  }

  const record = {
    value,
    expiresAt,
    reqId,
    updatedAt: new Date().toISOString(),
  };
  const ttlMs = Math.max(1, expiresAt - Date.now());

  if (!redisClient.isReady) {
    throw new Error("Redis is not ready; Tencent Meeting STS token was not stored.");
  }

  await redisClient.set(TM_TOKEN_KEY, JSON.stringify(record), { PX: ttlMs });
  await redisClient.del(TM_TOKEN_REQUEST_LOCK_KEY);

  return {
    set: true,
    expiresAt,
    reqId,
  };
}
