import { FastifyReply, FastifyRequest } from "fastify";

import { isTokenBlacklisted } from "@/services/auth/tokenBlacklist.service";
import { AuthError } from "@/utils/errors";
import { JwtPayload, User } from "@/types/user";

const BEARER_PREFIX = "Bearer ";

export async function verifyJWT(request: FastifyRequest, _reply: FastifyReply) {
  const authorization = request.headers.authorization;

  if (!authorization || !authorization.startsWith(BEARER_PREFIX)) {
    throw new AuthError("Authorization header is missing");
  }

  const token = authorization.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    throw new AuthError("Authentication token is missing");
  }

  let payload: JwtPayload;
  try {
    payload = await request.jwtVerify<JwtPayload>();
  } catch (error) {
    throw new AuthError("Authentication token is invalid", { cause: error });
  }

  if (!payload.sub) {
    throw new AuthError("Authentication token is missing subject");
  }

  const revoked = await isTokenBlacklisted(token);
  if (revoked) {
    throw new AuthError("Authentication token has been revoked");
  }

  const authenticatedUser: User = {
    id: payload.sub,
    email: payload.email,
    role: payload.role ?? "user",
    permissions: payload.permissions ?? [],
    profile: payload.profile,
  };

  request.user = authenticatedUser;
  request.authPayload = payload;
  request.accessToken = token;
}
