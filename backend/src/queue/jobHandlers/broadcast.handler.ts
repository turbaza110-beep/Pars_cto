import { Job } from "bull";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { config } from "@/config/config";
import { BroadcastJob } from "@/jobs/broadcastJob";
import {
  startCampaign,
  updateCampaignStatus,
  logBroadcastOutcome,
} from "@/services/broadcast/broadcast.service";
import { saveBroadcastProgress, clearBroadcastProgress } from "@/services/broadcast/progress.service";
import { AntiSpamService } from "@/services/broadcast/antiSpam.service";
import { TelegramSessionManager } from "@/services/telegram/sessionManager";
import { logger } from "@/utils/logger";

interface TelegramError extends Error {
  errorMessage?: string;
  code?: number;
}

type TelegramErrorType =
  | "PEER_ID_INVALID"
  | "USER_RESTRICTED"
  | "USER_IS_BOT"
  | "FLOOD_WAIT"
  | "SESSION_EXPIRED"
  | "CHAT_WRITE_FORBIDDEN"
  | "UNKNOWN";

interface ErrorClassification {
  type: TelegramErrorType;
  isPermanent: boolean;
  isFloodWait: boolean;
  floodWaitSeconds?: number;
}

function classifyTelegramError(error: unknown): ErrorClassification {
  const err = error as TelegramError;
  const errorMessage = err.errorMessage || err.message || "";

  if (errorMessage.includes("FLOOD_WAIT")) {
    const match = errorMessage.match(/FLOOD_WAIT_(\d+)/);
    return {
      type: "FLOOD_WAIT",
      isPermanent: false,
      isFloodWait: true,
      floodWaitSeconds: match ? parseInt(match[1], 10) : 30,
    };
  }

  if (errorMessage.includes("PEER_ID_INVALID")) {
    return { type: "PEER_ID_INVALID", isPermanent: true, isFloodWait: false };
  }

  if (errorMessage.includes("USER_RESTRICTED")) {
    return { type: "USER_RESTRICTED", isPermanent: true, isFloodWait: false };
  }

  if (errorMessage.includes("USER_IS_BOT")) {
    return { type: "USER_IS_BOT", isPermanent: true, isFloodWait: false };
  }

  if (errorMessage.includes("SESSION_EXPIRED") || errorMessage.includes("AUTH_KEY_UNREGISTERED")) {
    return { type: "SESSION_EXPIRED", isPermanent: false, isFloodWait: false };
  }

  if (errorMessage.includes("CHAT_WRITE_FORBIDDEN")) {
    return { type: "CHAT_WRITE_FORBIDDEN", isPermanent: true, isFloodWait: false };
  }

  return { type: "UNKNOWN", isPermanent: false, isFloodWait: false };
}

async function updateProgress(
  job: Job<BroadcastJob>,
  campaignId: string,
  status: "initializing" | "sending" | "completed" | "failed",
  processed: number,
  total: number,
  sent: number,
  failed: number,
  skipped: number,
  error?: string,
) {
  const progress = total > 0 ? Math.round((processed / total) * 100) : 0;
  await job.progress(progress);
  await saveBroadcastProgress(campaignId, {
    status,
    progress,
    processed,
    total,
    sent,
    failed,
    skipped,
    error,
  });
}

