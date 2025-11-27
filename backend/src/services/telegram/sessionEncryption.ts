import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { config } from "@/config/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const secret = config.security.sessionEncryptionKey;
  if (!secret) {
    throw new Error("SESSION_ENCRYPTION_KEY is not configured");
  }

  return createHash("sha256").update(secret, "utf8").digest();
}

const key = getKey();

export function encryptSession(session: string | Buffer): Buffer {
  const payload = Buffer.isBuffer(session) ? session : Buffer.from(session, "utf8");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptSession(encrypted: Buffer): string {
  if (!Buffer.isBuffer(encrypted)) {
    throw new Error("Encrypted session payload must be a buffer");
  }

  if (encrypted.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted session payload is too short");
  }

  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
}
