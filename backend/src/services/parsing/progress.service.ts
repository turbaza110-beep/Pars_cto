import { withRedisClient } from "@/services/redis.service";
import { ParsingProgressSnapshot } from "@/types/parsing";
import { logger } from "@/utils/logger";

const PROGRESS_KEY_PREFIX = "parsing:progress";
const PROGRESS_TTL_SECONDS = 60 * 60 * 6; // 6 hours

function buildKey(searchId: string) {
  return `${PROGRESS_KEY_PREFIX}:${searchId}`;
}

export async function saveParsingProgress(
  searchId: string,
  snapshot: Omit<ParsingProgressSnapshot, "updated_at"> & Partial<Pick<ParsingProgressSnapshot, "updated_at">>,
): Promise<ParsingProgressSnapshot> {
  const payload: ParsingProgressSnapshot = {
    ...snapshot,
    searchId,
    updated_at: snapshot.updated_at ?? new Date().toISOString(),
  };

  try {
    await withRedisClient((client) => client.setEx(buildKey(searchId), PROGRESS_TTL_SECONDS, JSON.stringify(payload)));
  } catch (error) {
    logger.error("Failed to persist parsing progress", { searchId, error });
  }

  return payload;
}

export async function readParsingProgress(searchId: string): Promise<ParsingProgressSnapshot | null> {
  try {
    const raw = await withRedisClient((client) => client.get(buildKey(searchId)));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as ParsingProgressSnapshot;
  } catch (error) {
    logger.error("Failed to read parsing progress", { searchId, error });
    return null;
  }
}

export async function clearParsingProgress(searchId: string) {
  try {
    await withRedisClient((client) => client.del(buildKey(searchId)));
  } catch (error) {
    logger.error("Failed to clear parsing progress", { searchId, error });
  }
}
