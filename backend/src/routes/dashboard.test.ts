import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";

import { createServer } from "@/server";
import { config } from "@/config/config";
import { pgPool } from "@/utils/clients";

vi.mock("@/middleware/rateLimitMiddleware", () => ({
  rateLimitMiddleware: vi.fn(),
}));

let currentUserId = "user-123";
vi.mock("@/middleware/getCurrentUser", () => ({
  getCurrentUser: vi.fn(async (request) => {
    request.user = { id: currentUserId };
  }),
}));

vi.mock("@/services/auth/tokenBlacklist.service", () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  blacklistToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/redis.service", () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  (globalThis as Record<string, unknown>).__redisStore = store;

  const touchEntry = (key: string) => {
    const entry = store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }

    return entry;
  };

  const client = {
    async get(key: string) {
      return touchEntry(key)?.value ?? null;
    },
    async setEx(key: string, ttlSeconds: number, value: string) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    },
    async del(key: string) {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    },
    async ttl(key: string) {
      const entry = touchEntry(key);
      if (!entry) {
        return -2;
      }

      if (entry.expiresAt === 0) {
        return -1;
      }

      return Math.max(Math.ceil((entry.expiresAt - Date.now()) / 1000), 0);
    },
  };

  const api = {
    withRedisClient: async <T>(executor: (client: typeof client) => Promise<T> | T) => executor(client),
    acquireRedisClient: async () => client,
    releaseRedisClient: () => undefined,
    initializeRedisService: async () => undefined,
    shutdownRedisService: async () => undefined,
    checkRedisHealth: async () => true,
    getRedisPoolStats: () => ({ initialized: true, available: 1, inUse: 0, pending: 0 }),
  } satisfies typeof import("@/services/redis.service");

  return api;
});

type UserRowMock = {
  full_name: string | null;
  telegram_username: string | null;
  phone_number: string | null;
  profile: unknown;
};

type SubscriptionRowMock = {
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  expires_at: Date | null;
  metadata: unknown;
};

type UsageLimitRowMock = {
  limit_key: string;
  limit_value: number | null;
  consumed_value: number | null;
};

type ParsingActivityRowMock = {
  id: string;
  query: string | null;
  status: string | null;
  created_at: Date;
};

type AudienceActivityRowMock = {
  id: string;
  name: string | null;
  created_at: Date;
};

type BroadcastActivityRowMock = {
  id: string;
  title: string | null;
  status: string | null;
  created_at: Date;
};

interface DashboardScenario {
  user: UserRowMock | null;
  subscription: SubscriptionRowMock | null;
  usageLimits: UsageLimitRowMock[];
  totals: {
    channels: number;
    audience: number;
    broadcasts: number;
  };
  parsingActivities: ParsingActivityRowMock[];
  audienceActivities: AudienceActivityRowMock[];
  broadcastActivities: BroadcastActivityRowMock[];
}

const DEFAULT_USER_ID = "user-123";
const DASHBOARD_ENDPOINT = "/api/v1/dashboard";

const queryMock = vi.spyOn(pgPool, "query");
let scenario: DashboardScenario;

beforeEach(() => {
  scenario = createDefaultScenario();
  currentUserId = DEFAULT_USER_ID;
  clearRedisStore();
  queryMock.mockReset();
  queryMock.mockImplementation(async (queryText: unknown) => {
    const sql = normalizeSql(queryText);

    if (sql.includes("from users")) {
      return buildResult(scenario.user ? [scenario.user] : []);
    }

    if (sql.includes("from subscriptions")) {
      return buildResult(scenario.subscription ? [scenario.subscription] : []);
    }

    if (sql.includes("from usage_limits")) {
      return buildResult(scenario.usageLimits);
    }

    if (sql.includes("join parsed_channels")) {
      return buildResult([{ total: scenario.totals.channels }]);
    }

    if (sql.includes("count(*)::bigint as total from audience_segments")) {
      return buildResult([{ total: scenario.totals.audience }]);
    }

    if (sql.includes("from broadcast_logs")) {
      return buildResult([{ total: scenario.totals.broadcasts }]);
    }

    if (sql.includes("select id, query, status, created_at from parsing_history")) {
      return buildResult(scenario.parsingActivities);
    }

    if (sql.includes("select id, name, created_at from audience_segments")) {
      return buildResult(scenario.audienceActivities);
    }

    if (sql.includes("select id, title, status, created_at from broadcast_campaigns")) {
      return buildResult(scenario.broadcastActivities);
    }

    throw new Error(`Unhandled query: ${sql}`);
  });
});

afterEach(() => {
  queryMock.mockReset();
});