async function sendMessageToRecipient(
  client: TelegramClient,
  recipient: string,
  text: string,
  attachments?: string[],
): Promise<void> {
  try {
    // Parse recipient - could be user ID, username, or entity
    let entity;

    if (recipient.startsWith("@")) {
      entity = await client.getInputEntity(recipient);
    } else if (!isNaN(Number(recipient))) {
      entity = parseInt(recipient, 10);
    } else {
      entity = recipient;
    }

    // Send the message
    await client.sendMessage(entity, {
      message: text,
      parseMode: "HTML",
    });
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to send message to ${recipient}: ${err.message}`);
  }
}

export async function handleBroadcastJob(job: Job<BroadcastJob>) {
  const { campaignId, userId, recipients, text, attachments, telegramSessionId } = job.data;

  logger.info("Broadcast job started", {
    jobId: job.id,
    campaignId,
    userId,
    recipientCount: recipients.length,
  });

  try {
    // Start campaign
    await startCampaign({ campaignId });
    await updateProgress(job, campaignId, "initializing", 0, recipients.length, 0, 0, 0);

    // Restore Telegram session
    const sessionManager = new TelegramSessionManager();
    const sessionData = await sessionManager.restoreSession(userId);

    if (!sessionData) {
      throw new Error("No Telegram session found for user");
    }

    // Create Telegram client
    const session = new StringSession(sessionData.sessionString);
    const client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    const antiSpam = new AntiSpamService({
      accountAge: sessionData.lastUsedAt ? Math.floor((Date.now() - sessionData.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0,
    });

    let processed = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let shouldRetry = false;

    await updateProgress(job, campaignId, "sending", 0, recipients.length, sent, failed, skipped);

    for (const recipient of recipients) {
      processed += 1;

      try {
        const delay = antiSpam.calculateDelay();
        await new Promise((resolve) => setTimeout(resolve, delay));

        await sendMessageToRecipient(client, recipient, text, attachments);

        antiSpam.recordSuccess();
        sent += 1;

        await logBroadcastOutcome({
          campaignId,
          userId,
          recipient,
          status: "sent",
        });

        logger.debug("Message sent successfully", { campaignId, recipient });
      } catch (error) {
        const err = error as Error;
        const classification = classifyTelegramError(error);

        logger.warn("Failed to send message", {
          campaignId,
          recipient,
          error: err.message,
          classification,
        });

        if (classification.isPermanent) {
          skipped += 1;
          await logBroadcastOutcome({
            campaignId,
            userId,
            recipient,
            status: "skipped",
            errorMessage: `Permanent error: ${classification.type}`,
            metadata: { errorType: classification.type },
          });
        } else {
          failed += 1;
          shouldRetry = true;

          await logBroadcastOutcome({
            campaignId,
            userId,
            recipient,
            status: "failed",
            errorMessage: `Retryable error: ${classification.type}`,
            metadata: { errorType: classification.type },
          });

          antiSpam.recordFailure();

          if (classification.isFloodWait && classification.floodWaitSeconds) {
            const waitTime = classification.floodWaitSeconds * 1000;
            logger.info("FLOOD_WAIT received, waiting", { campaignId, waitTime });
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      }

      await updateProgress(
        job,
        campaignId,
        "sending",
        processed,
        recipients.length,
        sent,
        failed,
        skipped,
      );
    }

    await client.disconnect();

    const failureRate = sent + failed > 0 ? failed / (sent + failed) : 0;
    const failureThreshold = 0.5; // 50% failure rate threshold

    if (failureRate > failureThreshold) {
      logger.error("Broadcast failed due to high failure rate", {
        campaignId,
        sent,
        failed,
        failureRate,
      });

      await updateCampaignStatus({
        campaignId,
        status: "failed",
        lastSentAt: new Date(),
        metadata: {
          sent,
          failed,
          skipped,
          failureRate: Math.round(failureRate * 100),
          error: "High failure rate threshold exceeded",
        },
      });

      await updateProgress(
        job,
        campaignId,
        "failed",
        recipients.length,
        recipients.length,
        sent,
        failed,
        skipped,
        `Failed: ${failureRate * 100}% failure rate`,
      );

      if (shouldRetry) {
        throw new Error("Broadcast failed with retryable errors; will retry");
      }

      return {
        campaignId,
        sent,
        failed,
        skipped,
        success: false,
      };
    }

    // Mark as completed
    await updateCampaignStatus({
      campaignId,
      status: "completed",
      lastSentAt: new Date(),
      metadata: {
        sent,
        failed,
        skipped,
        totalRecipients: recipients.length,
      },
    });

    await updateProgress(
      job,
      campaignId,
      "completed",
      recipients.length,
      recipients.length,
      sent,
      failed,
      skipped,
    );

    await clearBroadcastProgress(campaignId);

    logger.info("Broadcast job completed", {
      jobId: job.id,
      campaignId,
      sent,
      failed,
      skipped,
    });

    return {
      campaignId,
      sent,
      failed,
      skipped,
      success: true,
    };
  } catch (error) {
    const err = error as Error;
    logger.error("Broadcast job failed", {
      jobId: job.id,
      campaignId,
      error: err.message,
      stack: err.stack,
    });

    await updateCampaignStatus({
      campaignId,
      status: "failed",
      metadata: { error: err.message },
    });

    await updateProgress(
      job,
      campaignId,
      "failed",
      recipients.length,
      recipients.length,
      0,
      0,
      recipients.length,
      err.message,
    );

    throw error;
  }
}
