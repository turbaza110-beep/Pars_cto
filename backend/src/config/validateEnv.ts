import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
  JWT_SECRET: z.string().min(10).default("changeme-secret"),
  SESSION_ENCRYPTION_KEY: z.string().min(32).default("development-session-encryption-key-please-change"),
  DATABASE_URL: z.string().url().optional(),
  POSTGRES_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  TELEGRAM_API_ID: z.coerce.number().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().optional(),
  REQUEST_BODY_LIMIT: z.coerce.number().default(1_048_576),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
});

export type EnvSchema = z.infer<typeof envSchema>;

export function validateEnv(): EnvSchema {
  return envSchema.parse(process.env);
}
