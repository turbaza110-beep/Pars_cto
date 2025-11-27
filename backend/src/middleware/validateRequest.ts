import { FastifyReply, FastifyRequest } from "fastify";
import { ZodError, ZodTypeAny } from "zod";

import { ValidationError } from "@/utils/errors";

export type RequestSchema = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validateRequest(schema: RequestSchema) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      if (schema.body) {
        request.body = schema.body.parse(request.body);
      }

      if (schema.query) {
        request.query = schema.query.parse(request.query);
      }

      if (schema.params) {
        request.params = schema.params.parse(request.params);
      }
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError("Invalid request", error.flatten());
      }

      throw error;
    }
  };
}
