import { ZodError } from "zod";

export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type TelegramErrorCode =
  | "INVALID_PHONE_NUMBER"
  | "PHONE_MIGRATE"
  | "PHONE_NUMBER_OCCUPIED"
  | "SESSION_PASSWORD_NEEDED"
  | "INVALID_CODE"
  | "CODE_INVALID"
  | "CODE_EXPIRED";

export type ErrorCode =
  | "AUTH_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "SUBSCRIPTION_REQUIRED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR"
  | TelegramErrorCode;

interface AppErrorOptions {
  statusCode?: number;
  code?: ErrorCode;
  details?: unknown;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(message: string, options?: AppErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options?.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
    this.code = options?.code ?? "INTERNAL_SERVER_ERROR";
    this.details = options?.details;
  }
}

export class AuthError extends AppError {
  constructor(message = "Authentication required", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.UNAUTHORIZED, code: "AUTH_ERROR", details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.TOO_MANY_REQUESTS, code: "RATE_LIMIT_EXCEEDED", details });
  }
}

export class SubscriptionError extends AppError {
  constructor(message = "Active subscription required", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.PAYMENT_REQUIRED, code: "SUBSCRIPTION_REQUIRED", details });
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation error", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY, code: "VALIDATION_ERROR", details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.FORBIDDEN, code: "FORBIDDEN", details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.NOT_FOUND, code: "NOT_FOUND", details });
  }
}

export class TelegramAuthError extends AppError {
  constructor(code: TelegramErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message, { statusCode, code, details });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", details?: unknown) {
    super(message, { statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE, code: "SERVICE_UNAVAILABLE", details });
  }
}

export interface ApiErrorResponse {
  error: {
    message: string;
    code: ErrorCode;
    statusCode: number;
    details?: unknown;
    requestId?: string;
  };
}

export function formatError(error: unknown, requestId?: string): ApiErrorResponse {
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
        requestId,
      },
    };
  }

  if (error instanceof ZodError) {
    const details = error.flatten();
    return {
      error: {
        message: "Validation error",
        code: "VALIDATION_ERROR",
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        details,
        requestId,
      },
    };
  }

  const fallbackMessage = error instanceof Error ? error.message : "Internal Server Error";

  return {
    error: {
      message: fallbackMessage || "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      requestId,
    },
  };
}
