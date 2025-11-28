import { validateEnv } from "@/config/validateEnv";

const DEFAULT_DATABASE_URL = "postgresql://love_parser:love_parser@localhost:5432/love_parser";
const DEFAULT_FRONTEND_URL = "http://localhost:5173";

const rawEnv = validateEnv();

const normalizedCorsOrigins = new Set<string>(["http://localhost:3000"]);

const addOrigin = (origin?: string | null) => {
  if (!origin) return;
  const trimmed = origin.trim();
  if (trimmed.length === 0) return;
  normalizedCorsOrigins.add(trimmed);
};

const maybeSplit = (value?: string) =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const allowAllCors = rawEnv.CORS_ORIGIN?.trim() === "*";
const parsedCorsOrigins = allowAllCors ? undefined : maybeSplit(rawEnv.CORS_ORIGIN);
const resolvedFrontendUrl = rawEnv.FRONTEND_URL ?? parsedCorsOrigins?.[0] ?? DEFAULT_FRONTEND_URL;

if (!allowAllCors) {
  addOrigin(resolvedFrontendUrl);
  parsedCorsOrigins?.forEach((origin) => addOrigin(origin));
}

const corsOriginConfig: boolean | string[] = allowAllCors ? true : Array.from(normalizedCorsOrigins);

export const config = {
  nodeEnv: rawEnv.NODE_ENV,
  server: {
    host: rawEnv.HOST,
    port: rawEnv.PORT,
    corsOrigins: corsOriginConfig,
    bodyLimit: rawEnv.REQUEST_BODY_LIMIT,
    requestIdHeader: "x-request-id",
  },
  security: {
    jwtSecret: rawEnv.JWT_SECRET,
    sessionEncryptionKey: rawEnv.SESSION_ENCRYPTION_KEY,
  },
  database: {
    url: rawEnv.DATABASE_URL ?? rawEnv.POSTGRES_URL ?? DEFAULT_DATABASE_URL,
  },
  redis: {
    url: rawEnv.REDIS_URL,
  },
  rateLimit: {
    windowMs: rawEnv.RATE_LIMIT_WINDOW_MS,
    maxRequests: rawEnv.RATE_LIMIT_MAX,
  },
  frontendUrl: resolvedFrontendUrl,
  telegram: {
    apiId: rawEnv.TELEGRAM_API_ID ?? 0,
    apiHash: rawEnv.TELEGRAM_API_HASH ?? "",
    session: rawEnv.TELEGRAM_SESSION ?? "",
  },
  robokassa: {
    merchantLogin: rawEnv.ROBOKASSA_MERCHANT_LOGIN,
    password1: rawEnv.ROBOKASSA_PASSWORD1,
    password2: rawEnv.ROBOKASSA_PASSWORD2,
    isTest: rawEnv.ROBOKASSA_IS_TEST,
    successUrl: rawEnv.ROBOKASSA_SUCCESS_URL ?? `${resolvedFrontendUrl}/payment/success`,
    failUrl: rawEnv.ROBOKASSA_FAIL_URL ?? `${resolvedFrontendUrl}/payment/fail`,
  },
} as const;

export type AppConfig = typeof config;
