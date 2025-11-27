import { config } from "dotenv";

import { closeDatabasePool, getDatabasePool, initializeDatabase } from "@/database/connection";
import { logger } from "@/utils/logger";

config();

const ids = {
  user: "11111111-1111-1111-1111-111111111111",
  subscription: "22222222-2222-2222-2222-222222222222",
  usageLimit: "33333333-3333-3333-3333-333333333333",
  session: "44444444-4444-4444-4444-444444444444",
  authState: "55555555-5555-5555-5555-555555555555",
  parsingHistory: "66666666-6666-6666-6666-666666666666",
  parsedChannel: "77777777-7777-7777-7777-777777777777",
  segment: "88888888-8888-8888-8888-888888888888",
  campaign: "99999999-9999-9999-9999-999999999999",
  broadcastLog: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  payment: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  notification: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  errorLog: "dddddddd-dddd-dddd-dddd-dddddddddddd",
};

async function seed() {
  await initializeDatabase();
  const pool = getDatabasePool();
  const client = await pool.connect();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  const resetAt = new Date(now.getTime() + 1000 * 60 * 60 * 12);
  const authExpires = new Date(now.getTime() + 1000 * 60 * 30);

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (id, phone_number, telegram_id, telegram_username, full_name, status, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.user,
        "+79990000000",
        1234567890,
        "loveparser_demo",
        "Demo Account",
        "active",
        JSON.stringify({ role: "owner", workspace: "demo" }),
      ],
    );

    await client.query(
      `INSERT INTO subscriptions (id, user_id, plan_code, plan_name, status, started_at, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.subscription,
        ids.user,
        "pro-monthly",
        "Pro Monthly",
        "active",
        now,
        expiresAt,
        JSON.stringify({ seats: 5, limits: { searches: 1000 } }),
      ],
    );

    await client.query(
      `INSERT INTO usage_limits (id, user_id, limit_key, limit_value, consumed_value, resets_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id)
       DO UPDATE SET limit_value = EXCLUDED.limit_value, consumed_value = EXCLUDED.consumed_value, resets_at = EXCLUDED.resets_at`,
      [ids.usageLimit, ids.user, "searches_per_day", 500, 42, resetAt],
    );

    await client.query(
      `INSERT INTO telegram_sessions (id, user_id, session_data, is_active, device, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [ids.session, ids.user, Buffer.from("encrypted-session-data", "utf8"), true, "macOS", now],
    );

    await client.query(
      `INSERT INTO auth_states (id, user_id, state_token, twofa_secret, backup_codes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (state_token) DO NOTHING`,
      [
        ids.authState,
        ids.user,
        "demo-state-token",
        "JBSWY3DPEHPK3PXP",
        JSON.stringify(["ABCD-1234", "EFGH-5678"]),
        authExpires,
      ],
    );

    await client.query(
      `INSERT INTO parsing_history (id, user_id, query, status, result_count, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.parsingHistory,
        ids.user,
        "growth marketing",
        "completed",
        18,
        JSON.stringify({ durationMs: 1200 }),
      ],
    );

    await client.query(
      `INSERT INTO parsed_channels (id, parsing_history_id, channel_id, title, username, member_count, is_verified, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (parsing_history_id, channel_id) DO NOTHING`,
      [
        ids.parsedChannel,
        ids.parsingHistory,
        "1450000000000",
        "Growth Hackers",
        "growthhackers",
        42000,
        true,
        JSON.stringify({ language: "ru" }),
      ],
    );

    await client.query(
      `INSERT INTO audience_segments (id, user_id, name, description, filters, source_parsing_id, total_recipients, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, name) DO NOTHING`,
      [
        ids.segment,
        ids.user,
        "Warm Leads",
        "Active community managers",
        JSON.stringify({ region: "RU" }),
        ids.parsingHistory,
        1280,
        "ready",
      ],
    );

    await client.query(
      `INSERT INTO broadcast_campaigns (id, user_id, segment_id, title, content, status, scheduled_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.campaign,
        ids.user,
        ids.segment,
        "November Promo",
        "🔥 Новые инструменты парсинга уже доступны",
        "scheduled",
        new Date(now.getTime() + 1000 * 60 * 60),
        JSON.stringify({ channel: "telegram" }),
      ],
    );

    await client.query(
      `INSERT INTO broadcast_logs (id, campaign_id, user_id, recipient, status, metadata, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.broadcastLog,
        ids.campaign,
        ids.user,
        "@demo_recipient",
        "sent",
        JSON.stringify({ attempt: 1 }),
        null,
      ],
    );

    await client.query(
      `INSERT INTO payments (id, user_id, subscription_id, amount, currency, status, provider, transaction_id, payload, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        ids.payment,
        ids.user,
        ids.subscription,
        3990,
        "RUB",
        "paid",
        "robokassa",
        "demo-transaction-001",
        JSON.stringify({ invoiceId: "inv-001" }),
        now,
      ],
    );

    await client.query(
      `INSERT INTO error_logs (id, user_id, level, message, stacktrace, context)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.errorLog,
        ids.user,
        "error",
        "Example worker failure",
        "Error: timeout at Worker",
        JSON.stringify({ worker: "telegram-parser" }),
      ],
    );

    await client.query(
      `INSERT INTO notification_queue (id, user_id, campaign_id, channel, payload, scheduled_at, status, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.notification,
        ids.user,
        ids.campaign,
        "email",
        JSON.stringify({ subject: "Добро пожаловать", body: "Спасибо за регистрацию" }),
        new Date(now.getTime() + 1000 * 60 * 15),
        "pending",
        0,
      ],
    );

    await client.query("COMMIT");
    logger.info("Database seed data applied successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Failed to seed database", { error });
    throw error;
  } finally {
    client.release();
    await closeDatabasePool();
  }
}

seed().catch((error) => {
  logger.error("Database seeding script failed", { error });
  process.exit(1);
});
