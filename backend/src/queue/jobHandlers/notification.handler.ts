import { Job } from "bull";

import { NotificationJob } from "@/jobs/notificationJob";
import { logger } from "@/utils/logger";

export async function handleNotificationJob(job: Job<NotificationJob>) {
  logger.info("Notification job started", { jobId: job.id, notificationId: job.data.notificationId, channel: job.data.channel });

  await job.progress(30);
  const payload = {
    notificationId: job.data.notificationId,
    recipientId: job.data.recipientId,
    channel: job.data.channel,
    deliveredAt: new Date().toISOString(),
  };

  await job.progress(100);
  logger.info("Notification job completed", { jobId: job.id, notificationId: job.data.notificationId });

  return payload;
}
