import { FastifyReply, FastifyRequest } from "fastify";

import { config } from "@/config/config";
import { withRedisClient } from "@/services/redis.service";
import { RateLimitError } from "@/utils/errors";
import { logger } from "@/utils/logger";

function resolveIdentifier(request: FastifyRequest): string {
  return request.user?.id ?? request.ip ?? request.id;
}

export async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const key = `rate-limit:${resolveIdentifier(request)}`;
  const expirationSeconds = Math.ceil(config.rateLimit.windowMs / 1000);

  try {
    await withRedisClient(async (client) => {
      const transaction = client.multi();
      transaction.incr(key);
      transaction.expire(key, expirationSeconds, "NX");
      const results = await transaction.exec();
      const requestCount = Number(results?.[0]?.[1] ?? 0);

      if (requestCount > config.rateLimit.maxRequests) {
        reply.header("Retry-After", expirationSeconds.toString());
        throw new RateLimitError("Rate limit exceeded", {
          limit: config.rateLimit.maxRequests,
          windowMs: config.rateLimit.windowMs,
        });
      }
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }

    logger.error("Failed to enforce rate limiting", { error });
  }
}
