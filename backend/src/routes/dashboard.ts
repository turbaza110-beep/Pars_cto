import { FastifyInstance } from "fastify";

import { getCurrentUser } from "@/middleware/getCurrentUser";
import { verifyJWT } from "@/middleware/verifyJWT";
import { getDashboardData } from "@/services/dashboard/dashboard.service";
import { AuthError } from "@/utils/errors";

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [verifyJWT, getCurrentUser],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      return getDashboardData(userId);
    },
  );
}
