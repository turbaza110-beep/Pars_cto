import { JobTypes } from "@/jobs/jobTypes";
import { handleAudienceJob } from "@/queue/jobHandlers/audience.handler";
import { handleBroadcastJob } from "@/queue/jobHandlers/broadcast.handler";
import { handleCleanupJob } from "@/queue/jobHandlers/cleanup.handler";
import { handleNotificationJob } from "@/queue/jobHandlers/notification.handler";
import { handleParsingJob } from "@/queue/jobHandlers/parsing.handler";
import { closeQueues, getQueue, initializeQueues } from "@/queue/queueManager";
import { logger } from "@/utils/logger";

let workersRunning = false;

export async function startWorkers() {
  if (workersRunning) {
    return;
  }

  await initializeQueues();

  getQueue(JobTypes.PARSE_SEARCH).process(handleParsingJob);
  getQueue(JobTypes.BROADCAST).process(handleBroadcastJob);
  getQueue(JobTypes.NOTIFICATION).process(handleNotificationJob);
  getQueue(JobTypes.CLEANUP_DATA).process(handleCleanupJob);
  getQueue(JobTypes.AUDIENCE_SEGMENT).process(handleAudienceJob);

  workersRunning = true;
  logger.info("Bull workers initialized");
}

export async function stopWorkers() {
  if (!workersRunning) {
    return;
  }

  await closeQueues();
  workersRunning = false;
  logger.info("Bull workers stopped");
}
