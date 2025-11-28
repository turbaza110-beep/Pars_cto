import { JobTypes } from "@/jobs/jobTypes";
import { NotificationChannel } from "@/jobs/notificationJob";
import { addJob } from "@/utils/queueHelpers";
import { logger } from "@/utils/logger";

interface NotificationPayload {
  recipientId: string;
  channel: NotificationChannel;
  template: string;
  payload: Record<string, unknown>;
  delayMs?: number;
}

export async function enqueueNotification(data: NotificationPayload): Promise<string> {
  const notificationId = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const job = await addJob(
    JobTypes.NOTIFICATION,
    {
      notificationId,
      recipientId: data.recipientId,
      channel: data.channel,
      template: data.template,
      payload: data.payload,
      delayMs: data.delayMs,
    },
    {
      delay: data.delayMs,
    },
  );

  logger.info("Notification enqueued", {
    notificationId,
    recipientId: data.recipientId,
    channel: data.channel,
    template: data.template,
    jobId: job.id,
  });

  return notificationId;
}

export async function enqueueSubscriptionExpirationReminder(userId: string, subscriptionId: string, expiresAt: Date) {
  return enqueueNotification({
    recipientId: userId,
    channel: "email",
    template: "subscription_expiring_soon",
    payload: {
      subscriptionId,
      expiresAt: expiresAt.toISOString(),
      daysRemaining: 1,
    },
  });
}

export async function enqueuePendingPaymentReminder(userId: string, paymentId: string, amount: number, currency: string) {
  return enqueueNotification({
    recipientId: userId,
    channel: "email",
    template: "payment_pending_reminder",
    payload: {
      paymentId,
      amount,
      currency,
    },
  });
}

export async function enqueuePaymentCancellationNotice(
  userId: string,
  paymentId: string,
  amount: number,
  currency: string,
) {
  return enqueueNotification({
    recipientId: userId,
    channel: "email",
    template: "payment_cancelled",
    payload: {
      paymentId,
      amount,
      currency,
      reason: "Payment window exceeded",
    },
  });
}
