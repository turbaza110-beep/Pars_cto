import { NormalizedAudienceSegmentFilters, AudienceSegment, AudiencePreviewEntry } from "@/types/audience";
import { ActivityLevel } from "@/types/parsing";
import { pgPool } from "@/utils/clients";
import { NotFoundError, RateLimitError, ValidationError } from "@/utils/errors";
import { logger } from "@/utils/logger";
import { invalidateDashboardCache } from "@/services/dashboard/dashboard.service";

const AUDIENCE_LIMIT_KEYS = ["audience_segments", "audience_searches", "audience_exports"] as const;

interface AudienceSegmentRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  filters: unknown;
  source_parsing_id: string | null;
  total_recipients: number | null;
  status: string | null;
  created_at: Date;
  updated_at: Date;
}

interface UsageLimitRow {
  id: string;
  limit_value: number | null;
  consumed_value: number | null;
}

interface TotalRow {
  total: string | number | null;
}

interface PreviewRow {
  channel_id: string;
  username: string | null;
  metadata: unknown;
}

interface CalculateRecipientsInput {
  userId: string;
  sourceParsingId: string;
  filters?: NormalizedAudienceSegmentFilters | null;
}

export interface CreateSegmentInput {
  userId: string;
  name: string;
  description?: string | null;
  sourceParsingId: string;
  filters?: NormalizedAudienceSegmentFilters | null;
}

export interface UpdateSegmentInput {
  userId: string;
  segmentId: string;
  filters?: NormalizedAudienceSegmentFilters | null;
}

export interface SegmentPreviewResult {
  total: number;
  preview: AudiencePreviewEntry[];
}

function parseJsonColumn<T>(value: unknown): T | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "object") {
    return value as T;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn("Failed to parse JSON column", { error });
    }
  }

  return undefined;
}

function normalizeLanguage(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePostFrequency(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "daily" || normalized === "weekly" || normalized === "monthly") {
    return normalized as NormalizedAudienceSegmentFilters["postFrequency"];
  }

  return undefined;
}

function parseFiltersColumn(value: unknown): NormalizedAudienceSegmentFilters | null {
  const raw = parseJsonColumn<Record<string, unknown>>(value);
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const filters: NormalizedAudienceSegmentFilters = {};

  const engagementMin = (raw.engagementMin ?? raw.engagement_min) as number | undefined;
  if (typeof engagementMin === "number" && Number.isFinite(engagementMin)) {
    filters.engagementMin = engagementMin;
  }

  const engagementMax = (raw.engagementMax ?? raw.engagement_max) as number | undefined;
  if (typeof engagementMax === "number" && Number.isFinite(engagementMax)) {
    filters.engagementMax = engagementMax;
  }

  const minSubscribers = (raw.minSubscribers ?? raw.min_subscribers) as number | undefined;
  if (typeof minSubscribers === "number" && Number.isFinite(minSubscribers)) {
    filters.minSubscribers = minSubscribers;
  }

  const language = normalizeLanguage((raw.language ?? raw.lang) as string | undefined);
  if (language) {
    filters.language = language;
  }

  const postFrequency = normalizePostFrequency((raw.postFrequency ?? raw.post_frequency) as string | undefined);
  if (postFrequency) {
    filters.postFrequency = postFrequency;
  }

  return Object.keys(filters).length > 0 ? filters : null;
}

function serializeFilters(filters?: NormalizedAudienceSegmentFilters | null): string {
  if (!filters || Object.keys(filters).length === 0) {
    return "{}";
  }

  return JSON.stringify(filters);
}

function toIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function mapSegmentRow(row: AudienceSegmentRow): AudienceSegment {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    sourceParsingId: row.source_parsing_id,
    filters: parseFiltersColumn(row.filters),
    totalRecipients: Number(row.total_recipients ?? 0),
    status: (row.status ?? "ready") as AudienceSegment["status"],
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  } satisfies AudienceSegment;
}

