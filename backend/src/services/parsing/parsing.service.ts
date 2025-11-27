import { ParsedChannel, NormalizedParsingFilters, ParsingHistoryEntry, ParsingStatus, SearchMode } from "@/types/parsing";
import { pgPool } from "@/utils/clients";
import { logger } from "@/utils/logger";

interface ParsingHistoryRow {
  id: string;
  user_id: string;
  query: string;
  status: ParsingStatus;
  result_count: number;
  metadata: unknown;
  created_at: Date;
  error_message?: string | null;
}

interface ParsedChannelRow {
  channel_id: string;
  title: string | null;
  username: string | null;
  member_count: number;
  metadata: unknown;
  created_at: Date;
}

interface UsageMetadata {
  filters?: Record<string, unknown>;
  mode?: SearchMode;
  jobId?: string | number;
  [key: string]: unknown;
}

export interface PaginatedParsedChannels {
  total: number;
  page: number;
  limit: number;
  results: ParsedChannel[];
}

function safeParseJson<T>(value: unknown): T | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "object") {
    return value as T;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn("Failed to parse JSON column", { error });
    }
  }

  return undefined;
}

function extractFilters(metadata: unknown): NormalizedParsingFilters | undefined {
  const parsed = safeParseJson<UsageMetadata>(metadata);
  if (!parsed?.filters || typeof parsed.filters !== "object") {
    return undefined;
  }

  const filtersRaw = parsed.filters as Record<string, unknown>;
  const filters: NormalizedParsingFilters = {};

  if (typeof filtersRaw.language === "string" && filtersRaw.language.trim().length > 0) {
    filters.language = filtersRaw.language.trim();
  }

  const minValue = (filtersRaw.minSubscribers ?? filtersRaw.min_subscribers) as number | undefined;
  if (typeof minValue === "number" && Number.isFinite(minValue)) {
    filters.minSubscribers = minValue;
  }

  const maxValue = (filtersRaw.maxSubscribers ?? filtersRaw.max_subscribers) as number | undefined;
  if (typeof maxValue === "number" && Number.isFinite(maxValue)) {
    filters.maxSubscribers = maxValue;
  }

  const activityLevel = (filtersRaw.activityLevel ?? filtersRaw.activity_level) as NormalizedParsingFilters["activityLevel"];
  if (activityLevel === "low" || activityLevel === "medium" || activityLevel === "high") {
    filters.activityLevel = activityLevel;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function mapHistoryRow(row: ParsingHistoryRow): ParsingHistoryEntry {
  return {
    id: row.id,
    query: row.query,
    status: row.status,
    resultCount: Number(row.result_count ?? 0),
    createdAt: row.created_at.toISOString(),
    filters: extractFilters(row.metadata),
  };
}

function buildChannelMetadata(channel: ParsedChannel) {
  return {
    description: channel.description ?? null,
    activityScore: channel.activityScore,
    activityLevel: channel.activityLevel,
    lastPost: channel.lastPost ?? null,
    language: channel.language ?? null,
  } satisfies Record<string, unknown>;
}

function mapChannelRow(row: ParsedChannelRow): ParsedChannel {
  const metadata = safeParseJson<ReturnType<typeof buildChannelMetadata>>(row.metadata) ?? {};
  const activityScoreRaw = typeof metadata.activityScore === "number" ? metadata.activityScore : Number(metadata.activityScore ?? 0);
  const activityScore = Number.isFinite(activityScoreRaw) ? Number(activityScoreRaw) : 0;

  let activityLevel = metadata.activityLevel;
  if (activityLevel !== "low" && activityLevel !== "medium" && activityLevel !== "high") {
    if (activityScore >= 0.66) {
      activityLevel = "high";
    } else if (activityScore >= 0.33) {
      activityLevel = "medium";
    } else {
      activityLevel = "low";
    }
  }

  return {
    channelId: row.channel_id,
    title: row.title,
    username: row.username,
    subscribers: Number(row.member_count ?? 0),
    description: typeof metadata.description === "string" ? metadata.description : null,
    language: typeof metadata.language === "string" ? metadata.language : null,
    activityScore: Number(activityScore.toFixed(2)),
    activityLevel,
    lastPost: typeof metadata.lastPost === "string" ? metadata.lastPost : null,
  };
}

export async function createParsingSearch(
  userId: string,
  query: string,
  filters: NormalizedParsingFilters | undefined,
  mode: SearchMode,
): Promise<ParsingHistoryEntry> {
  const metadata: UsageMetadata = { mode };
  if (filters && Object.keys(filters).length > 0) {
    metadata.filters = filters;
  }

  const result = await pgPool.query<ParsingHistoryRow>(
    `INSERT INTO parsing_history (user_id, query, status, metadata)
     VALUES ($1, $2, 'pending', $3::jsonb)
     RETURNING id, user_id, query, status, result_count, metadata, created_at`,
    [userId, query, JSON.stringify(metadata)],
  );

  return mapHistoryRow(result.rows[0]);
}

export async function mergeParsingMetadata(searchId: string, patch: Record<string, unknown>) {
  if (!patch || Object.keys(patch).length === 0) {
    return;
  }

  await pgPool.query(
    `UPDATE parsing_history
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [searchId, JSON.stringify(patch)],
  );
}

interface UpdateStatusOptions {
  resultCount?: number;
  errorMessage?: string | null;
  metadataPatch?: Record<string, unknown>;
}

export async function markParsingStatus(searchId: string, status: ParsingStatus, options?: UpdateStatusOptions) {
  const updates: string[] = ["status = $2"];
  const values: unknown[] = [searchId, status];
  let index = 3;

  if (options?.resultCount !== undefined) {
    updates.push(`result_count = $${index}`);
    values.push(options.resultCount);
    index += 1;
  }

  if (options?.errorMessage !== undefined) {
    updates.push(`error_message = $${index}`);
    values.push(options.errorMessage);
    index += 1;
  }

  if (options?.metadataPatch && Object.keys(options.metadataPatch).length > 0) {
    updates.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${index}::jsonb`);
    values.push(JSON.stringify(options.metadataPatch));
    index += 1;
  }

  await pgPool.query(`UPDATE parsing_history SET ${updates.join(", ")} WHERE id = $1`, values);
}

export async function persistParsedChannels(searchId: string, channels: ParsedChannel[]): Promise<number> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM parsed_channels WHERE parsing_history_id = $1`, [searchId]);

    for (const channel of channels) {
      const normalizedSubscribers = Number.isFinite(channel.subscribers) ? Math.round(channel.subscribers) : 0;

      await client.query(
        `INSERT INTO parsed_channels (parsing_history_id, channel_id, title, username, member_count, is_verified, metadata)
         VALUES ($1, $2, $3, $4, $5, false, $6::jsonb)
         ON CONFLICT (parsing_history_id, channel_id)
         DO UPDATE SET title = EXCLUDED.title,
                       username = EXCLUDED.username,
                       member_count = EXCLUDED.member_count,
                       metadata = EXCLUDED.metadata`,
        [
          searchId,
          channel.channelId,
          channel.title ?? null,
          channel.username ?? null,
          Math.max(0, normalizedSubscribers),
          JSON.stringify(buildChannelMetadata(channel)),
        ],
      );
    }

    await client.query("COMMIT");
    return channels.length;
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Failed to persist parsed channels", { searchId, error });
    throw error;
  } finally {
    client.release();
  }
}

const DEFAULT_SORT = "subscribers" as const;

type SortField = typeof DEFAULT_SORT | "activity";

export async function getParsingResults(
  searchId: string,
  userId: string,
  page: number,
  limit: number,
  sortBy: SortField,
): Promise<PaginatedParsedChannels> {
  const normalizedPage = Math.max(1, page);
  const normalizedLimit = Math.min(Math.max(1, limit), 100);
  const offset = (normalizedPage - 1) * normalizedLimit;

  const orderClause =
    sortBy === "activity"
      ? "ORDER BY COALESCE((pc.metadata->>'activityScore')::numeric, 0) DESC"
      : "ORDER BY pc.member_count DESC";

  const [rowsResult, totalResult] = await Promise.all([
    pgPool.query<ParsedChannelRow>(
      `SELECT pc.channel_id, pc.title, pc.username, pc.member_count, pc.metadata, pc.created_at
       FROM parsed_channels pc
       JOIN parsing_history ph ON ph.id = pc.parsing_history_id
       WHERE pc.parsing_history_id = $1 AND ph.user_id = $2
       ${orderClause}
       LIMIT $3 OFFSET $4`,
      [searchId, userId, normalizedLimit, offset],
    ),
    pgPool.query<{ total: string | number | null }>(
      `SELECT COUNT(*)::bigint AS total
       FROM parsed_channels pc
       JOIN parsing_history ph ON ph.id = pc.parsing_history_id
       WHERE pc.parsing_history_id = $1 AND ph.user_id = $2`,
      [searchId, userId],
    ),
  ]);

  const totalRaw = totalResult.rows[0]?.total ?? 0;
  const total = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);

  return {
    total: Number.isNaN(total) ? 0 : total,
    page: normalizedPage,
    limit: normalizedLimit,
    results: rowsResult.rows.map(mapChannelRow),
  };
}

export async function getAllParsedChannels(searchId: string, userId: string): Promise<ParsedChannel[]> {
  const result = await pgPool.query<ParsedChannelRow>(
    `SELECT pc.channel_id, pc.title, pc.username, pc.member_count, pc.metadata, pc.created_at
     FROM parsed_channels pc
     JOIN parsing_history ph ON ph.id = pc.parsing_history_id
     WHERE pc.parsing_history_id = $1 AND ph.user_id = $2
     ORDER BY pc.member_count DESC`,
    [searchId, userId],
  );

  return result.rows.map(mapChannelRow);
}

export async function listParsingHistory(userId: string, page: number, limit: number): Promise<ParsingHistoryEntry[]> {
  const normalizedPage = Math.max(1, page);
  const normalizedLimit = Math.min(Math.max(1, limit), 100);
  const offset = (normalizedPage - 1) * normalizedLimit;

  const result = await pgPool.query<ParsingHistoryRow>(
    `SELECT id, user_id, query, status, result_count, metadata, created_at
     FROM parsing_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, normalizedLimit, offset],
  );

  return result.rows.map(mapHistoryRow);
}

export async function getParsingSearchSummary(searchId: string, userId: string): Promise<ParsingHistoryEntry | null> {
  const result = await pgPool.query<ParsingHistoryRow>(
    `SELECT id, user_id, query, status, result_count, metadata, created_at
     FROM parsing_history
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [searchId, userId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapHistoryRow(result.rows[0]);
}
