import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { config } from "@/config/config";
import { encryptSession, decryptSession } from "@/services/telegram/sessionEncryption";
import { pgPool } from "@/utils/clients";
import { AppError } from "@/utils/errors";
import { logger } from "@/utils/logger";

const CONNECTION_RETRIES = 5;

export interface TelegramAuthState {
  phoneNumber: string;
  phoneCodeHash: string;
  sessionString: string;
}

export interface PersistedTelegramSession {
  id: string;
  userId: string;
  lastUsedAt: Date;
}

export interface RestoredTelegramSession extends PersistedTelegramSession {
  sessionString: string;
}

export interface TelegramAuthorizationResult {
  telegramUser: Api.User;
  sessionString: string;
}

interface TelegramSessionRow {
  id: string;
  user_id: string;
  session_data: Buffer;
  last_used_at: Date;
}

export class TelegramSessionManager {
  private readonly apiId: number;
  private readonly apiHash: string;

  constructor() {
    if (!config.telegram.apiId || !config.telegram.apiHash) {
      throw new AppError("Telegram credentials are missing", { code: "SERVICE_UNAVAILABLE", statusCode: 503 });
    }

    this.apiId = config.telegram.apiId;
    this.apiHash = config.telegram.apiHash;
  }

  private createClient(sessionString = "") {
    const session = new StringSession(sessionString);
    return new TelegramClient(session, this.apiId, this.apiHash, {
      connectionRetries: CONNECTION_RETRIES,
    });
  }

  public async sendCode(phoneNumber: string) {
    const client = this.createClient();
    try {
      await client.connect();
      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId: this.apiId,
          apiHash: this.apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            allowAppHash: true,
            currentNumber: true,
            allowMissedCall: false,
          }),
        }),
      );

      const sessionString = client.session.save();
      return { phoneCodeHash: result.phoneCodeHash, sessionString };
    } finally {
      await this.safeDisconnect(client);
    }
  }

  public async verifyCode(state: TelegramAuthState, code: string, password?: string): Promise<TelegramAuthorizationResult> {
    const client = this.createClient(state.sessionString);

    try {
      await client.connect();

      try {
        const authorization = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: state.phoneNumber,
            phoneCodeHash: state.phoneCodeHash,
            phoneCode: code,
          }),
        );

        const sessionString = client.session.save();
        const telegramUser = this.extractAuthorizedUser(authorization);
        return { telegramUser, sessionString };
      } catch (error) {
        const errorMessage = (error as { errorMessage?: string }).errorMessage ?? (error as Error).message;
        if (errorMessage === "SESSION_PASSWORD_NEEDED" || errorMessage === "SESSION_PASSWORD_NEEDED#") {
          if (!password) {
            throw error;
          }

          const authorization = await this.completePasswordSignIn(client, password);
          const sessionString = client.session.save();
          const telegramUser = this.extractAuthorizedUser(authorization);
          return { telegramUser, sessionString };
        }

        throw error;
      }
    } finally {
      await this.safeDisconnect(client);
    }
  }

  private async completePasswordSignIn(client: TelegramClient, password: string) {
    const passwordInfo = await client.invoke(new Api.account.GetPassword());
    const passwordSrp = await client.computePasswordSrp(passwordInfo, password);
    return client.invoke(new Api.auth.CheckPassword({ password: passwordSrp }));
  }

  private extractAuthorizedUser(authorization: { user?: Api.User }) {
    if (authorization.user instanceof Api.User) {
      return authorization.user;
    }

    if (authorization.user) {
      return authorization.user;
    }

    throw new AppError("Unable to extract Telegram user from authorization response");
  }

  private async safeDisconnect(client: TelegramClient) {
    try {
      await client.disconnect();
    } catch (error) {
      logger.warn("Failed to disconnect Telegram client", { error });
    }
  }

  public async persistSession(userId: string, sessionString: string, device?: string): Promise<PersistedTelegramSession> {
    const encrypted = encryptSession(sessionString);
    const normalizedDevice = device ? device.slice(0, 128) : null;
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");
      await client.query("UPDATE telegram_sessions SET is_active = false, updated_at = NOW() WHERE user_id = $1", [userId]);
      const result = await client.query<TelegramSessionRow>(
        `INSERT INTO telegram_sessions (user_id, session_data, is_active, device, last_used_at)
         VALUES ($1, $2, true, $3, NOW())
         RETURNING id, user_id, session_data, last_used_at`,
        [userId, encrypted, normalizedDevice],
      );
      await client.query("COMMIT");

      return {
        id: result.rows[0].id,
        userId: result.rows[0].user_id,
        lastUsedAt: result.rows[0].last_used_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Failed to persist Telegram session", { error, userId });
      throw error;
    } finally {
      client.release();
    }
  }

  public async restoreSession(userId: string): Promise<RestoredTelegramSession | null> {
    const result = await pgPool.query<TelegramSessionRow>(
      `SELECT id, user_id, session_data, last_used_at
       FROM telegram_sessions
       WHERE user_id = $1 AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const sessionString = decryptSession(result.rows[0].session_data);
    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      lastUsedAt: result.rows[0].last_used_at,
      sessionString,
    };
  }
}
