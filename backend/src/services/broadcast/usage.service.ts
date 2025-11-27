import { pgPool } from "@/utils/clients";
import { RateLimitError } from "@/utils/errors";
import { logger } from "@/utils/logger";
import { withRedisClient } from "@/services/redis.service";
import { invalidateDashboardCache } from "@/services/dashboard/dashboard.service";

interface UsageLimitRow {
  id: string;
  user_id: string;
  limit_key: string;
  limit_value: number;
  consumed_value: number;
  resets_at: Date | null;
}

const BROADCAST_LIMIT_KEY = "broadcast_used";
const CACHE_PREFIX = "usage:broadcast";

export interface UsageLimit {
  id: string;
  userId: string;
  limitKey: string;
  limitValue: number;
  consumedValue: number;
  resetsAt: Date | null;
}

function mapRowToUsageLimit(row: UsageLimitRow): UsageLimit {
  return {
    id: row.id,
    userId: row.user_id,
    limitKey: row.limit_key,
    limitValue: row.limit_value,
    consumedValue: row.consumed_value,
    resetsAt: row.resets_at,
  };
}

export async function getBroadcastUsage(userId: string): Promise<UsageLimit | null> {
  try {
    const cached = await withRedisClient((client) => client.get(`${CACHE_PREFIX}:${userId}`));
    if (cached) {
      return JSON.parse(cached) as UsageLimit;
    }
  } catch (error) {
    logger.warn("Failed to read cached broadcast usage", { userId, error });
  }

  const result = await pgPool.query<UsageLimitRow>(
    `SELECT id, user_id, limit_key, limit_value, consumed_value, resets_at
     FROM usage_limits
     WHERE user_id = $1 AND limit_key = $2`,
    [userId, BROADCAST_LIMIT_KEY],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const usage = mapRowToUsageLimit(result.rows[0]);

  try {
    await withRedisClient((client) =>
      client.setEx(`${CACHE_PREFIX}:${userId}`, 300, JSON.stringify(usage)),
    );
  } catch (error) {
    logger.warn("Failed to cache broadcast usage", { userId, error });
  }

  return usage;
}

export async function checkBroadcastQuota(userId: string, recipientCount: number): Promise<boolean> {
  const usage = await getBroadcastUsage(userId);

  if (!usage) {
    return true; // No limit set
  }

  if (usage.resetsAt && new Date() > usage.resetsAt) {
    // Reset has expired
    await pgPool.query(
      `UPDATE usage_limits SET consumed_value = 0, resets_at = NULL WHERE id = $1`,
      [usage.id],
    );
    return true;
  }

  const remaining = usage.limitValue - usage.consumedValue;
  return remaining >= recipientCount;
}

export async function incrementBroadcastUsage(userId: string, amount: number): Promise<void> {
  const usage = await getBroadcastUsage(userId);

  if (!usage) {
    logger.warn("No broadcast usage limit found for user", { userId });
    return;
  }

  const newConsumed = usage.consumedValue + amount;

  if (newConsumed > usage.limitValue) {
    throw new RateLimitError(
      `Broadcast quota exceeded for user ${userId}`,
      { current: usage.consumedValue, limit: usage.limitValue },
    );
  }

  await pgPool.query(
    `UPDATE usage_limits SET consumed_value = $1, updated_at = NOW() WHERE id = $2`,
    [newConsumed, usage.id],
  );

  // Invalidate cache
  await withRedisClient((client) => client.del(`${CACHE_PREFIX}:${userId}`));

  // Invalidate dashboard cache to reflect updated usage
  await invalidateDashboardCache(userId);
}

export async function checkAndIncrementBroadcastUsage(userId: string, recipientCount: number): Promise<void> {
  const hasQuota = await checkBroadcastQuota(userId, recipientCount);

  if (!hasQuota) {
    throw new RateLimitError(
      `Insufficient broadcast quota for user ${userId}`,
    );
  }

  await incrementBroadcastUsage(userId, recipientCount);
}
