import { pgPool } from "@/utils/clients";
import { logger } from "@/utils/logger";
import {
  enqueueSubscriptionExpirationReminder,
} from "@/services/notification/notification.service";

const NOTIFICATION_WINDOW_HOURS = 24;
const REMINDER_SENT_FLAG = "expiration_reminder_sent";

export async function runSubscriptionExpirationCheck() {
  const startTime = Date.now();
  logger.info("Starting subscription expiration check");

  try {
    const expiringSubscriptions = await findExpiringSubscriptions();
    logger.info("Found expiring subscriptions", { count: expiringSubscriptions.length });

    let notificationsSent = 0;
    let alreadyNotified = 0;
    let errors = 0;

    for (const subscription of expiringSubscriptions) {
      try {
        if (hasReminderBeenSent(subscription.metadata)) {
          alreadyNotified += 1;
          continue;
        }

        await enqueueSubscriptionExpirationReminder(
          subscription.user_id,
          subscription.id,
          new Date(subscription.expires_at),
        );

        await markReminderSent(subscription.id);
        notificationsSent += 1;
      } catch (error) {
        logger.error("Failed to process subscription expiration", {
          subscriptionId: subscription.id,
          userId: subscription.user_id,
          error,
        });
        errors += 1;

        await persistError(
          "subscription_expiration_check",
          `Failed to send expiration reminder for subscription ${subscription.id}`,
          error,
          subscription.user_id,
        );
      }
    }

    const duration = Date.now() - startTime;
    logger.info("Subscription expiration check completed", {
      duration,
      total: expiringSubscriptions.length,
      notificationsSent,
      alreadyNotified,
      errors,
    });
  } catch (error) {
    logger.error("Subscription expiration check failed", { error });
    await persistError("subscription_expiration_check", "Critical failure in subscription expiration check", error);
    throw error;
  }
}

async function findExpiringSubscriptions() {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + NOTIFICATION_WINDOW_HOURS * 60 * 60 * 1000);

  const result = await pgPool.query(
    `
      SELECT id, user_id, plan_code, plan_name, status, expires_at, metadata
      FROM subscriptions
      WHERE status = 'active'
        AND expires_at > $1
        AND expires_at <= $2
      ORDER BY expires_at ASC
    `,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );

  return result.rows as Array<{
    id: string;
    user_id: string;
    plan_code: string;
    plan_name: string;
    status: string;
    expires_at: string;
    metadata: Record<string, unknown>;
  }>;
}

function hasReminderBeenSent(metadata: Record<string, unknown>): boolean {
  return metadata[REMINDER_SENT_FLAG] === true;
}

async function markReminderSent(subscriptionId: string) {
  await pgPool.query(
    `
      UPDATE subscriptions
      SET metadata = jsonb_set(
        metadata,
        '{${REMINDER_SENT_FLAG}}',
        'true'::jsonb,
        true
      ),
      updated_at = NOW()
      WHERE id = $1
    `,
    [subscriptionId],
  );
}

async function persistError(
  context: string,
  message: string,
  error: unknown,
  userId?: string,
): Promise<void> {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stacktrace = error instanceof Error ? error.stack : null;

    await pgPool.query(
      `
        INSERT INTO error_logs (user_id, level, message, stacktrace, context, created_at, expires_at)
        VALUES ($1, 'error', $2, $3, $4, NOW(), NOW() + INTERVAL '2 days')
      `,
      [userId || null, message, stacktrace, JSON.stringify({ context, errorMessage })],
    );
  } catch (persistError) {
    logger.error("Failed to persist error to database", { originalError: error, persistError });
  }
}
