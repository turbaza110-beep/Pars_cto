import cron from "node-cron";
import { logger } from "@/utils/logger";
import { runSubscriptionExpirationCheck } from "./jobs/subscriptionExpiration";
import { runSubscriptionCleanup } from "./jobs/subscriptionCleanup";
import { runPaymentCheck } from "./jobs/paymentCheck";
import { runErrorLogCleanup } from "./jobs/errorLogCleanup";

type CronTask = cron.ScheduledTask;

const scheduledTasks: CronTask[] = [];
let isSchedulerRunning = false;

export function startCronJobs() {
  if (isSchedulerRunning) {
    logger.warn("Cron scheduler is already running");
    return;
  }

  logger.info("Starting cron scheduler");

  const subscriptionExpirationTask = cron.schedule(
    "0 1 * * *",
    async () => {
      logger.info("Cron job triggered: subscription expiration check");
      try {
        await runSubscriptionExpirationCheck();
      } catch (error) {
        logger.error("Subscription expiration check failed with unhandled error", { error });
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    },
  );

  const subscriptionCleanupTask = cron.schedule(
    "0 2 * * *",
    async () => {
      logger.info("Cron job triggered: subscription cleanup");
      try {
        await runSubscriptionCleanup();
      } catch (error) {
        logger.error("Subscription cleanup failed with unhandled error", { error });
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    },
  );

  const errorLogCleanupTask = cron.schedule(
    "0 3 * * *",
    async () => {
      logger.info("Cron job triggered: error log cleanup");
      try {
        await runErrorLogCleanup();
      } catch (error) {
        logger.error("Error log cleanup failed with unhandled error", { error });
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    },
  );

  const paymentCheckTask = cron.schedule(
    "*/5 * * * *",
    async () => {
      logger.debug("Cron job triggered: payment check");
      try {
        await runPaymentCheck();
      } catch (error) {
        logger.error("Payment check failed with unhandled error", { error });
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    },
  );

  scheduledTasks.push(subscriptionExpirationTask, subscriptionCleanupTask, errorLogCleanupTask, paymentCheckTask);

  isSchedulerRunning = true;
  logger.info("Cron scheduler started with 4 jobs", {
    jobs: [
      { name: "subscription_expiration", schedule: "0 1 * * *", timezone: "UTC" },
      { name: "subscription_cleanup", schedule: "0 2 * * *", timezone: "UTC" },
      { name: "error_log_cleanup", schedule: "0 3 * * *", timezone: "UTC" },
      { name: "payment_check", schedule: "*/5 * * * *", timezone: "UTC" },
    ],
  });
}

export function stopCronJobs() {
  if (!isSchedulerRunning) {
    logger.warn("Cron scheduler is not running");
    return;
  }

  logger.info("Stopping cron scheduler");

  for (const task of scheduledTasks) {
    task.stop();
  }

  scheduledTasks.length = 0;
  isSchedulerRunning = false;

  logger.info("Cron scheduler stopped");
}

export function isRunning(): boolean {
  return isSchedulerRunning;
}
