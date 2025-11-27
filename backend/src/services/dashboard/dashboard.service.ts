import { pgPool } from "@/utils/clients";
import { withRedisClient } from "@/services/redis.service";
import { logger } from "@/utils/logger";

const DASHBOARD_CACHE_PREFIX = "dashboard";
const DASHBOARD_CACHE_TTL_SECONDS = 60 * 5;
const RECENT_ACTIVITY_LIMIT = 10;

const LIMIT_CATEGORY_ALIASES: Record<string, DashboardLimitCategory> = {
  searches_per_day: "parsing",
  parsing_requests: "parsing",
  parsing_channels: "parsing",
  audience_searches: "audience",
  audience_exports: "audience",
  audience_segments: "audience",
  broadcast_messages: "broadcast",
  broadcast_campaigns: "broadcast",
};

const PARSING_STATUS_FAILURES = new Set(["failed", "error", "errored", "cancelled"]);
const PARSING_STATUS_COMPLETED = new Set(["done", "completed", "success"]);
const BROADCAST_STATUS_COMPLETED = new Set(["completed", "sent", "delivered"]);
const BROADCAST_STATUS_FAILED = new Set(["failed", "error", "cancelled"]);

type DashboardLimitCategory = "parsing" | "audience" | "broadcast";
type LimitValue = number | "unlimited";

type ActivityStatus = "completed" | "in_progress" | "failed";
type ActivityType = "parsing" | "audience" | "broadcast";

type NullableDate = Date | string | null | undefined;

type NormalizedProfile = {
  [key: string]: unknown;
  telegram?: Record<string, unknown>;
};

interface UserProfileRow {
  full_name: string | null;
  telegram_username: string | null;
  phone_number: string | null;
  profile: unknown;
}

interface SubscriptionRow {
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  expires_at: Date | null;
  metadata: unknown;
}

interface UsageLimitRow {
  limit_key: string;
  limit_value: number | null;
  consumed_value: number | null;
}

interface TotalRow {
  total: string | number | null;
}

interface ParsingActivityRow {
  id: string;
  query: string | null;
  status: string | null;
  created_at: Date;
}

interface AudienceActivityRow {
  id: string;
  name: string | null;
  created_at: Date;
}

interface BroadcastActivityRow {
  id: string;
  title: string | null;
  status: string | null;
  created_at: Date;
}

interface DashboardActivity {
  type: ActivityType;
  name: string;
  created_at: string;
  status: ActivityStatus;
}

export interface DashboardProfile {
  name: string | null;
  username: string | null;
  photo_url: string | null;
  phone: string | null;
}

export interface DashboardSubscription {
  plan: "free" | "week" | "month" | "year";
  status: "active" | "expired";
  expires_at: string | null;
  renewal_status: "auto" | "manual" | "expired";
}

export interface DashboardLimits {
  parsing_limit: LimitValue;
  parsing_used: number;
  audience_limit: LimitValue;
  audience_used: number;
  broadcast_limit: LimitValue;
  broadcast_used: number;
}

export interface DashboardStats {
  total_channels_found: number;
  total_audience_analyzed: number;
  total_broadcasts_sent: number;
  recent_activity: DashboardActivity[];
}

export interface DashboardResponse {
  user_profile: DashboardProfile;
  subscription: DashboardSubscription;
  limits: DashboardLimits;
  stats: DashboardStats;
}

function buildCacheKey(userId: string) {
  return `${DASHBOARD_CACHE_PREFIX}:${userId}`;
}

async function readDashboardCache(userId: string): Promise<DashboardResponse | null> {
  const cacheKey = buildCacheKey(userId);
  try {
    const serialized = await withRedisClient((client) => client.get(cacheKey));
    if (!serialized) {
      return null;
    }

    return JSON.parse(serialized) as DashboardResponse;
  } catch (error) {
    logger.error("Failed to read dashboard cache", { userId, error });
    await withRedisClient((client) => client.del(cacheKey));
    return null;
  }
}

async function writeDashboardCache(userId: string, payload: DashboardResponse) {
  const cacheKey = buildCacheKey(userId);
  try {
    await withRedisClient((client) => client.setEx(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, JSON.stringify(payload)));
  } catch (error) {
    logger.error("Failed to write dashboard cache", { userId, error });
  }
}

