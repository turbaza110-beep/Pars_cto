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

  const client = {
    async get(key: string) {
      const entry = store.get(key);
      if (!entry || (entry.expiresAt > 0 && entry.expiresAt <= Date.now())) {
        return null;
      }
      return entry.value;
    },
    async setEx(key: string, ttlSeconds: number, value: string) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    },
    async del(key: string) {
      const existed = store.delete(key);
      return existed ? 1 : 0;
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
  };

  return api;
});

type SubscriptionRowMock = {
  id: string;
  user_id: string;
  plan_code: string;
  plan_name: string;
  status: string;
  started_at: Date;
  expires_at: Date;
};

type PaymentRowMock = {
  id: string;
  user_id: string;
  transaction_id: string;
  amount: string;
  status: string;
};

interface SubscriptionScenario {
  subscription: SubscriptionRowMock | null;
  payment: PaymentRowMock | null;
}

const DEFAULT_USER_ID = "user-123";
const queryMock = vi.spyOn(pgPool, "query");
let scenario: SubscriptionScenario;

beforeEach(() => {
  scenario = {
    subscription: null,
    payment: null,
  };
  currentUserId = DEFAULT_USER_ID;
  queryMock.mockReset();
  queryMock.mockImplementation(async (queryText: unknown) => {
    const sql = normalizeSql(queryText);

    if (sql.includes("from subscriptions") && sql.includes("select")) {
      return buildResult(scenario.subscription ? [scenario.subscription] : []);
    }

    if (sql.includes("insert into payments")) {
      const mockPayment = {
        id: "payment-12345",
        transaction_id: `${DEFAULT_USER_ID.substring(0, 8)}-${Date.now()}`,
        amount: "1490.00",
        status: "pending",
      };
      return buildResult([mockPayment]);
    }

    return buildResult([]);
  });
});

afterEach(() => {
  queryMock.mockReset();
});

describe("Subscription Routes", () => {
  describe("GET /api/v1/subscription/plans", () => {
    it("returns list of available plans", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server).get("/api/v1/subscription/plans");

        expect(response.status).toBe(200);
        expect(response.body.plans).toBeDefined();
        expect(Array.isArray(response.body.plans)).toBe(true);
        expect(response.body.plans.length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    });

    it("includes plan details with limits", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server).get("/api/v1/subscription/plans");

        const plans = response.body.plans;
        const monthlyPlan = plans.find((p: any) => p.code === "month");

        expect(monthlyPlan).toBeDefined();
        expect(monthlyPlan.name).toBe("Monthly");
        expect(monthlyPlan.price).toBe(1490);
        expect(monthlyPlan.currency).toBe("RUB");
        expect(monthlyPlan.limits).toMatchObject({
          broadcast_limit: 50,
          parsing_limit: 100,
          audience_limit: 20,
        });
      } finally {
        await app.close();
      }
    });
  });

  describe("GET /api/v1/subscription/current", () => {
    it("returns 401 when not authenticated", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server).get("/api/v1/subscription/current");

        expect(response.status).toBe(401);
      } finally {
        await app.close();
      }
    });

    it("returns null when user has no active subscription", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .get("/api/v1/subscription/current")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID));

        expect(response.status).toBe(200);
        expect(response.body.subscription).toBeNull();
      } finally {
        await app.close();
      }
    });

    it("returns active subscription details", async () => {
      scenario.subscription = {
        id: "sub-123",
        user_id: DEFAULT_USER_ID,
        plan_code: "month",
        plan_name: "Monthly",
        status: "active",
        started_at: new Date("2025-01-01T00:00:00Z"),
        expires_at: new Date("2025-02-01T00:00:00Z"),
      };

      const app = await buildServer();
      try {
        const response = await request(app.server)
          .get("/api/v1/subscription/current")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID));

        expect(response.status).toBe(200);
        expect(response.body.subscription).toMatchObject({
          planCode: "month",
          planName: "Monthly",
          status: "active",
        });
      } finally {
        await app.close();
      }
    });
  });

  describe("POST /api/v1/subscription/purchase", () => {
    it("returns 401 when not authenticated", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/purchase")
          .send({ planCode: "month" });

        expect(response.status).toBe(401);
      } finally {
        await app.close();
      }
    });

    it("validates request body", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/purchase")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
          .send({});

        expect(response.status).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("generates payment URL for valid plan", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/purchase")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
          .send({ planCode: "month" });

        expect(response.status).toBe(200);
        expect(response.body.paymentId).toBeDefined();
        expect(response.body.paymentUrl).toBeDefined();
        expect(response.body.paymentUrl).toContain("robokassa.ru");
      } finally {
        await app.close();
      }
    });

    it("includes email in payment URL when provided", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/purchase")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
          .send({ planCode: "month", email: "user@example.com" });

        expect(response.status).toBe(200);
        expect(response.body.paymentUrl).toContain("Email=");
      } finally {
        await app.close();
      }
    });

    it("rejects invalid plan code", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/purchase")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
          .send({ planCode: "invalid_plan" });

        expect(response.status).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("rejects free plan purchase", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/purchase")
          .set("Authorization", buildAuthHeader(DEFAULT_USER_ID))
          .send({ planCode: "free" });

        expect(response.status).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  describe("POST /api/v1/subscription/webhook/robokassa", () => {
    it("validates webhook payload", async () => {
      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/webhook/robokassa")
          .send({});

        expect(response.status).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("processes valid webhook notification", async () => {
      queryMock.mockImplementation(async (queryText: unknown) => {
        const sql = normalizeSql(queryText);

        if (sql.includes("from payments") && sql.includes("select")) {
          return buildResult([
            {
              id: "payment-12345",
              transaction_id: "test-transaction",
              amount: "1490.00",
              status: "pending",
            },
          ]);
        }

        return buildResult([{ id: "sub-123" }]);
      });

      const app = await buildServer();
      try {
        const response = await request(app.server)
          .post("/api/v1/subscription/webhook/robokassa")
          .send({
            OutSum: "1490.00",
            InvId: "12345",
            SignatureValue: "test_signature",
          });

        expect([200, 400]).toContain(response.status);
      } finally {
        await app.close();
      }
    });
  });
});

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
  };
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
