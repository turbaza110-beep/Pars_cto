import { FastifyInstance } from "fastify";

import { checkRedisHealth } from "@/services/redis.service";
import { pgPool } from "@/utils/clients";
import { ServiceUnavailableError } from "@/utils/errors";

const now = () => new Date().toISOString();

async function ensureDatabaseHealthy() {
  try {
    await pgPool.query("SELECT 1");
    return { status: "ok" as const };
  } catch (error) {
    throw new ServiceUnavailableError("PostgreSQL is unavailable", {
      details: { cause: (error as Error).message },
    });
  }
}

async function ensureRedisHealthy() {
  const healthy = await checkRedisHealth();
  if (!healthy) {
    throw new ServiceUnavailableError("Redis is unavailable");
  }

  return { status: "ok" as const };
}

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    timestamp: now(),
  }));

  app.get("/health/db", async () => {
    await ensureDatabaseHealthy();
    return {
      status: "ok",
      service: "postgres",
      timestamp: now(),
    };
  });

  app.get("/health/redis", async () => {
    await ensureRedisHealthy();
    return {
      status: "ok",
      service: "redis",
      timestamp: now(),
    };
  });
}