export async function invalidateDashboardCache(userId: string) {
  const cacheKey = buildCacheKey(userId);
  try {
    await withRedisClient((client) => client.del(cacheKey));
  } catch (error) {
    logger.error("Failed to invalidate dashboard cache", { userId, error });
  }
}

function parseJsonColumn<T = Record<string, unknown>>(value: unknown): T | undefined {
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

function resolveName(row: UserProfileRow, profile?: NormalizedProfile): string | null {
  if (row.full_name?.trim()) {
    return row.full_name.trim();
  }

  const displayName = typeof profile?.displayName === "string" ? profile.displayName : undefined;
  if (displayName?.trim()) {
    return displayName.trim();
  }

  const telegramProfile = profile?.telegram;
  const firstName =
    (telegramProfile?.firstName as string | undefined) ?? (telegramProfile?.first_name as string | undefined);
  const lastName =
    (telegramProfile?.lastName as string | undefined) ?? (telegramProfile?.last_name as string | undefined);

  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return combined.length > 0 ? combined : null;
}

function normalizeUsername(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function resolveUsername(row: UserProfileRow, profile?: NormalizedProfile): string | null {
  if (row.telegram_username) {
    return normalizeUsername(row.telegram_username);
  }

  const telegramProfile = profile?.telegram;
  const username = telegramProfile?.username as string | undefined;
  return normalizeUsername(username);
}

function resolvePhotoUrl(profile?: NormalizedProfile): string | null {
  if (!profile) {
    return null;
  }

  const directUrl =
    (profile.avatarUrl as string | undefined) ??
    (profile.photoUrl as string | undefined) ??
    (profile.photo_url as string | undefined);
  if (directUrl) {
    return directUrl;
  }

  const telegramProfile = profile.telegram;
  if (!telegramProfile || typeof telegramProfile !== "object") {
    return null;
  }

  const telegramUrl =
    (telegramProfile.photoUrl as string | undefined) ??
    (telegramProfile.photo_url as string | undefined) ??
    (telegramProfile.avatarUrl as string | undefined);

  return telegramUrl ?? null;
}

function readMetadataValue(metadata: Record<string, unknown> | undefined, key: string) {
  if (!metadata) {
    return undefined;
  }

  return metadata[key];
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "auto";
  }

  return false;
}

function resolvePlanType(planCode?: string | null, planName?: string | null): DashboardSubscription["plan"] {
  const source = (planCode ?? planName ?? "").toLowerCase();

  if (source.includes("year")) {
    return "year";
  }

  if (source.includes("month")) {
    return "month";
  }

  if (source.includes("week")) {
    return "week";
  }

  return "free";
}

function formatLimitValue(value: number | null | undefined): LimitValue {
  if (value === null || value === undefined || value < 0) {
    return "unlimited";
  }

  return value;
}

function mergeLimitValues(current: LimitValue, incoming: LimitValue): LimitValue {
  if (incoming === "unlimited") {
    return "unlimited";
  }

  if (current === "unlimited") {
    return incoming;
  }

  return Math.max(current, incoming);
}

function toIsoString(value: NullableDate): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeActivityStatus(type: ActivityType, rawStatus?: string | null): ActivityStatus {
  if (!rawStatus) {
    return type === "audience" ? "completed" : "in_progress";
  }

  const normalized = rawStatus.toLowerCase();

  if (type === "parsing") {
    if (PARSING_STATUS_FAILURES.has(normalized)) {
      return "failed";
    }

    if (PARSING_STATUS_COMPLETED.has(normalized)) {
      return "completed";
    }

    if (normalized.includes("fail")) {
      return "failed";
    }

    if (normalized.includes("complete") || normalized.includes("success")) {
      return "completed";
    }

    return "in_progress";
  }

  if (type === "broadcast") {
    if (BROADCAST_STATUS_FAILED.has(normalized) || normalized.includes("fail")) {
      return "failed";
    }

    if (BROADCAST_STATUS_COMPLETED.has(normalized)) {
      return "completed";
    }

    return "in_progress";
  }

  return "completed";
}

function buildActivity(type: ActivityType, name: string, createdAt: NullableDate, status?: string | null): DashboardActivity {
  return {
    type,
    name,
    created_at: toIsoString(createdAt) ?? new Date(0).toISOString(),
    status: normalizeActivityStatus(type, status),
  };
}

export async function getUserProfile(userId: string): Promise<DashboardProfile> {
  const result = await pgPool.query<UserProfileRow>(
    `SELECT full_name, telegram_username, phone_number, profile
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    return {
      name: null,
      username: null,
      photo_url: null,
      phone: null,
    };
  }

  const row = result.rows[0];
  const profile = parseJsonColumn<NormalizedProfile>(row.profile);

  return {
    name: resolveName(row, profile),
    username: resolveUsername(row, profile),
    photo_url: resolvePhotoUrl(profile),
    phone: row.phone_number,
  };
}

export async function getUserSubscription(userId: string): Promise<DashboardSubscription> {
  const result = await pgPool.query<SubscriptionRow>(
    `SELECT plan_code, plan_name, status, expires_at, metadata
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY expires_at DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    return {
      plan: "free",
      status: "expired",
      expires_at: null,
      renewal_status: "manual",
    };
  }

  const row = result.rows[0];
  const now = Date.now();
  const expiresAt = row.expires_at ?? null;
  const expiresAtTime = expiresAt ? expiresAt.getTime() : null;
  const isActiveStatus = row.status === "active" || row.status === "trialing";
  const isActive = Boolean(isActiveStatus && expiresAtTime && expiresAtTime > now);

  const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata);
  const autoRenewFlag =
    toBooleanFlag(readMetadataValue(metadata, "autoRenew")) ||
    toBooleanFlag(readMetadataValue(metadata, "auto_renew")) ||
    readMetadataValue(metadata, "renewal") === "auto";

  const renewal_status: DashboardSubscription["renewal_status"] = !isActive
    ? "expired"
    : autoRenewFlag
      ? "auto"
      : "manual";

  return {
    plan: resolvePlanType(row.plan_code, row.plan_name),
    status: isActive ? "active" : "expired",
    expires_at: toIsoString(expiresAt),
    renewal_status,
  };
}

