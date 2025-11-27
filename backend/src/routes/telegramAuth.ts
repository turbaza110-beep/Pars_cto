import { randomUUID } from "node:crypto";

import { FastifyInstance } from "fastify";
import { z } from "zod";

import { generateAccessToken } from "@/services/auth/jwtService";
import {
  ensureDefaultUsageLimits,
  ensureFreeSubscription,
  createUser,
  getUserByTelegramId,
  updateTelegramProfile,
} from "@/services/user/userService";
import { TelegramSessionManager, TelegramAuthState } from "@/services/telegram/sessionManager";
import { withRedisClient } from "@/services/redis.service";
import { HTTP_STATUS, RateLimitError, TelegramAuthError, TelegramErrorCode, ValidationError } from "@/utils/errors";
import { logger } from "@/utils/logger";
import { Api } from "telegram";

const AUTH_STATE_TTL_SECONDS = 10 * 60;
const SEND_CODE_RATE_LIMIT_SECONDS = 60;
const AUTH_STATE_KEY_PREFIX = "telegram:auth:state";
const RATE_LIMIT_KEY_PREFIX = "telegram:auth:send";

const TELEGRAM_ERROR_MAPPINGS: Record<string, { code: TelegramErrorCode; message: string; status: number }> = {
  PHONE_NUMBER_INVALID: { code: "INVALID_PHONE_NUMBER", message: "Invalid phone number", status: HTTP_STATUS.BAD_REQUEST },
  PHONE_NUMBER_OCCUPIED: {
    code: "PHONE_NUMBER_OCCUPIED",
    message: "Phone number is already registered",
    status: HTTP_STATUS.BAD_REQUEST,
  },
  SESSION_PASSWORD_NEEDED: {
    code: "SESSION_PASSWORD_NEEDED",
    message: "Two-factor authentication required",
    status: HTTP_STATUS.UNAUTHORIZED,
  },
  PASSWORD_HASH_INVALID: {
    code: "SESSION_PASSWORD_NEEDED",
    message: "Invalid two-factor password",
    status: HTTP_STATUS.UNAUTHORIZED,
  },
  SRP_PASSWORD_CHANGED: {
    code: "SESSION_PASSWORD_NEEDED",
    message: "Two-factor authentication password has changed",
    status: HTTP_STATUS.UNAUTHORIZED,
  },
  SRP_ID_INVALID: {
    code: "SESSION_PASSWORD_NEEDED",
    message: "Two-factor authentication password is invalid",
    status: HTTP_STATUS.UNAUTHORIZED,
  },
  PHONE_CODE_INVALID: {
    code: "CODE_INVALID",
    message: "Invalid verification code",
    status: HTTP_STATUS.BAD_REQUEST,
  },
  PHONE_CODE_EXPIRED: {
    code: "CODE_EXPIRED",
    message: "Verification code expired",
    status: HTTP_STATUS.BAD_REQUEST,
  },
  CODE_INVALID: { code: "CODE_INVALID", message: "Invalid verification code", status: HTTP_STATUS.BAD_REQUEST },
  INVALID_CODE: { code: "INVALID_CODE", message: "Invalid verification code", status: HTTP_STATUS.BAD_REQUEST },
  CODE_EXPIRED: { code: "CODE_EXPIRED", message: "Verification code expired", status: HTTP_STATUS.BAD_REQUEST },
  PHONE_CODE_EMPTY: { code: "CODE_INVALID", message: "Verification code is required", status: HTTP_STATUS.BAD_REQUEST },
  PHONE_CODE_HASH_EMPTY: { code: "CODE_INVALID", message: "Verification code is invalid", status: HTTP_STATUS.BAD_REQUEST },
};

const phoneSchema = z.object({
  phone_number: z
    .string({ required_error: "phone_number is required" })
    .trim()
    .regex(/^\+\d{10,15}$/, "Phone number must be in international format"),
});

const verifySchema = z.object({
  auth_session_id: z.string().uuid(),
  code: z.string().regex(/^\d{3,6}$/, "Code must contain 3-6 digits"),
  password: z.string().min(1).optional(),
});

let sessionManager: TelegramSessionManager | null = null;

function getSessionManager() {
  if (!sessionManager) {
    sessionManager = new TelegramSessionManager();
  }

  return sessionManager;
}

function normalizePhoneNumber(input: string) {
  const sanitized = input.replace(/[\s()-]/g, "");
  if (sanitized.startsWith("+")) {
    return sanitized;
  }
  return `+${sanitized.replace(/^\+/, "")}`;
}

async function storeAuthState(authSessionId: string, state: TelegramAuthState) {
  const key = `${AUTH_STATE_KEY_PREFIX}:${authSessionId}`;
  await withRedisClient((client) => client.setEx(key, AUTH_STATE_TTL_SECONDS, JSON.stringify(state)));
}

