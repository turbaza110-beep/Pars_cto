import { createClient, RedisClientType } from "redis";

import { config } from "@/config/config";
import { logger } from "@/utils/logger";

const MIN_POOL_SIZE = 1;
const MAX_POOL_SIZE = 5;
const ACQUIRE_TIMEOUT_MS = 5_000;

type ManagedRedisClient = RedisClientType;

type PendingRequest = {
  resume: (client: ManagedRedisClient) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const availableClients: ManagedRedisClient[] = [];
const inUseClients = new Set<ManagedRedisClient>();
const pendingRequests: PendingRequest[] = [];
let initialized = false;

function createManagedClient(label: string): ManagedRedisClient {
  const client = createClient({
    url: config.redis.url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 2_000),
    },
  });

  client.on("ready", () => logger.info("Redis client ready", { label }));
  client.on("error", (error) => logger.error("Redis client error", { label, error }));
  client.on("end", () => logger.warn("Redis client disconnected", { label }));
  client.on("reconnecting", () => logger.warn("Redis client reconnecting", { label }));

  return client;
}

async function ensureClientConnected(client: ManagedRedisClient) {
  if (!client.isOpen) {
    await client.connect();
  }
}

async function hydratePool() {
  if (initialized) {
    return;
  }

  const bootstrapClients = [] as Promise<void>[];
  for (let i = 0; i < MIN_POOL_SIZE; i += 1) {
    const client = createManagedClient(`pool-${i + 1}`);
    bootstrapClients.push(
      ensureClientConnected(client).then(() => {
        availableClients.push(client);
      }),
    );
  }

  await Promise.all(bootstrapClients);
  initialized = true;
  logger.info("Redis connection pool initialized", { size: availableClients.length });
}

function totalClients() {
  return availableClients.length + inUseClients.size;
}

async function acquireFromPool(timeoutMs = ACQUIRE_TIMEOUT_MS): Promise<ManagedRedisClient> {
  await hydratePool();

  if (availableClients.length > 0) {
    const client = availableClients.pop() as ManagedRedisClient;
    inUseClients.add(client);
    await ensureClientConnected(client);
    return client;
  }

  if (totalClients() < MAX_POOL_SIZE) {
    const client = createManagedClient(`pool-dynamic-${Date.now()}`);
    await ensureClientConnected(client);
    inUseClients.add(client);
    return client;
  }

  return new Promise<ManagedRedisClient>((resolve, reject) => {
    const entry = {} as PendingRequest;

    entry.timeout = setTimeout(() => {
      const error = new Error("Timed out waiting for Redis client from pool");
      const index = pendingRequests.indexOf(entry);
      if (index >= 0) {
        pendingRequests.splice(index, 1);
      }
      reject(error);
    }, timeoutMs);

    entry.resume = (client) => {
      clearTimeout(entry.timeout);
      ensureClientConnected(client)
        .then(() => {
          inUseClients.add(client);
          resolve(client);
        })
        .catch(reject);
    };

    entry.reject = (error) => {
      clearTimeout(entry.timeout);
      reject(error);
    };

    pendingRequests.push(entry);
  });
}

function releaseToPool(client: ManagedRedisClient) {
  if (!inUseClients.has(client)) {
    return;
  }

  inUseClients.delete(client);
  const pending = pendingRequests.shift();

  if (pending) {
    pending.resume(client);
    return;
  }

  if (availableClients.length + 1 > MAX_POOL_SIZE) {
    void client.quit().catch((error) => logger.error("Failed to close idle Redis client", { error }));
    return;
  }

  availableClients.push(client);
}

function rejectPendingRequests(error: Error) {
  while (pendingRequests.length > 0) {
    const pending = pendingRequests.shift();
    if (!pending) {
      continue;
    }
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
}

export async function initializeRedisService() {
  await hydratePool();
}

export async function acquireRedisClient() {
  return acquireFromPool();
}

export function releaseRedisClient(client: ManagedRedisClient) {
  releaseToPool(client);
}

export async function withRedisClient<T>(executor: (client: ManagedRedisClient) => Promise<T> | T) {
  const client = await acquireRedisClient();
  try {
    return await executor(client);
  } finally {
    releaseRedisClient(client);
  }
}

export async function checkRedisHealth() {
  try {
    const pong = await withRedisClient((client) => client.ping());
    return pong === "PONG";
  } catch (error) {
    logger.error("Redis health check failed", { error });
    return false;
  }
}

export async function shutdownRedisService() {
  const shutdownError = new Error("Redis service shutting down");
  rejectPendingRequests(shutdownError);

  const clients = [...availableClients, ...inUseClients];
  availableClients.length = 0;
  inUseClients.clear();

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.quit();
      } catch (error) {
        logger.error("Failed to close Redis client", { error });
      }
    }),
  );

  initialized = false;
  logger.info("Redis pool shut down");
}

export function getRedisPoolStats() {
  return {
    initialized,
    available: availableClients.length,
    inUse: inUseClients.size,
    pending: pendingRequests.length,
  };
}
