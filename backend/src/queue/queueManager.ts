import Queue, { QueueOptions } from "bull";

import { config } from "@/config/config";
import { JobPayloadMap, JobTypes } from "@/jobs/jobTypes";
import { logger } from "@/utils/logger";

type QueueRegistry = {
  [JobTypes.PARSE_SEARCH]: Queue<JobPayloadMap[JobTypes.PARSE_SEARCH]>;
  [JobTypes.BROADCAST]: Queue<JobPayloadMap[JobTypes.BROADCAST]>;
  [JobTypes.NOTIFICATION]: Queue<JobPayloadMap[JobTypes.NOTIFICATION]>;
  [JobTypes.CLEANUP_DATA]: Queue<JobPayloadMap[JobTypes.CLEANUP_DATA]>;
  [JobTypes.AUDIENCE_SEGMENT]: Queue<JobPayloadMap[JobTypes.AUDIENCE_SEGMENT]>;
};

let queues: QueueRegistry | null = null;

const baseQueueOptions: QueueOptions = {
  prefix: "love-parser",
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

const redisConnectionString = config.redis.url;

function attachEventListeners<T>(queue: Queue<T>, jobType: JobTypes) {
  queue.on("progress", (job, progress) => {
    logger.debug(`Job progress updated`, { jobType, jobId: job.id, progress });
  });

  queue.on("completed", (job, result) => {
    logger.info(`Job completed`, { jobType, jobId: job.id, result });
  });

  queue.on("failed", (job, error) => {
    logger.error(`Job failed`, { jobType, jobId: job?.id, error });
  });
}

function createQueue<T>(queueName: string, jobType: JobTypes) {
  const queue = new Queue<T>(queueName, redisConnectionString, {
    ...baseQueueOptions,
    defaultJobOptions: { ...baseQueueOptions.defaultJobOptions },
  });
  void queue.isReady();
  attachEventListeners(queue, jobType);
  return queue;
}

export async function initializeQueues() {
  if (queues) {
    return queues;
  }

  queues = {
    [JobTypes.PARSE_SEARCH]: createQueue<JobPayloadMap[JobTypes.PARSE_SEARCH]>("parsing", JobTypes.PARSE_SEARCH),
    [JobTypes.BROADCAST]: createQueue<JobPayloadMap[JobTypes.BROADCAST]>("broadcast", JobTypes.BROADCAST),
    [JobTypes.NOTIFICATION]: createQueue<JobPayloadMap[JobTypes.NOTIFICATION]>("notifications", JobTypes.NOTIFICATION),
    [JobTypes.CLEANUP_DATA]: createQueue<JobPayloadMap[JobTypes.CLEANUP_DATA]>("cleanup", JobTypes.CLEANUP_DATA),
    [JobTypes.AUDIENCE_SEGMENT]: createQueue<JobPayloadMap[JobTypes.AUDIENCE_SEGMENT]>("audience", JobTypes.AUDIENCE_SEGMENT),
  } satisfies QueueRegistry;

  await Promise.all(Object.values(queues).map((queue) => queue.isReady()));
  logger.info("Bull queues initialized");
  return queues;
}

export function getQueue<T extends JobTypes>(jobType: T): Queue<JobPayloadMap[T]> {
  if (!queues) {
    throw new Error("Queues have not been initialized");
  }

  return queues[jobType] as Queue<JobPayloadMap[T]>;
}

export async function closeQueues() {
  if (!queues) {
    return;
  }

  const queueEntries = Object.values(queues);
  await Promise.all(
    queueEntries.map(async (queue) => {
      try {
        await queue.close();
      } catch (error) {
        logger.error("Failed to close queue", { error });
      }
    }),
  );

  queues = null;
  logger.info("Bull queues shut down");
}
