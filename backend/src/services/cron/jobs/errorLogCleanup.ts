import { pgPool } from "@/utils/clients";
import { logger } from "@/utils/logger";

const RETENTION_DAYS = 2;

export async function runErrorLogCleanup() {
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  logger.info("Starting error log cleanup", { cutoffDate: cutoffDate.toISOString() });

  try {
    const result = await pgPool.query(
      `
        DELETE FROM error_logs
        WHERE created_at < $1
        RETURNING id
      `,
      [cutoffDate.toISOString()],
    );

    logger.info("Error log cleanup completed", {
      deletedCount: result.rowCount,
    });
  } catch (error) {
    logger.error("Error log cleanup failed", { error });
    await persistError("error_log_cleanup", "Failed error log cleanup job", error);
    throw error;
  }
}

async function persistError(context: string, message: string, error: unknown): Promise<void> {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stacktrace = error instanceof Error ? error.stack : null;
    await pgPool.query(
      `
        INSERT INTO error_logs (level, message, stacktrace, context, created_at, expires_at)
        VALUES ('error', $1, $2, $3, NOW(), NOW() + INTERVAL '2 days')
      `,
      [message, stacktrace, JSON.stringify({ context, errorMessage })],
    );
  } catch (persistError) {
    logger.error("Failed to persist error log cleanup error", { persistError });
  }
}
