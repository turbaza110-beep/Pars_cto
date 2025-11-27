import { Pool } from "pg";

import { config } from "@/config/config";
import { logger } from "@/utils/logger";

let pool: Pool | null = null;

function createPool(): Pool {
  const createdPool = new Pool({
    connectionString: config.database.url,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  createdPool.on("error", (error) => {
    logger.error("Unexpected PostgreSQL client error", { error });
  });

  return createdPool;
}

export function getDatabasePool(): Pool {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function initializeDatabase() {
  const dbPool = getDatabasePool();

  try {
    await dbPool.query("SELECT 1");
    logger.info("Connected to PostgreSQL");
  } catch (error) {
    logger.error("Failed to initialize PostgreSQL connection", { error });
    throw error;
  }
}

export async function closeDatabasePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