export async function getUserLimits(userId: string): Promise<DashboardLimits> {
  const result = await pgPool.query<UsageLimitRow>(
    `SELECT limit_key, limit_value, consumed_value
     FROM usage_limits
     WHERE user_id = $1`,
    [userId],
  );

  const limits: DashboardLimits = {
    parsing_limit: "unlimited",
    parsing_used: 0,
    audience_limit: "unlimited",
    audience_used: 0,
    broadcast_limit: "unlimited",
    broadcast_used: 0,
  };

  for (const row of result.rows) {
    const normalizedKey = row.limit_key.toLowerCase();
    const category = LIMIT_CATEGORY_ALIASES[normalizedKey];
    if (!category) {
      continue;
    }

    const formattedLimit = formatLimitValue(row.limit_value);
    const consumed = Number(row.consumed_value ?? 0);

    switch (category) {
      case "parsing":
        limits.parsing_limit = mergeLimitValues(limits.parsing_limit, formattedLimit);
        limits.parsing_used += consumed;
        break;
      case "audience":
        limits.audience_limit = mergeLimitValues(limits.audience_limit, formattedLimit);
        limits.audience_used += consumed;
        break;
      case "broadcast":
        limits.broadcast_limit = mergeLimitValues(limits.broadcast_limit, formattedLimit);
        limits.broadcast_used += consumed;
        break;
      default:
        break;
    }
  }

  return limits;
}

