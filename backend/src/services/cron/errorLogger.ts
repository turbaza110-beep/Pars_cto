import { pgPool } from "@/utils/clients";
import { logger } from "@/utils/logger";

export async function logCronError(
  context: string,
  message: string,
  error: unknown,
  userId?: string,
): Promise<void> {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stacktrace = error instanceof Error ? error.stack : null;

    await pgPool.query(
      `
        INSERT INTO error_logs (user_id, level, message, stacktrace, context, created_at, expires_at)
        VALUES ($1, 'error', $2, $3, $4, NOW(), NOW() + INTERVAL '2 days')
      `,
      [userId ?? null, message, stacktrace, JSON.stringify({ context, errorMessage })],
    );
  } catch (persistError) {
    logger.error("Failed to persist cron error", { context, persistError });
  }
}
