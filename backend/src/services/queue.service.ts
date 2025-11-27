import { initializeQueues } from "@/queue/queueManager";
import { logger } from "@/utils/logger";
import { startWorkers, stopWorkers } from "@/workers";

let queuesBootstrapped = false;

export async function bootstrapQueues() {
  if (queuesBootstrapped) {
    return;
  }

  await initializeQueues();
  await startWorkers();
  queuesBootstrapped = true;
  logger.info("Redis and Bull queues bootstrapped");
}

export async function shutdownQueues() {
  if (!queuesBootstrapped) {
    return;
  }

  await stopWorkers();
  queuesBootstrapped = false;
  logger.info("Queues shutdown complete");
}