function parseTotal(value: string | number | null | undefined): number {
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

function resolveParsingActivities(rows: ParsingActivityRow[]): DashboardActivity[] {
  return rows.map((row) => {
    const name = row.query ? `Search: ${row.query}` : "Search task";
    return buildActivity("parsing", name, row.created_at, row.status);
  });
}

function resolveAudienceActivities(rows: AudienceActivityRow[]): DashboardActivity[] {
  return rows.map((row) => {
    const name = row.name ? `Audience: ${row.name}` : "Audience segment";
    return buildActivity("audience", name, row.created_at);
  });
}

function resolveBroadcastActivities(rows: BroadcastActivityRow[]): DashboardActivity[] {
  return rows.map((row) => {
    const name = row.title ? `Broadcast: ${row.title}` : "Broadcast campaign";
    return buildActivity("broadcast", name, row.created_at, row.status);
  });
}

export async function getUserStats(userId: string): Promise<DashboardStats> {
  const [channelsResult, audienceResult, broadcastsResult, parsingActivitiesResult, audienceActivitiesResult, broadcastActivitiesResult] =
    await Promise.all([
      pgPool.query<TotalRow>(
        `SELECT COUNT(pc.id)::bigint AS total
         FROM parsing_history ph
         JOIN parsed_channels pc ON pc.parsing_history_id = ph.id
         WHERE ph.user_id = $1`,
        [userId],
      ),
      pgPool.query<TotalRow>(
        `SELECT COUNT(*)::bigint AS total
         FROM audience_segments
         WHERE user_id = $1`,
        [userId],
      ),
      pgPool.query<TotalRow>(
        `SELECT COUNT(bl.id)::bigint AS total
         FROM broadcast_logs bl
         LEFT JOIN broadcast_campaigns bc ON bc.id = bl.campaign_id
         WHERE bl.user_id = $1 OR bc.user_id = $1`,
        [userId],
      ),
      pgPool.query<ParsingActivityRow>(
        `SELECT id, query, status, created_at
         FROM parsing_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId],
      ),
      pgPool.query<AudienceActivityRow>(
        `SELECT id, name, created_at
         FROM audience_segments
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId],
      ),
      pgPool.query<BroadcastActivityRow>(
        `SELECT id, title, status, created_at
         FROM broadcast_campaigns
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId],
      ),
    ]);

  const activities = [
    ...resolveParsingActivities(parsingActivitiesResult.rows),
    ...resolveAudienceActivities(audienceActivitiesResult.rows),
    ...resolveBroadcastActivities(broadcastActivitiesResult.rows),
  ];

  activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const recent_activity = activities.slice(0, RECENT_ACTIVITY_LIMIT);

  return {
    total_channels_found: parseTotal(channelsResult.rows[0]?.total ?? 0),
    total_audience_analyzed: parseTotal(audienceResult.rows[0]?.total ?? 0),
    total_broadcasts_sent: parseTotal(broadcastsResult.rows[0]?.total ?? 0),
    recent_activity,
  };
}

function buildDashboardCacheKey(userId: string): string {
  return `${DASHBOARD_CACHE_PREFIX}:${userId}`;
}

async function readDashboardCache(userId: string): Promise<DashboardResponse | null> {
  try {
    const cached = await withRedisClient((client) => client.get(buildDashboardCacheKey(userId)));
    if (!cached) {
      return null;
    }

    return JSON.parse(cached) as DashboardResponse;
  } catch (error) {
    logger.warn("Failed to read dashboard cache", { userId, error });
    return null;
  }
}

async function writeDashboardCache(userId: string, data: DashboardResponse): Promise<void> {
  try {
    await withRedisClient((client) =>
      client.setEx(buildDashboardCacheKey(userId), DASHBOARD_CACHE_TTL_SECONDS, JSON.stringify(data)),
    );
  } catch (error) {
    logger.warn("Failed to write dashboard cache", { userId, error });
  }
}

export async function invalidateDashboardCache(userId: string): Promise<void> {
  try {
    await withRedisClient((client) => client.del(buildDashboardCacheKey(userId)));
  } catch (error) {
    logger.warn("Failed to invalidate dashboard cache", { userId, error });
  }
}

export async function getDashboardData(userId: string): Promise<DashboardResponse> {
  const cached = await readDashboardCache(userId);
  if (cached) {
    return cached;
  }

  const [user_profile, subscription, limits, stats] = await Promise.all([
    getUserProfile(userId),
    getUserSubscription(userId),
    getUserLimits(userId),
    getUserStats(userId),
  ]);

  const response: DashboardResponse = {
    user_profile,
    subscription,
    limits,
    stats,
  };

  await writeDashboardCache(userId, response);
  return response;
}
