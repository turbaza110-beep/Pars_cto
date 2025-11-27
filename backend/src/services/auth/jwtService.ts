import jwt, { SignOptions } from "jsonwebtoken";

import { config } from "@/config/config";
import { JwtPayload } from "@/types/user";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days

interface TokenPayload {
  userId: string;
  sessionId?: string;
  telegramId?: string;
  claims?: Record<string, unknown>;
  expiresInSeconds?: number;
}

function buildClaims(payload: TokenPayload) {
  const claims: Record<string, unknown> = {
    sub: payload.userId,
  };

  if (payload.sessionId) {
    claims.sessionId = payload.sessionId;
  }

  if (payload.telegramId) {
    claims.telegramId = payload.telegramId;
  }

  if (payload.claims) {
    Object.assign(claims, payload.claims);
  }

  return claims;
}

function signToken(payload: TokenPayload, expiresInSeconds: number) {
  const claims = buildClaims(payload);
  const options: SignOptions = { expiresIn: payload.expiresInSeconds ?? expiresInSeconds };
  return jwt.sign(claims, config.security.jwtSecret, options);
}

export function generateAccessToken(payload: TokenPayload) {
  return signToken(payload, ACCESS_TOKEN_TTL_SECONDS);
}

export function generateRefreshToken(payload: TokenPayload) {
  return signToken(payload, REFRESH_TOKEN_TTL_SECONDS);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, config.security.jwtSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, config.security.jwtSecret) as JwtPayload;
}

export const jwtService = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
};
