import { pgPool } from "@/utils/clients";
import { NotFoundError, ValidationError } from "@/utils/errors";
import { User, UserProfile, UserStatus } from "@/types/user";
import { invalidateDashboardCache } from "@/services/dashboard/dashboard.service";

interface UserRow {
  id: string;
  email: string | null;
  phone_number: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  full_name: string | null;
  status: UserStatus | null;
  profile: UserProfile | null;
}

interface CreateUserInput {
  phoneNumber?: string;
  telegramId?: string;
  telegramUsername?: string;
  fullName?: string;
  status?: UserStatus;
  profile?: UserProfile;
}

interface UpdateUserProfileInput {
  fullName?: string;
  status?: UserStatus;
  profile?: UserProfile;
}

interface UpdateTelegramProfileInput {
  phoneNumber?: string;
  telegramId?: string;
  telegramUsername?: string;
  fullName?: string;
}

const FREE_PLAN_CODE = "free";
const FREE_PLAN_NAME = "Free Plan";
const DEFAULT_USAGE_LIMITS = [{ key: "searches_per_day", limit: 100 }];

function mapUserRow(row: UserRow): User {
  const profile = row.profile
    ? typeof row.profile === "string"
      ? (JSON.parse(row.profile) as UserProfile)
      : row.profile
    : undefined;

  return {
    id: row.id,
    email: row.email ?? undefined,
    phoneNumber: row.phone_number ?? undefined,
    telegramId: row.telegram_id ?? undefined,
    telegramUsername: row.telegram_username ?? undefined,
    fullName: row.full_name ?? undefined,
    status: row.status ?? undefined,
    profile,
  };
}

function ensureUpdateColumns(columns: string[]) {
  if (columns.length === 0) {
    throw new ValidationError("No user fields provided for update");
  }
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const profilePayload = input.profile ? JSON.stringify(input.profile) : JSON.stringify({});
  const result = await pgPool.query<UserRow>(
    `INSERT INTO users (phone_number, telegram_id, telegram_username, full_name, status, profile)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.phoneNumber ?? null,
      input.telegramId ?? null,
      input.telegramUsername ?? null,
      input.fullName ?? null,
      input.status ?? "active",
      profilePayload,
    ],
  );

  const createdUser = mapUserRow(result.rows[0]);
  await invalidateDashboardCache(createdUser.id);
  return createdUser;
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await pgPool.query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapUserRow(result.rows[0]);
}

export async function getUserByTelegramId(telegramId: string | number): Promise<User | null> {
  const normalized = telegramId?.toString();
  if (!normalized) {
    return null;
  }

  const result = await pgPool.query<UserRow>("SELECT * FROM users WHERE telegram_id = $1 LIMIT 1", [normalized]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapUserRow(result.rows[0]);
}

export async function updateUserProfile(userId: string, updates: UpdateUserProfileInput): Promise<User> {
  const columns: string[] = [];
  const values: unknown[] = [userId];
  let index = 2;

  if (updates.fullName !== undefined) {
    columns.push(`full_name = $${index}`);
    values.push(updates.fullName);
    index += 1;
  }

  if (updates.status !== undefined) {
    columns.push(`status = $${index}`);
    values.push(updates.status);
    index += 1;
  }

  if (updates.profile !== undefined) {
    columns.push(`profile = $${index}`);
    values.push(JSON.stringify(updates.profile));
    index += 1;
  }

  ensureUpdateColumns(columns);
  columns.push("updated_at = NOW()");

  const result = await pgPool.query<UserRow>(
    `UPDATE users SET ${columns.join(", ")} WHERE id = $1 RETURNING *`,
    values,
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("User not found", { userId });
  }

  const updatedUser = mapUserRow(result.rows[0]);
  await invalidateDashboardCache(userId);
  return updatedUser;
}

export async function updateTelegramProfile(userId: string, updates: UpdateTelegramProfileInput): Promise<User> {
  const columns: string[] = [];
  const values: unknown[] = [userId];
  let index = 2;

  if (updates.phoneNumber !== undefined) {
    columns.push(`phone_number = $${index}`);
    values.push(updates.phoneNumber);
    index += 1;
  }

  if (updates.telegramId !== undefined) {
    columns.push(`telegram_id = $${index}`);
    values.push(updates.telegramId);
    index += 1;
  }

  if (updates.telegramUsername !== undefined) {
    columns.push(`telegram_username = $${index}`);
    values.push(updates.telegramUsername);
    index += 1;
  }

  if (updates.fullName !== undefined) {
    columns.push(`full_name = $${index}`);
    values.push(updates.fullName);
    index += 1;
  }

  if (columns.length === 0) {
    const existing = await getUserById(userId);
    if (!existing) {
      throw new NotFoundError("User not found", { userId });
    }
    return existing;
  }

  columns.push("updated_at = NOW()");

  const result = await pgPool.query<UserRow>(
    `UPDATE users SET ${columns.join(", ")} WHERE id = $1 RETURNING *`,
    values,
  );

  if (result.rowCount === 0) {
    throw new NotFoundError("User not found", { userId });
  }

  const updatedUser = mapUserRow(result.rows[0]);
  await invalidateDashboardCache(userId);
  return updatedUser;
}

export async function ensureFreeSubscription(userId: string) {
  const existing = await pgPool.query("SELECT id FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1", [userId]);
  if (existing.rowCount > 0) {
    return;
  }

  await pgPool.query(
    `INSERT INTO subscriptions (user_id, plan_code, plan_name, status, started_at, expires_at, metadata)
     VALUES ($1, $2, $3, 'active', NOW(), NOW() + INTERVAL '30 days', $4)`,
    [userId, FREE_PLAN_CODE, FREE_PLAN_NAME, JSON.stringify({ source: "telegram-auth" })],
  );

  await invalidateDashboardCache(userId);
}

export async function ensureDefaultUsageLimits(userId: string) {
  await Promise.all(
    DEFAULT_USAGE_LIMITS.map((limit) =>
      pgPool.query(
        `INSERT INTO usage_limits (user_id, limit_key, limit_value, consumed_value, resets_at)
         VALUES ($1, $2, $3, 0, NOW() + INTERVAL '1 day')
         ON CONFLICT (user_id, limit_key) DO NOTHING`,
        [userId, limit.key, limit.limit],
      ),
    ),
  );

  await invalidateDashboardCache(userId);
}