describe("GET /api/v1/dashboard", () => {
  it("returns 401 when authorization header is missing", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server).get(DASHBOARD_ENDPOINT);
      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("returns expired subscription state", async () => {
    scenario.subscription = {
      plan_code: "trial-weekly",
      plan_name: "Trial Week",
      status: "inactive",
      expires_at: new Date("2020-01-01T00:00:00Z"),
      metadata: JSON.stringify({ autoRenew: true }),
    };

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get(DASHBOARD_ENDPOINT)
        .set("Authorization", buildAuthHeader(DEFAULT_USER_ID));

      expect(response.status).toBe(200);
      expect(response.body.subscription).toMatchObject({
        plan: "week",
        status: "expired",
        renewal_status: "expired",
      });
    } finally {
      await app.close();
    }
  });

  it("returns active subscription details with limits and stats", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get(DASHBOARD_ENDPOINT)
        .set("Authorization", buildAuthHeader(DEFAULT_USER_ID));

      expect(response.status).toBe(200);
      expect(response.body.user_profile).toMatchObject({
        name: "John Doe",
        username: "@johnny",
        phone: "+79000000000",
      });
      expect(response.body.subscription).toMatchObject({
        plan: "month",
        status: "active",
        renewal_status: "auto",
      });
      expect(response.body.limits).toMatchObject({
        parsing_limit: 50,
        parsing_used: 5,
        audience_limit: 10,
        audience_used: 2,
        broadcast_limit: 25,
        broadcast_used: 1,
      });
      expect(response.body.stats).toMatchObject({
        total_channels_found: 120,
        total_audience_analyzed: 8,
        total_broadcasts_sent: 3,
      });
      expect(response.body.stats.recent_activity[0]).toMatchObject({ type: "parsing" });
    } finally {
      await app.close();
    }
  });

  it("handles zero usage limits", async () => {
    scenario.usageLimits = [
      { limit_key: "searches_per_day", limit_value: 0, consumed_value: 0 },
      { limit_key: "audience_exports", limit_value: 0, consumed_value: 0 },
      { limit_key: "broadcast_messages", limit_value: 0, consumed_value: 0 },
    ];

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get(DASHBOARD_ENDPOINT)
        .set("Authorization", buildAuthHeader(DEFAULT_USER_ID));

      expect(response.status).toBe(200);
      expect(response.body.limits.parsing_limit).toBe(0);
      expect(response.body.limits.audience_limit).toBe(0);
      expect(response.body.limits.broadcast_limit).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("serves cached dashboard payloads", async () => {
    const app = await buildServer();
    try {
      await request(app.server)
        .get(DASHBOARD_ENDPOINT)
        .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
        .expect(200);

      expect(queryMock).toHaveBeenCalled();
      queryMock.mockClear();

      await request(app.server)
        .get(DASHBOARD_ENDPOINT)
        .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
        .expect(200);

      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function createDefaultScenario(): DashboardScenario {
  return {
    user: {
      full_name: "John Doe",
      telegram_username: "johnny",
      phone_number: "+79000000000",
      profile: JSON.stringify({
        avatarUrl: "https://cdn.example.com/avatar.jpg",
        telegram: {
          username: "johnny",
          firstName: "John",
          lastName: "Doe",
        },
      }),
    },
    subscription: {
      plan_code: "pro-monthly",
      plan_name: "Pro Monthly",
      status: "active",
      expires_at: new Date("2099-01-15T23:59:59Z"),
      metadata: JSON.stringify({ autoRenew: true }),
    },
    usageLimits: [
      { limit_key: "searches_per_day", limit_value: 50, consumed_value: 5 },
      { limit_key: "audience_exports", limit_value: 10, consumed_value: 2 },
      { limit_key: "broadcast_messages", limit_value: 25, consumed_value: 1 },
    ],
    totals: {
      channels: 120,
      audience: 8,
      broadcasts: 3,
    },
    parsingActivities: [
      { id: "ph-1", query: "Crypto", status: "completed", created_at: new Date("2025-01-15T10:30:00Z") },
    ],
    audienceActivities: [
      { id: "aud-1", name: "VC Leads", created_at: new Date("2025-01-15T09:00:00Z") },
    ],
    broadcastActivities: [
      { id: "bc-1", title: "Promo", status: "scheduled", created_at: new Date("2025-01-15T08:00:00Z") },
    ],
  };
}

async function buildServer(): Promise<FastifyInstance> {
  const app = await createServer();
  await app.ready();
  return app;
}

function buildAuthHeader(userId: string) {
  const token = jwt.sign({ sub: userId }, config.security.jwtSecret, { expiresIn: "1h" });
  return `Bearer ${token}`;
}

function buildResult<T>(rows: T[]) {
  return {
    rowCount: rows.length,
    rows,
  } as { rowCount: number; rows: T[] };
}

function normalizeSql(input: unknown) {
  if (typeof input === "string") {
    return collapseWhitespace(input.toLowerCase());
  }

  if (typeof input === "object" && input && "text" in (input as Record<string, unknown>)) {
    const text = (input as { text?: string }).text ?? "";
    return collapseWhitespace(text.toLowerCase());
  }

  return "";
}

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function clearRedisStore() {
  const store = (globalThis as Record<string, unknown>).__redisStore as Map<string, { value: string; expiresAt: number }> | undefined;
  store?.clear();
}
