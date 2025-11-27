import { Job } from "bull";

import { AudienceSegmentJob } from "@/jobs/audienceJob";
import { calculateTotalRecipients, getSegment } from "@/services/audience/audienceService";
import { invalidateDashboardCache } from "@/services/dashboard/dashboard.service";
import { pgPool } from "@/utils/clients";
import { logger } from "@/utils/logger";

async function persistSegmentTotals(segmentId: string, userId: string, totalRecipients: number, status: "ready" | "failed") {
  await pgPool.query(
    `UPDATE audience_segments
     SET total_recipients = $3,
         status = $4,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [segmentId, userId, totalRecipients, status],
  );
}

export async function handleAudienceJob(job: Job<AudienceSegmentJob>) {
  const { segmentId, userId } = job.data;
  logger.info("Audience segment job started", { jobId: job.id, segmentId, userId });

  try {
    await job.progress(10);
    const segment = await getSegment(userId, segmentId);

    if (!segment.sourceParsingId) {
      await persistSegmentTotals(segmentId, userId, 0, "failed");
      await job.progress(100);
      logger.warn("Audience segment is missing parsing source", { segmentId, userId });
      return { segmentId, totalRecipients: 0 };
    }

    const totalRecipients = await calculateTotalRecipients({
      userId,
      sourceParsingId: segment.sourceParsingId,
      filters: segment.filters,
    });

    await job.progress(70);
    await persistSegmentTotals(segmentId, userId, totalRecipients, "ready");
    await invalidateDashboardCache(userId);
    await job.progress(100);

    logger.info("Audience segment job completed", { jobId: job.id, segmentId, totalRecipients });
    return { segmentId, totalRecipients };
  } catch (error) {
    logger.error("Audience segment job failed", { jobId: job.id, segmentId, userId, error });
    await persistSegmentTotals(segmentId, userId, 0, "failed");
    throw error;
  }
}
