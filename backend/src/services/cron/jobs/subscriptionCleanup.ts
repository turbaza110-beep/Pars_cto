import { pgPool } from "@/utils/clients";
import { withRedisClient } from "@/services/redis.service";
import { logger } from "@/utils/logger";

const RETENTION_DAYS = 2;

export async function runSubscriptionCleanup() {
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  logger.info("Starting subscription cleanup job", { cutoffDate: cutoffDate.toISOString() });

  try {
    const expiredUsers = await findExpiredUsers(cutoffDate);
    const userCount = expiredUsers.length;

    if (userCount === 0) {
      logger.info("No expired users for cleanup");
      return;
    }

    const userIds = expiredUsers.map((user) => user.user_id);

    await deleteUserData(userIds);
    await clearRedisProgress(userIds);

    logger.info("Subscription cleanup job completed", {
      processedUsers: userCount,
    });
  } catch (error) {
    logger.error("Subscription cleanup job failed", { error });
    await persistError("subscription_cleanup", "Failed subscription cleanup job", error);
    throw error;
  }
}

async function findExpiredUsers(cutoffDate: Date) {
  const result = await pgPool.query(
    `
      SELECT DISTINCT user_id
      FROM subscriptions
      WHERE status = 'expired'
        AND expires_at < $1
    `,
    [cutoffDate.toISOString()],
  );

  return result.rows as Array<{ user_id: string }>;
}

async function deleteUserData(userIds: string[]) {
  if (userIds.length === 0) return;

  const placeholders = userIds.map((_, index) => `$${index + 1}`).join(", ");

  await pgPool.query(`DELETE FROM parsing_history WHERE user_id IN (${placeholders})`, userIds);
  await pgPool.query(`DELETE FROM audience_segments WHERE user_id IN (${placeholders})`, userIds);
  await pgPool.query(`DELETE FROM broadcast_campaigns WHERE user_id IN (${placeholders})`, userIds);
  await pgPool.query(`DELETE FROM broadcast_logs WHERE user_id IN (${placeholders})`, userIds);
}

async function clearRedisProgress(userIds: string[]) {
  if (userIds.length === 0) return;

  await withRedisClient(async (client) => {
    const pipeline = client.multi();

    for (const userId of userIds) {
      pipeline.del(`parsing:progress:${userId}`);
    }

    await pipeline.exec();
  });
}

async function persistError(context: string, message: string, error: unknown): Promise<void> {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stacktrace = error instanceof Error ? error.stack : null;
    await pgPool.query(
      `
        INSERT INTO error_logs (level, message, stacktrace, context, created_at, expires_at)
        VALUES ('error', $1, $2, $3, NOW(), NOW() + INTERVAL '2 days')
      `,
      [message, stacktrace, JSON.stringify({ context, errorMessage })],
    );
  } catch (persistError) {
    logger.error("Failed to persist error to database during cleanup", { persistError });
  }
}
