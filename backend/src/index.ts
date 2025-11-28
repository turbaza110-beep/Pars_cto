import { createServer } from "./server";

import { config } from "@/config/config";
import { startCronJobs, stopCronJobs } from "@/services/cron/cronScheduler";
import { bootstrapQueues, shutdownQueues } from "@/services/queue.service";
import { ensureTelegramClient } from "@/services/telegram.service";
import { connectDatastores, disconnectDatastores } from "@/utils/clients";
import { logger } from "@/utils/logger";

async function start() {
  try {
    await connectDatastores();
    await bootstrapQueues();
    startCronJobs();

    if (config.telegram.apiId && config.telegram.apiHash) {
      await ensureTelegramClient();
    }

    const server = await createServer();
    const desiredPort = config.server.port;
    const fallbackPort = desiredPort === 3000 ? 3001 : undefined;
    let activePort = desiredPort;

    try {
      await server.listen({ port: desiredPort, host: config.server.host });
    } catch (listenError) {
      const errorWithCode = listenError as NodeJS.ErrnoException;
      if (errorWithCode.code === "EADDRINUSE" && fallbackPort) {
        logger.warn(`Port ${desiredPort} is in use, falling back to ${fallbackPort}`);
        activePort = fallbackPort;
        await server.listen({ port: fallbackPort, host: config.server.host });
      } else {
        throw listenError;
      }
    }

    logger.info(`Backend listening on http://${config.server.host}:${activePort}`);

    const shutdown = async (signal?: string) => {
      logger.info("Received shutdown signal", { signal });
      try {
        await server.close();
        stopCronJobs();
        await shutdownQueues();
        await disconnectDatastores();
        logger.info("Cleanup complete, exiting process");
        process.exit(0);
      } catch (error) {
        logger.error("Failed to gracefully shut down", { error });
        process.exit(1);
      }
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  } catch (error) {
    logger.error("Failed to start backend", { error });
    stopCronJobs();
    await shutdownQueues().catch((queueError) => {
      logger.error("Failed to stop queues after startup failure", { queueError });
    });
    await disconnectDatastores().catch((disconnectError) => {
      logger.error("Failed to clean up resources after startup failure", { disconnectError });
    });
    process.exit(1);
  }
}

void start();
