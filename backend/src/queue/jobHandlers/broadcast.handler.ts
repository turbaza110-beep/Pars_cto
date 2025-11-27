import { Job } from "bull";

import { BroadcastJob } from "@/jobs/broadcastJob";
import { logger } from "@/utils/logger";

export async function handleBroadcastJob(job: Job<BroadcastJob>) {
  logger.info("Broadcast job started", { jobId: job.id, broadcastId: job.data.broadcastId, audience: job.data.audience.length });

  const chunks = Math.max(1, job.data.audience.length);
  let processed = 0;

  for (const recipient of job.data.audience) {
    processed += 1;
    const progress = Math.round((processed / chunks) * 100);
    await job.progress(progress);
    logger.debug("Broadcast chunk processed", { jobId: job.id, recipient });
  }

  await job.progress(100);
  logger.info("Broadcast job completed", { jobId: job.id, broadcastId: job.data.broadcastId });

  return {
    deliveredCount: job.data.audience.length,
    broadcastId: job.data.broadcastId,
    priority: job.data.priority ?? "normal",
  };
}
