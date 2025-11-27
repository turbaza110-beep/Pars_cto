import { FastifyInstance } from "fastify";
import { z } from "zod";

import { verifyJWT } from "@/middleware/verifyJWT";
import { getCurrentUser } from "@/middleware/getCurrentUser";
import {
  getPlans,
  getCurrentSubscription,
  generatePurchase,
  applyPaymentNotification,
} from "@/services/subscription/subscription.service";
import { AuthError, ValidationError } from "@/utils/errors";

const purchaseRequestSchema = z.object({
  planCode: z.string().min(1),
  email: z.string().email().optional(),
});

const webhookPayloadSchema = z.object({
  OutSum: z.string(),
  InvId: z.string(),
  SignatureValue: z.string(),
});

export async function registerSubscriptionRoutes(app: FastifyInstance) {
  app.get("/plans", async () => {
    return { plans: getPlans() };
  });

  app.get(
    "/current",
    {
      preHandler: [verifyJWT, getCurrentUser],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const subscription = await getCurrentSubscription(userId);
      return { subscription };
    },
  );

  app.post(
    "/purchase",
    {
      preHandler: [verifyJWT, getCurrentUser],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const parseResult = purchaseRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError("Invalid request body", parseResult.error);
      }

      const { planCode, email } = parseResult.data;
      const result = await generatePurchase(userId, planCode, email);
      
      return result;
    },
  );

  app.post("/webhook/robokassa", async (request, reply) => {
    const parseResult = webhookPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { error: "Invalid webhook payload" };
    }

    const notification = parseResult.data as any;
    const result = await applyPaymentNotification(notification);

    if (!result.success) {
      reply.status(400);
      return { error: result.message };
    }

    return { success: true };
  });
}