async function loadAuthState(authSessionId: string) {
  const key = `${AUTH_STATE_KEY_PREFIX}:${authSessionId}`;
  const payload = await withRedisClient((client) => client.get(key));
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as TelegramAuthState;
  } catch (error) {
    logger.error("Failed to parse Telegram auth state", { error, authSessionId });
    await withRedisClient((client) => client.del(key));
    return null;
  }
}

async function clearAuthState(authSessionId: string) {
  const key = `${AUTH_STATE_KEY_PREFIX}:${authSessionId}`;
  await withRedisClient((client) => client.del(key));
}

async function enforceSendCodeRateLimit(phoneNumber: string) {
  const key = `${RATE_LIMIT_KEY_PREFIX}:${phoneNumber}`;
  await withRedisClient(async (client) => {
    const ttl = await client.ttl(key);
    if (ttl > 0) {
      throw new RateLimitError("Too many verification requests", { retryAfter: ttl });
    }

    await client.setEx(key, SEND_CODE_RATE_LIMIT_SECONDS, "1");
  });
}

function handleTelegramRpcError(error: unknown): never {
  const errorMessage = (error as { errorMessage?: string; message?: string })?.errorMessage || (error as Error)?.message;
  if (!errorMessage) {
    throw error;
  }

  const normalized = errorMessage.toUpperCase();

  if (normalized.startsWith("FLOOD_WAIT")) {
    const waitSeconds = Number(normalized.split("_").pop());
    const retryAfter = Number.isFinite(waitSeconds) ? waitSeconds : SEND_CODE_RATE_LIMIT_SECONDS;
    throw new RateLimitError("Telegram rate limit exceeded", { retryAfter });
  }

  if (normalized.startsWith("PHONE_MIGRATE")) {
    const dcValue = Number(normalized.split("_").pop());
    const dc = Number.isFinite(dcValue) ? dcValue : undefined;
    throw new TelegramAuthError(
      "PHONE_MIGRATE",
      "Phone number is registered in a different region",
      HTTP_STATUS.BAD_REQUEST,
      { dc },
    );
  }

  const matched = TELEGRAM_ERROR_MAPPINGS[normalized];
  if (matched) {
    throw new TelegramAuthError(matched.code, matched.message, matched.status);
  }

  throw error;
}

function buildFullName(user: Api.User) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
}

async function syncUserFromTelegram(user: Api.User, fallbackPhone: string) {
  const telegramId = user.id?.toString();
  if (!telegramId) {
    throw new ValidationError("Telegram user id is missing");
  }

  const phoneNumber = user.phone ?? fallbackPhone;
  const username = user.username ?? undefined;
  const fullName = buildFullName(user) || undefined;

  const existing = await getUserByTelegramId(telegramId);
  if (!existing) {
    return createUser({
      phoneNumber,
      telegramId,
      telegramUsername: username,
      fullName,
      profile: {
        telegram: {
          firstName: user.firstName,
          lastName: user.lastName,
          languageCode: user.langCode,
        },
      },
    });
  }

  return updateTelegramProfile(existing.id, {
    phoneNumber,
    telegramId,
    telegramUsername: username,
    fullName,
  });
}

export async function registerTelegramAuthRoutes(app: FastifyInstance) {
  app.post("/send-code", async (request) => {
    const { phone_number } = phoneSchema.parse(request.body ?? {});
    const phoneNumber = normalizePhoneNumber(phone_number);

    await enforceSendCodeRateLimit(phoneNumber);

    try {
      const manager = getSessionManager();
      const { phoneCodeHash, sessionString } = await manager.sendCode(phoneNumber);
      const authSessionId = randomUUID();
      await storeAuthState(authSessionId, { phoneNumber, phoneCodeHash, sessionString });

      return {
        auth_session_id: authSessionId,
        phone_code_hash: phoneCodeHash,
      };
    } catch (error) {
      handleTelegramRpcError(error);
    }
  });

  app.post("/verify-code", async (request) => {
    const { auth_session_id, code, password } = verifySchema.parse(request.body ?? {});
    const authState = await loadAuthState(auth_session_id);

    if (!authState) {
      throw new ValidationError("Authentication session is invalid or has expired");
    }

    try {
      const manager = getSessionManager();
      const result = await manager.verifyCode(authState, code, password);
      const user = await syncUserFromTelegram(result.telegramUser, authState.phoneNumber);

      await ensureFreeSubscription(user.id);
      await ensureDefaultUsageLimits(user.id);

      const persistedSession = await manager.persistSession(
        user.id,
        result.sessionString,
        request.headers["user-agent"]?.toString(),
      );

      const accessToken = generateAccessToken({
        userId: user.id,
        sessionId: persistedSession.id,
        telegramId: user.telegramId,
      });

      await clearAuthState(auth_session_id);

      return {
        access_token: accessToken,
        user,
      };
    } catch (error) {
      handleTelegramRpcError(error);
    }
  });
}
