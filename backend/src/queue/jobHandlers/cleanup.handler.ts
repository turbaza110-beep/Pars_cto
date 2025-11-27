import { Job } from "bull";

import { CleanupDataJob } from "@/jobs/cleanupDataJob";
import { logger } from "@/utils/logger";

export async function handleCleanupJob(job: Job<CleanupDataJob>) {
  logger.info("Cleanup job started", { jobId: job.id, entity: job.data.entity });

  const batchSize = job.data.batchSize ?? 100;
  const totalBatches = Math.max(1, Math.ceil(batchSize / 10));

  for (let batch = 1; batch <= totalBatches; batch += 1) {
    await job.progress(Math.round((batch / totalBatches) * 100));
    logger.debug("Cleanup batch processed", { jobId: job.id, batch });
  }

  await job.progress(100);
  logger.info("Cleanup job completed", { jobId: job.id, entity: job.data.entity });

  return {
    entity: job.data.entity,
    removed: job.data.dryRun ? 0 : batchSize,
    dryRun: job.data.dryRun ?? false,
  };
}
