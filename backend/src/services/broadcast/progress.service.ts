import { withRedisClient } from "@/services/redis.service";
import { logger } from "@/utils/logger";

const PROGRESS_KEY_PREFIX = "broadcast:progress";
const PROGRESS_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export interface BroadcastProgressSnapshot {
  campaignId: string;
  status: "initializing" | "sending" | "completed" | "failed";
  progress: number;
  processed: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
  updated_at: string;
}

function buildKey(campaignId: string) {
  return `${PROGRESS_KEY_PREFIX}:${campaignId}`;
}

export async function saveBroadcastProgress(
  campaignId: string,
  snapshot: Omit<BroadcastProgressSnapshot, "updated_at"> & Partial<Pick<BroadcastProgressSnapshot, "updated_at">>,
): Promise<BroadcastProgressSnapshot> {
  const payload: BroadcastProgressSnapshot = {
    ...snapshot,
    campaignId,
    updated_at: snapshot.updated_at ?? new Date().toISOString(),
  };

  try {
    await withRedisClient((client) => client.setEx(buildKey(campaignId), PROGRESS_TTL_SECONDS, JSON.stringify(payload)));
  } catch (error) {
    logger.error("Failed to persist broadcast progress", { campaignId, error });
  }

  return payload;
}

export async function readBroadcastProgress(campaignId: string): Promise<BroadcastProgressSnapshot | null> {
  try {
    const raw = await withRedisClient((client) => client.get(buildKey(campaignId)));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as BroadcastProgressSnapshot;
  } catch (error) {
    logger.error("Failed to read broadcast progress", { campaignId, error });
    return null;
  }
}

export async function clearBroadcastProgress(campaignId: string) {
  try {
    await withRedisClient((client) => client.del(buildKey(campaignId)));
  } catch (error) {
    logger.error("Failed to clear broadcast progress", { campaignId, error });
  }
}
