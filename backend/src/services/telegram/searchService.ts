import { createHash } from "node:crypto";

import { Api } from "telegram";

import { config } from "@/config/config";
import { ensureTelegramClient } from "@/services/telegram.service";
import { NormalizedParsingFilters, ParsedChannel, SearchMode } from "@/types/parsing";
import { logger } from "@/utils/logger";

const SUPPORTED_LANGUAGES = ["en", "ru", "es", "de", "fr", "pt", "tr", "vi", "id", "ar"] as const;

interface SearchChannelsOptions {
  mode?: SearchMode;
  limit?: number;
}

const TERMINAL_RANDOM_DIVISOR = 0xffffffff;

function pseudoRandom(seed: string, salt: string) {
  const hash = createHash("sha256").update(`${seed}:${salt}`).digest();
  return hash.readUInt32BE(0) / TERMINAL_RANDOM_DIVISOR;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "channel";
}

function capitalize(value: string) {
  if (!value) {
    return "Channel";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function resolveMode(mode?: SearchMode): SearchMode {
  if (mode) {
    return mode;
  }

  return config.nodeEnv === "production" ? "live" : "simulation";
}

function selectLanguage(seed: string, preferred?: string | null) {
  if (preferred) {
    return preferred.toLowerCase();
  }

  const index = Math.floor(pseudoRandom(seed, "lang") * SUPPORTED_LANGUAGES.length);
  return SUPPORTED_LANGUAGES[index] ?? "en";
}

function scoreToActivityLevel(score: number) {
  if (score >= 0.66) {
    return "high" as const;
  }

  if (score >= 0.33) {
    return "medium" as const;
  }

  return "low" as const;
}

function matchesFilters(channel: ParsedChannel, filters?: NormalizedParsingFilters) {
  if (!filters) {
    return true;
  }

  if (filters.language && channel.language && channel.language.toLowerCase() !== filters.language.toLowerCase()) {
    return false;
  }

  if (filters.language && !channel.language) {
    return false;
  }

  if (typeof filters.minSubscribers === "number" && channel.subscribers < filters.minSubscribers) {
    return false;
  }

  if (typeof filters.maxSubscribers === "number" && channel.subscribers > filters.maxSubscribers) {
    return false;
  }

  if (filters.activityLevel && channel.activityLevel !== filters.activityLevel) {
    return false;
  }

  return true;
}

function calculateActivityScore(subscribers: number, lastPost?: string | null) {
  const subscriberFactor = Math.min(Math.max(subscribers, 0) / 1_000_000, 1);
  let recencyFactor = 0.4;

  if (lastPost) {
    const lastPostTime = new Date(lastPost).getTime();
    if (!Number.isNaN(lastPostTime)) {
      const hoursSince = Math.max(0, (Date.now() - lastPostTime) / (1000 * 60 * 60));
      const normalizedHours = Math.min(hoursSince, 168) / 168; // within last week
      recencyFactor = 1 - normalizedHours;
    }
  }

  return Number(((subscriberFactor * 0.6 + recencyFactor * 0.4)).toFixed(2));
}

function buildSimulatedChannel(
  query: string,
  index: number,
  filters?: NormalizedParsingFilters,
): ParsedChannel {
  const normalizedQuery = query.trim().toLowerCase() || "channel";
  const seed = `${normalizedQuery}:${index}`;
  const subscribers = Math.max(250, Math.floor(pseudoRandom(seed, "subs") * 500_000));
  const language = selectLanguage(seed, filters?.language ?? null);
  const activityScore = Number(pseudoRandom(seed, "activity").toFixed(2));
  const daysAgo = Math.floor(pseudoRandom(seed, "recency") * 14);
  const lastPost = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  return {
    channelId: `sim-${index + 1}`,
    title: `${capitalize(normalizedQuery)} Hub ${index + 1}`,
    username: `@${slugify(normalizedQuery)}_${index + 1}`,
    subscribers,
    description: `Simulated insights about ${query} (#${index + 1})`,
    language,
    activityScore,
    activityLevel: scoreToActivityLevel(activityScore),
    lastPost,
  };
}

async function performLiveChannelSearch(
  query: string,
  filters: NormalizedParsingFilters | undefined,
  limit: number,
): Promise<ParsedChannel[]> {
  const client = await ensureTelegramClient();
  const response = await client.invoke(
    new Api.contacts.Search({
      q: query,
      limit,
    }),
  );

  const chats = Array.isArray(response.chats) ? response.chats : [];
  const channels: ParsedChannel[] = [];

  for (const chat of chats) {
    if (!(chat instanceof Api.Channel)) {
      continue;
    }

    let memberCount = Number((chat as { participantsCount?: number }).participantsCount ?? 0);
    let description: string | null = chat.username ?? null;
    let lastPost: string | null = null;

    if (chat.accessHash) {
      try {
        const fullChannel = await client.invoke(
          new Api.channels.GetFullChannel({
            channel: new Api.InputChannel({
              channelId: chat.id,
              accessHash: chat.accessHash,
            }),
          }),
        );

        if (fullChannel.fullChat instanceof Api.ChannelFull) {
          memberCount = Number(fullChannel.fullChat.participantsCount ?? memberCount);
          description = fullChannel.fullChat.about ?? description;
          if (fullChannel.fullChat.readInboxMaxId) {
            lastPost = new Date().toISOString();
          }
        }
      } catch (error) {
        logger.warn("Failed to fetch channel details", { channelId: chat.id, error });
      }
    }

    const activityScore = calculateActivityScore(memberCount, lastPost);
    const channel: ParsedChannel = {
      channelId: chat.id.toString(),
      title: chat.title ?? capitalize(query),
      username: chat.username ? `@${chat.username}` : null,
      subscribers: memberCount,
      description,
      language: filters?.language ?? null,
      activityScore,
      activityLevel: scoreToActivityLevel(activityScore),
      lastPost,
    };

    if (!matchesFilters(channel, filters)) {
      continue;
    }

    channels.push(channel);

    if (channels.length >= limit) {
      break;
    }
  }

  return channels;
}

function simulateChannelSearch(query: string, filters: NormalizedParsingFilters | undefined, limit: number): ParsedChannel[] {
  const results: ParsedChannel[] = [];
  let index = 0;

  while (results.length < limit && index < limit * 3) {
    const channel = buildSimulatedChannel(query, index, filters);
    if (matchesFilters(channel, filters)) {
      results.push(channel);
    }
    index += 1;
  }

  return results.slice(0, limit);
}

export async function searchTelegramChannels(
  query: string,
  filters?: NormalizedParsingFilters,
  options?: SearchChannelsOptions,
): Promise<ParsedChannel[]> {
  const mode = resolveMode(options?.mode);
  const limit = Math.min(Math.max(options?.limit ?? 50, 5), 200);

  if (mode === "live") {
    try {
      return await performLiveChannelSearch(query, filters, limit);
    } catch (error) {
      logger.error("Live Telegram search failed, falling back to simulation", { error });
      return simulateChannelSearch(query, filters, limit);
    }
  }

  return simulateChannelSearch(query, filters, limit);
}