async function findAudienceLimitRow(userId: string): Promise<UsageLimitRow | null> {
  if (!AUDIENCE_LIMIT_KEYS.length) {
    return null;
  }

  const result = await pgPool.query<UsageLimitRow>(
    `SELECT id, limit_value, consumed_value
     FROM usage_limits
     WHERE user_id = $1 AND limit_key = ANY($2)
     ORDER BY array_position($2::text[], limit_key), COALESCE(limit_value, 0) DESC
     LIMIT 1`,
    [userId, AUDIENCE_LIMIT_KEYS],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

async function assertAudienceQuotaAvailable(userId: string) {
  const limitRow = await findAudienceLimitRow(userId);
  if (!limitRow) {
    return;
  }

  const limitValue = limitRow.limit_value ?? 0;
  if (limitValue <= 0) {
    return;
  }

  const consumed = limitRow.consumed_value ?? 0;
  if (consumed >= limitValue) {
    throw new RateLimitError("Audience limit exceeded", { details: { limit: limitValue, used: consumed } });
  }
}

async function incrementAudienceUsage(userId: string, amount = 1) {
  const limitRow = await findAudienceLimitRow(userId);
  if (!limitRow) {
    return;
  }

  const limitValue = limitRow.limit_value ?? 0;
  if (limitValue <= 0) {
    return;
  }

  const incrementBy = Math.max(1, Math.floor(amount));

  await pgPool.query(
    `UPDATE usage_limits
     SET consumed_value = LEAST(limit_value, COALESCE(consumed_value, 0) + $2), updated_at = NOW()
     WHERE id = $1`,
    [limitRow.id, incrementBy],
  );
}

async function decrementAudienceUsage(userId: string, amount = 1) {
  const limitRow = await findAudienceLimitRow(userId);
  if (!limitRow) {
    return;
  }

  const decrementBy = Math.max(1, Math.floor(amount));

  await pgPool.query(
    `UPDATE usage_limits
     SET consumed_value = GREATEST(0, COALESCE(consumed_value, 0) - $2), updated_at = NOW()
     WHERE id = $1`,
    [limitRow.id, decrementBy],
  );
}

async function assertParsingOwnership(userId: string, parsingId: string) {
  const result = await pgPool.query(
    `SELECT id
     FROM parsing_history
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [parsingId, userId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("Parsing results not found");
  }
}

function buildPostFrequencyTarget(postFrequency?: NormalizedAudienceSegmentFilters["postFrequency"]) {
  if (!postFrequency) {
    return undefined;
  }

  switch (postFrequency) {
    case "daily":
      return "high";
    case "weekly":
      return "medium";
    case "monthly":
      return "low";
    default:
      return undefined;
  }
}

function buildFilterClauses(filters: NormalizedAudienceSegmentFilters | null | undefined, values: unknown[]): string[] {
  if (!filters) {
    return [];
  }

  const clauses: string[] = [];

  if (typeof filters.engagementMin === "number") {
    values.push(filters.engagementMin);
    clauses.push(`COALESCE((pc.metadata->>'activityScore')::numeric, 0) >= $${values.length}`);
  }

  if (typeof filters.engagementMax === "number") {
    values.push(filters.engagementMax);
    clauses.push(`COALESCE((pc.metadata->>'activityScore')::numeric, 0) <= $${values.length}`);
  }

  if (typeof filters.minSubscribers === "number") {
    values.push(filters.minSubscribers);
    clauses.push(`pc.member_count >= $${values.length}`);
  }

  if (filters.language) {
    values.push(filters.language);
    clauses.push(`LOWER(COALESCE(pc.metadata->>'language', '')) = LOWER($${values.length})`);
  }

  const postFrequencyTarget = buildPostFrequencyTarget(filters.postFrequency);
  if (postFrequencyTarget) {
    values.push(postFrequencyTarget);
    clauses.push(`LOWER(COALESCE(pc.metadata->>'activityLevel', '')) = LOWER($${values.length})`);
  }

  return clauses;
}

function normalizeTotal(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function formatUsername(raw?: string | null) {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function parseActivityLevel(metadata?: Record<string, unknown>): ActivityLevel {
  const raw = (metadata?.activityLevel ?? metadata?.activity_level) as string | undefined;
  if (raw === "low" || raw === "medium" || raw === "high") {
    return raw;
  }

  const score = typeof metadata?.activityScore === "number" ? metadata.activityScore : Number(metadata?.activityScore ?? 0);
  if (score >= 0.66) {
    return "high";
  }

  if (score >= 0.33) {
    return "medium";
  }

  return "low";
}

function mapPreviewRow(row: PreviewRow): AudiencePreviewEntry {
  const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata) ?? {};
  const rawScore = typeof metadata.activityScore === "number" ? metadata.activityScore : Number(metadata.activityScore ?? 0);
  const engagementScore = Number.isFinite(rawScore) ? Number(rawScore.toFixed(2)) : 0;

  const identifier = row.channel_id;
  const numericId = Number(identifier);
  const userId = Number.isNaN(numericId) ? identifier : numericId;

  return {
    username: formatUsername(row.username),
    userId,
    engagementScore,
    activityLevel: parseActivityLevel(metadata),
  } satisfies AudiencePreviewEntry;
}

export async function calculateTotalRecipients({ userId, sourceParsingId, filters }: CalculateRecipientsInput): Promise<number> {
  const values: unknown[] = [sourceParsingId, userId];
  const clauses = buildFilterClauses(filters, values);

  const result = await pgPool.query<TotalRow>(
    `SELECT COUNT(pc.id)::bigint AS total
     FROM parsed_channels pc
     JOIN parsing_history ph ON ph.id = pc.parsing_history_id
     WHERE ph.id = $1 AND ph.user_id = $2
     ${clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : ""}`,
    values,
  );

  return normalizeTotal(result.rows[0]?.total ?? 0);
}

export async function createSegment({ userId, name, description, sourceParsingId, filters }: CreateSegmentInput): Promise<AudienceSegment> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new ValidationError("Segment name is required");
  }

  await assertAudienceQuotaAvailable(userId);
  await assertParsingOwnership(userId, sourceParsingId);

  const totalRecipients = await calculateTotalRecipients({ userId, sourceParsingId, filters });

  try {
    const result = await pgPool.query<AudienceSegmentRow>(
      `INSERT INTO audience_segments (user_id, name, description, filters, source_parsing_id, total_recipients, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'ready')
       RETURNING id, user_id, name, description, filters, source_parsing_id, total_recipients, status, created_at, updated_at`,
      [userId, trimmedName, description ?? null, serializeFilters(filters), sourceParsingId, totalRecipients],
    );

    await incrementAudienceUsage(userId, 1);
    await invalidateDashboardCache(userId);

    return mapSegmentRow(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ValidationError("Segment name already exists");
    }

    throw error;
  }
}

export async function listSegments(userId: string, page: number, limit: number): Promise<AudienceSegment[]> {
  const normalizedPage = Math.max(1, page);
  const normalizedLimit = Math.min(Math.max(1, limit), 100);
  const offset = (normalizedPage - 1) * normalizedLimit;

  const result = await pgPool.query<AudienceSegmentRow>(
    `SELECT id, user_id, name, description, filters, source_parsing_id, total_recipients, status, created_at, updated_at
     FROM audience_segments
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, normalizedLimit, offset],
  );

  return result.rows.map(mapSegmentRow);
}

export async function getSegment(userId: string, segmentId: string): Promise<AudienceSegment> {
  const result = await pgPool.query<AudienceSegmentRow>(
    `SELECT id, user_id, name, description, filters, source_parsing_id, total_recipients, status, created_at, updated_at
     FROM audience_segments
     WHERE user_id = $1 AND id = $2
     LIMIT 1`,
    [userId, segmentId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("Audience segment not found");
  }

  return mapSegmentRow(result.rows[0]);
}

export async function updateSegment({ userId, segmentId, filters }: UpdateSegmentInput): Promise<AudienceSegment> {
  const existing = await getSegment(userId, segmentId);
  if (!existing.sourceParsingId) {
    throw new ValidationError("Segment is missing parsing source");
  }

  const resolvedFilters = filters === undefined ? existing.filters : filters;
  const totalRecipients = await calculateTotalRecipients({
    userId,
    sourceParsingId: existing.sourceParsingId,
    filters: resolvedFilters,
  });

  const result = await pgPool.query<AudienceSegmentRow>(
    `UPDATE audience_segments
     SET filters = $3::jsonb,
         total_recipients = $4,
         status = 'ready',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, name, description, filters, source_parsing_id, total_recipients, status, created_at, updated_at`,
    [segmentId, userId, serializeFilters(resolvedFilters), totalRecipients],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("Audience segment not found");
  }

  await invalidateDashboardCache(userId);

  return mapSegmentRow(result.rows[0]);
}

export async function deleteSegment(userId: string, segmentId: string): Promise<void> {
  const result = await pgPool.query(
    `DELETE FROM audience_segments
     WHERE id = $1 AND user_id = $2`,
    [segmentId, userId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("Audience segment not found");
  }

  await decrementAudienceUsage(userId, 1);
  await invalidateDashboardCache(userId);
}

export async function getSegmentPreview(userId: string, segmentId: string, limit: number): Promise<SegmentPreviewResult> {
  const segment = await getSegment(userId, segmentId);
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);

  if (!segment.sourceParsingId) {
    return { total: 0, preview: [] };
  }

  const values: unknown[] = [segment.sourceParsingId, userId];
  const clauses = buildFilterClauses(segment.filters, values);
  values.push(normalizedLimit);
  const limitPlaceholder = "$" + values.length;

  const rows = await pgPool.query<PreviewRow>(
    `SELECT pc.channel_id, pc.username, pc.metadata
     FROM parsed_channels pc
     JOIN parsing_history ph ON ph.id = pc.parsing_history_id
     WHERE ph.id = $1 AND ph.user_id = $2
     ${clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : ""}
     ORDER BY pc.member_count DESC
     LIMIT ${limitPlaceholder}`,
    values,
  );

  return {
    total: segment.totalRecipients,
    preview: rows.rows.map(mapPreviewRow),
  } satisfies SegmentPreviewResult;
}

export async function getSegmentRecipients(userId: string, segmentId: string): Promise<string[]> {
  const segment = await getSegment(userId, segmentId);
  if (!segment.sourceParsingId) {
    return [];
  }

  const values: unknown[] = [segment.sourceParsingId, userId];
  const clauses = buildFilterClauses(segment.filters, values);

  const rows = await pgPool.query<{ username: string | null; channel_id: string }>(
    `SELECT pc.username, pc.channel_id
     FROM parsed_channels pc
     JOIN parsing_history ph ON ph.id = pc.parsing_history_id
     WHERE ph.id = $1 AND ph.user_id = $2
     ${clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : ""}
     ORDER BY pc.member_count DESC`,
    values,
  );

  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const row of rows.rows) {
    const formatted = formatUsername(row.username) ?? row.username ?? null;
    const candidate = formatted ?? row.channel_id;
    if (!candidate) {
      continue;
    }

    if (seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    recipients.push(candidate);
  }

  return recipients;
}
