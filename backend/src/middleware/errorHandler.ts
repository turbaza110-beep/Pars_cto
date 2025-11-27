import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

import { formatError } from "@/utils/errors";
import { logger } from "@/utils/logger";

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  const formatted = formatError(error, request.id);
  const statusCode = formatted.error.statusCode;

  if (statusCode >= 500) {
    logger.error("Unhandled server error", {
      error,
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
  } else {
    logger.warn("Request failed", {
      error: formatted.error,
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
  }

  if (!reply.sent) {
    reply.status(statusCode).send(formatted);
  }
}
