import { FastifyInstance } from "fastify";

import { config } from "@/config/config";
import { logger } from "@/utils/logger";

const getDurationMs = (start?: bigint) => {
  if (!start) {
    return undefined;
  }

  const diff = Number(process.hrtime.bigint() - start) / 1_000_000;
  return Math.round(diff * 100) / 100;
};

export function registerRequestLogger(app: FastifyInstance) {
  app.addHook("onRequest", (request, reply, done) => {
    request.requestContext = { startTime: process.hrtime.bigint() };
    reply.header(config.server.requestIdHeader, request.id);

    logger.info("Incoming request", {
      requestId: request.id,
      method: request.method,
      url: request.url,
      ip: request.ip,
    });

    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const durationMs = getDurationMs(request.requestContext?.startTime) ?? 0;

    logger.info("Request completed", {
      requestId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs,
      userId: request.user?.id,
    });

    done();
  });
}
