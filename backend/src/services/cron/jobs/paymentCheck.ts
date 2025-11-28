import { pgPool } from "@/utils/clients";
import { logger } from "@/utils/logger";
import {
  enqueuePendingPaymentReminder,
  enqueuePaymentCancellationNotice,
} from "@/services/notification/notification.service";

const PAYMENT_WINDOW_HOURS = 24;
const REMINDER_INTERVAL_MINUTES = 30;

export async function runPaymentCheck() {
  logger.info("Starting payment check");

  try {
    const pendingPayments = await findPendingPayments();
    logger.info("Found pending payments", { count: pendingPayments.length });

    let remindersEnqueued = 0;
    let paymentsCancelled = 0;
    let errors = 0;

    for (const payment of pendingPayments) {
      try {
        const paymentAge = Date.now() - new Date(payment.created_at).getTime();
        const paymentAgeHours = paymentAge / (60 * 60 * 1000);

        if (paymentAgeHours > PAYMENT_WINDOW_HOURS) {
          await cancelPayment(payment.id);
          await enqueuePaymentCancellationNotice(payment.user_id, payment.id, parseFloat(payment.amount), payment.currency);
          paymentsCancelled += 1;
        } else if (shouldSendReminder(payment.created_at, payment.last_reminder_at)) {
          await enqueuePendingPaymentReminder(payment.user_id, payment.id, parseFloat(payment.amount), payment.currency);
          await updateLastReminderTimestamp(payment.id);
          remindersEnqueued += 1;
        }
      } catch (error) {
        logger.error("Failed to process payment", { paymentId: payment.id, error });
        errors += 1;

        await persistError(
          "payment_check",
          `Failed to process payment ${payment.id}`,
          error,
          payment.user_id,
        );
      }
    }

    logger.info("Payment check completed", {
      total: pendingPayments.length,
      remindersEnqueued,
      paymentsCancelled,
      errors,
    });
  } catch (error) {
    logger.error("Payment check failed", { error });
    await persistError("payment_check", "Critical failure in payment check", error);
    throw error;
  }
}

async function findPendingPayments() {
  const result = await pgPool.query(
    `
      SELECT id, user_id, amount, currency, status, created_at,
             payload->'last_reminder_at' as last_reminder_at
      FROM payments
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `,
  );

  return result.rows as Array<{
    id: string;
    user_id: string;
    amount: string;
    currency: string;
    status: string;
    created_at: string;
    last_reminder_at: string | null;
  }>;
}

function shouldSendReminder(createdAt: string, lastReminderAt: string | null): boolean {
  if (!lastReminderAt) {
    const createdTime = new Date(createdAt).getTime();
    const minutesSinceCreation = (Date.now() - createdTime) / (60 * 1000);
    return minutesSinceCreation >= REMINDER_INTERVAL_MINUTES;
  }

  const lastReminderTime = new Date(lastReminderAt).getTime();
  const minutesSinceLastReminder = (Date.now() - lastReminderTime) / (60 * 1000);
  return minutesSinceLastReminder >= REMINDER_INTERVAL_MINUTES;
}

async function cancelPayment(paymentId: string) {
  await pgPool.query(
    `
      UPDATE payments
      SET status = 'cancelled',
          payload = jsonb_set(
            payload,
            '{cancelled_reason}',
            '"Payment window exceeded"'::jsonb,
            true
          )
      WHERE id = $1
    `,
    [paymentId],
  );
}

async function updateLastReminderTimestamp(paymentId: string) {
  await pgPool.query(
    `
      UPDATE payments
      SET payload = jsonb_set(
        payload,
        '{last_reminder_at}',
        to_jsonb(NOW()::text),
        true
      )
      WHERE id = $1
    `,
    [paymentId],
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
