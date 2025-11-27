import { AuthUserResponse, SubscriptionSummary } from "@/types/auth";
import { User, UserProfile } from "@/types/user";
import { pgPool } from "@/utils/clients";

interface SubscriptionRow {
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  expires_at: Date | null;
}

interface UsageLimitRow {
  limit_key: string;
  limit_value: number;
  consumed_value: number;
  resets_at: Date | null;
}

const LIMIT_KEY_ALIASES: Record<string, string> = {
  searches_per_day: "parsing",
  parsing_requests: "parsing",
  parsing_channels: "parsing",
  audience_searches: "audience",
  audience_exports: "audience",
  audience_segments: "audience",
  broadcast_messages: "broadcast",
  broadcast_campaigns: "broadcast",
};

interface TelegramProfile {
  firstName?: string;
  lastName?: string;
  username?: string;
  photoId?: string;
  profilePhotoId?: string;
  photo?: { id?: string };
  profile_photo_id?: string;
}

function getTelegramProfile(profile?: UserProfile): TelegramProfile | undefined {
  if (!profile || typeof profile !== "object") {
    return undefined;
  }

  const telegramData = (profile as { telegram?: TelegramProfile }).telegram;
  if (telegramData && typeof telegramData === "object") {
    return telegramData;
  }

  return undefined;
}

function splitFullName(fullName?: string) {
  if (!fullName) {
    return { firstName: null, lastName: null };
  }

  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }

  const [firstName, ...rest] = parts;
  return {
    firstName: firstName ?? null,
    lastName: rest.length > 0 ? rest.join(" ") : null,
  };
}

export function buildAuthUserResponse(user: User): AuthUserResponse {
  const telegramProfile = getTelegramProfile(user.profile);
  const { firstName: fallbackFirstName, lastName: fallbackLastName } = splitFullName(user.fullName);

  const first_name = telegramProfile?.firstName ?? fallbackFirstName;
  const last_name = telegramProfile?.lastName ?? fallbackLastName;

  const telegram_profile_photo_id =
    telegramProfile?.photoId ?? telegramProfile?.profilePhotoId ?? telegramProfile?.photo?.id ?? resolveTelegramPhotoId(telegramProfile);

  return {
    id: user.id,
    phone_number: user.phoneNumber ?? null,
    telegram_id: user.telegramId ?? null,
    telegram_username: user.telegramUsername ?? telegramProfile?.username ?? null,
    telegram_profile_photo_id: telegram_profile_photo_id ?? null,
    first_name: first_name ?? null,
    last_name: last_name ?? null,
    subscription: null,
    limits: {},
    is_active: user.status === "active",
  };
}

function resolveTelegramPhotoId(profile?: TelegramProfile) {
  if (!profile) {
    return undefined;
  }

  if (profile.profile_photo_id) {
    return profile.profile_photo_id;
  }

  if (profile.photo && typeof profile.photo === "object" && "id" in profile.photo) {
    return profile.photo.id;
  }

  return undefined;
}

export async function enrichUserWithSubscription(user: AuthUserResponse): Promise<AuthUserResponse> {
  const result = await pgPool.query<SubscriptionRow>(
    `SELECT plan_code, plan_name, status, expires_at
     FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY expires_at DESC
     LIMIT 1`,
    [user.id],
  );

  if (result.rowCount === 0) {
    user.subscription = null;
    return user;
  }

  const row = result.rows[0];
  const summary: SubscriptionSummary = {
    plan_type: row.plan_code ?? row.plan_name ?? null,
    status: row.status ?? null,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
  };

  user.subscription = summary;
  return user;
}

function normalizeLimitKey(limitKey: string) {
  const alias = LIMIT_KEY_ALIASES[limitKey] ?? limitKey;
  return alias
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function enrichUserWithLimits(user: AuthUserResponse): Promise<AuthUserResponse> {
  const result = await pgPool.query<UsageLimitRow>(
    `SELECT limit_key, limit_value, consumed_value, resets_at
     FROM usage_limits
     WHERE user_id = $1`,
    [user.id],
  );

  if (result.rowCount === 0) {
    user.limits = {};
    return user;
  }

  const limitsSummary: Record<string, number | string | null> = {};

  for (const row of result.rows) {
    const prefix = normalizeLimitKey(row.limit_key);
    if (!prefix) {
      continue;
    }

    limitsSummary[`${prefix}_limit`] = Number(row.limit_value ?? 0);
    limitsSummary[`${prefix}_used`] = Number(row.consumed_value ?? 0);

    if (row.resets_at) {
      limitsSummary[`${prefix}_resets_at`] = row.resets_at.toISOString();
    }
  }

  user.limits = limitsSummary;
  return user;
}
