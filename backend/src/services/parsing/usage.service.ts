import { pgPool } from "@/utils/clients";
import { RateLimitError, SubscriptionError } from "@/utils/errors";

const PARSING_LIMIT_KEYS = ["searches_per_day", "parsing_requests", "parsing_channels"] as const;

type UsageLimitRow = {
  id: string;
  limit_key: string;
  limit_value: number | null;
  consumed_value: number | null;
};

type SubscriptionRow = {
  status: string | null;
  expires_at: Date | null;
};

async function findParsingLimitRow(userId: string): Promise<UsageLimitRow | null> {
  const result = await pgPool.query<UsageLimitRow>(
    `SELECT id, limit_key, limit_value, consumed_value
     FROM usage_limits
     WHERE user_id = $1 AND limit_key = ANY($2)
     ORDER BY array_position($2::text[], limit_key), COALESCE(limit_value, 0) DESC
     LIMIT 1`,
    [userId, PARSING_LIMIT_KEYS],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

export async function assertActiveSubscription(userId: string) {
  const result = await pgPool.query<SubscriptionRow>(
    `SELECT status, expires_at
     FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY expires_at DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    throw new SubscriptionError("Active subscription required");
  }

  const row = result.rows[0];
  const expiresAt = row.expires_at ? row.expires_at.getTime() : 0;
  if (!expiresAt || expiresAt <= Date.now()) {
    throw new SubscriptionError("Subscription expired");
  }
}

export async function assertParsingQuotaAvailable(userId: string) {
  const limitRow = await findParsingLimitRow(userId);
  if (!limitRow) {
    return;
  }

  const limitValue = limitRow.limit_value ?? 0;
  if (limitValue <= 0) {
    return;
  }

  const consumedValue = limitRow.consumed_value ?? 0;
  if (consumedValue >= limitValue) {
    throw new RateLimitError("Parsing limit exceeded", { details: { limit: limitValue, used: consumedValue } });
  }
}

export async function incrementParsingUsage(userId: string, amount = 1) {
  const limitRow = await findParsingLimitRow(userId);
  if (!limitRow) {
    return;
  }

  const limitValue = limitRow.limit_value ?? 0;
  if (limitValue <= 0) {
    return;
  }

  const incrementBy = Math.max(1, Number.isNaN(amount) ? 1 : Math.floor(amount));

  await pgPool.query(
    `UPDATE usage_limits
     SET consumed_value = LEAST(limit_value, COALESCE(consumed_value, 0) + $2), updated_at = NOW()
     WHERE id = $1`,
    [limitRow.id, incrementBy],
  );
}
