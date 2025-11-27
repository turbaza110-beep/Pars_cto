import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { config } from "@/config/config";

let telegramClient: TelegramClient | null = null;

function createTelegramClient() {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    throw new Error("Telegram credentials are not configured");
  }

  const session = new StringSession(config.telegram.session);
  telegramClient = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 5,
  });

  return telegramClient;
}

export async function ensureTelegramClient() {
  const client = telegramClient ?? createTelegramClient();

  if (!client.connected) {
    await client.connect();
  }

  return client;
}
