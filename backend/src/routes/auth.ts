import { FastifyInstance } from "fastify";

import { getCurrentUser } from "@/middleware/getCurrentUser";
import { verifyJWT } from "@/middleware/verifyJWT";
import { buildAuthUserResponse, enrichUserWithLimits, enrichUserWithSubscription } from "@/services/auth/currentUser.service";
import { blacklistToken } from "@/services/auth/tokenBlacklist.service";
import { AuthError } from "@/utils/errors";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get(
    "/me",
    {
      preHandler: [verifyJWT, getCurrentUser],
    },
    async (request) => {
      const currentUser = request.user;
      if (!currentUser) {
        throw new AuthError("Authentication required");
      }

      const baseResponse = buildAuthUserResponse(currentUser);
      const withSubscription = await enrichUserWithSubscription(baseResponse);
      const enrichedUser = await enrichUserWithLimits(withSubscription);
      return enrichedUser;
    },
  );

  app.get(
    "/logout",
    {
      preHandler: [verifyJWT],
    },
    async (request) => {
      const token = request.accessToken;
      const expiresAt = request.authPayload?.exp;

      if (token && typeof expiresAt === "number") {
        const ttlSeconds = Math.max(expiresAt - Math.floor(Date.now() / 1000), 0);
        if (ttlSeconds > 0) {
          await blacklistToken(token, ttlSeconds);
        }
      }

      return { success: true };
    },
  );
}
