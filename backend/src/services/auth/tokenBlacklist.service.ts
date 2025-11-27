import { createHash } from "node:crypto";

import { withRedisClient } from "@/services/redis.service";

const TOKEN_BLACKLIST_PREFIX = "auth:token:blacklist";

function buildBlacklistKey(token: string) {
  const digest = createHash("sha256").update(token).digest("hex");
  return `${TOKEN_BLACKLIST_PREFIX}:${digest}`;
}

export async function blacklistToken(token: string, ttlSeconds: number) {
  if (!token) {
    return;
  }

  const expiresIn = Math.max(Math.floor(ttlSeconds), 0);
  if (expiresIn === 0) {
    return;
  }

  const key = buildBlacklistKey(token);
  await withRedisClient((client) => client.setEx(key, expiresIn, "1"));
}

export async function isTokenBlacklisted(token: string) {
  if (!token) {
    return false;
  }

  const key = buildBlacklistKey(token);
  const result = await withRedisClient((client) => client.exists(key));
  return result === 1;
}
