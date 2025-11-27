import { randomUUID } from "node:crypto";

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import helmet from "@fastify/helmet";

import { config } from "@/config/config";
import { errorHandler } from "@/middleware/errorHandler";
import { rateLimitMiddleware } from "@/middleware/rateLimitMiddleware";
import { registerRequestLogger } from "@/middleware/requestLogger";
import { registerHealthRoutes } from "@/routes/health";
import { registerTelegramAuthRoutes } from "@/routes/telegramAuth";
import { registerAuthRoutes } from "@/routes/auth";
import { registerDashboardRoutes } from "@/routes/dashboard";
import { registerParsingRoutes } from "@/routes/parsing";
import { registerAudienceRoutes } from "@/routes/audience";

function getRequestId(headers: Record<string, string | string[] | undefined>) {
  const headerValue = headers[config.server.requestIdHeader] ?? headers["x-request-id"];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }

  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return headerValue[0];
  }

  return randomUUID();
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    bodyLimit: config.server.bodyLimit,
    requestIdHeader: config.server.requestIdHeader,
    genReqId: (request) => getRequestId(request.headers as Record<string, string | string[] | undefined>),
  });

  await app.register(cors, {
    origin: config.server.corsOrigins,
    credentials: true,
  });

  await app.register(helmet);
  await app.register(fastifyJwt, { secret: config.security.jwtSecret });

  registerRequestLogger(app);
  app.addHook("preHandler", rateLimitMiddleware);
  app.setErrorHandler(errorHandler);

  await app.register(registerHealthRoutes, { prefix: "/api" });
  await app.register(registerTelegramAuthRoutes, { prefix: "/api/v1/telegram/auth" });
  await app.register(registerAuthRoutes, { prefix: "/api/v1/auth" });
  await app.register(registerDashboardRoutes, { prefix: "/api/v1/dashboard" });
  await app.register(registerParsingRoutes, { prefix: "/api/v1/parsing" });
  await app.register(registerAudienceRoutes, { prefix: "/api/v1/audience" });

  return app;
}
