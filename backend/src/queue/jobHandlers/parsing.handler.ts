import { Job } from "bull";

import { ParseSearchJob } from "@/jobs/parseSearchJob";
import { persistParsedChannels, markParsingStatus } from "@/services/parsing/parsing.service";
import { saveParsingProgress } from "@/services/parsing/progress.service";
import { incrementParsingUsage } from "@/services/parsing/usage.service";
import { searchTelegramChannels } from "@/services/telegram/searchService";
import { logger } from "@/utils/logger";

async function updateProgress(
  job: Job<ParseSearchJob>,
  searchId: string,
  status: "pending" | "initializing" | "scanning_channels" | "analyzing_data" | "completed" | "failed",
  progress: number,
  extra?: Record<string, unknown>,
) {
  await job.progress(progress);
  await saveParsingProgress(searchId, {
    status,
    progress,
    ...extra,
  });
}

export async function handleParsingJob(job: Job<ParseSearchJob>) {
  const { requestId, searchId, userId, query, filters, mode } = job.data;

  logger.info("Parsing job started", { jobId: job.id, requestId, query, searchId, userId, mode });

  await markParsingStatus(searchId, "processing", { metadataPatch: { started_at: new Date().toISOString() } });
  await updateProgress(job, searchId, "initializing", 5, { current: 0, total: 0 });

  try {
    const channels = await searchTelegramChannels(query, filters, { mode, limit: 100 });
    await updateProgress(job, searchId, "scanning_channels", 55, {
      current: channels.length,
      total: channels.length,
    });

    const savedCount = await persistParsedChannels(searchId, channels);
    await updateProgress(job, searchId, "analyzing_data", 80, {
      current: savedCount,
      total: channels.length,
    });

    await markParsingStatus(searchId, "completed", {
      resultCount: savedCount,
      errorMessage: null,
      metadataPatch: { completed_at: new Date().toISOString() },
    });

    await incrementParsingUsage(userId, 1);

    await updateProgress(job, searchId, "completed", 100, {
      results: savedCount,
      current: savedCount,
      total: channels.length,
    });

    logger.info("Parsing job finished", { jobId: job.id, requestId, searchId, savedCount });

    return {
      searchId,
      results: savedCount,
      mode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parsing error";

    await markParsingStatus(searchId, "failed", {
      errorMessage: message,
      metadataPatch: { failed_at: new Date().toISOString() },
    });

    await updateProgress(job, searchId, "failed", 100, { error: message });

    logger.error("Parsing job failed", { jobId: job.id, requestId, searchId, error });
    throw error;
  }
}
