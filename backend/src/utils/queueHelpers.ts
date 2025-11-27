import { JobsOptions } from "bull";

import { JobPayloadMap, JobTypes } from "@/jobs/jobTypes";
import { getQueue, initializeQueues } from "@/queue/queueManager";
import { logger } from "@/utils/logger";

export async function addJob<T extends JobTypes>(jobType: T, payload: JobPayloadMap[T], options?: JobsOptions) {
  await initializeQueues();
  const queue = getQueue(jobType);
  const job = await queue.add(jobType, payload, options);
  logger.info("Job added to queue", { jobType, jobId: job.id });
  return job;
}

export async function getJobProgress<T extends JobTypes>(jobType: T, jobId: string) {
  await initializeQueues();
  const queue = getQueue(jobType);
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const [state, progress] = await Promise.all([job.getState(), job.progress()]);

  return {
    jobId: job.id,
    state,
    progress,
    attemptsMade: job.attemptsMade,
  };
}

export async function retryJob<T extends JobTypes>(jobType: T, jobId: string) {
  await initializeQueues();
  const queue = getQueue(jobType);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new Error(`Job ${jobId} was not found in ${jobType} queue`);
  }

  await job.retry();
  logger.warn("Job retry requested", { jobType, jobId });
  return job;
}

export async function cancelJob<T extends JobTypes>(jobType: T, jobId: string) {
  await initializeQueues();
  const queue = getQueue(jobType);
  const job = await queue.getJob(jobId);

  if (!job) {
    return false;
  }

  await job.remove();
  logger.warn("Job removed from queue", { jobType, jobId });
  return true;
}
