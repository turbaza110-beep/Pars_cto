import { closeDatabasePool, getDatabasePool, initializeDatabase } from "@/database/connection";
import { initializeRedisService, shutdownRedisService } from "@/services/redis.service";

export const pgPool = getDatabasePool();

export async function connectDatastores() {
  await initializeDatabase();
  await initializeRedisService();
}

export async function disconnectDatastores() {
  await closeDatabasePool();
  await shutdownRedisService();
}
