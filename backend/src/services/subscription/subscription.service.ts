import type { PoolClient } from "pg";
import { pgPool } from "@/utils/clients";
import { getPlanByCode, getFreePlan, SUBSCRIPTION_PLANS, SubscriptionPlan } from "./plans";
import { buildPurchaseUrl, verifyResultSignature, RobokassaResultNotification } from "./robokassa.service";
import { ValidationError } from "@/utils/errors";

export interface CurrentSubscription {
  id: string;
  userId: string;
  planCode: string;
  planName: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  plan?: SubscriptionPlan;
}

interface PaymentRow {
  id: string;
  transaction_id: string;
  amount: string;
  status: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_code: string;
  plan_name: string;
  status: string;
  started_at: Date;
  expires_at: Date;
}

export function getPlans(): SubscriptionPlan[] {
  return SUBSCRIPTION_PLANS;
}

export async function getCurrentSubscription(userId: string): Promise<CurrentSubscription | null> {
  const result = await pgPool.query<SubscriptionRow>(
    `SELECT id, user_id, plan_code, plan_name, status, started_at, expires_at
     FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY expires_at DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  const plan = getPlanByCode(row.plan_code);

  return {
    id: row.id,
    userId: row.user_id,
    planCode: row.plan_code,
    planName: row.plan_name,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    plan,
  };
}

export async function generatePurchase(
  userId: string,
  planCode: string,
  email?: string,
): Promise<{ paymentId: string; paymentUrl: string }> {
  const plan = getPlanByCode(planCode);
  if (!plan) {
    throw new ValidationError(`Plan '${planCode}' not found`);
  }

  if (plan.price === 0) {
    throw new ValidationError("Cannot purchase free plan");
  }

  const transactionId = `${userId.substring(0, 8)}-${Date.now()}`;
  
  const paymentResult = await pgPool.query<PaymentRow>(
    `INSERT INTO payments (user_id, amount, currency, status, provider, transaction_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, transaction_id, amount, status`,
    [
      userId,
      plan.price,
      plan.currency,
      "pending",
      "robokassa",
      transactionId,
      JSON.stringify({ planCode, planName: plan.name }),
    ],
  );

  const payment = paymentResult.rows[0];
  const invId = parseInt(payment.id.replace(/-/g, "").substring(0, 9), 16);

  const paymentUrl = buildPurchaseUrl({
    outSum: parseFloat(payment.amount),
    invId,
    description: `Subscription: ${plan.name}`,
    email,
  });

  return {
    paymentId: payment.id,
    paymentUrl,
  };
}

export async function applyPaymentNotification(
  notification: RobokassaResultNotification,
): Promise<{ success: boolean; message: string }> {
  if (!verifyResultSignature(notification)) {
    return { success: false, message: "Invalid signature" };
  }

  const { InvId, OutSum } = notification;
  const paymentIdPattern = `%${InvId}%`;

  const paymentResult = await pgPool.query<PaymentRow>(
    `SELECT id, transaction_id, amount, status
     FROM payments
     WHERE id::text LIKE $1 AND status = 'pending'
     LIMIT 1`,
    [paymentIdPattern],
  );

  if (paymentResult.rowCount === 0) {
    const alternativeResult = await pgPool.query<PaymentRow>(
      `SELECT id, transaction_id, amount, status
       FROM payments
       WHERE transaction_id LIKE $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [`%${InvId}%`],
    );

    if (alternativeResult.rowCount === 0) {
      return { success: false, message: "Payment not found" };
    }

    const payment = alternativeResult.rows[0];
    await completePayment(payment.id, OutSum);
    return { success: true, message: "Payment processed" };
  }

  const payment = paymentResult.rows[0];
  await completePayment(payment.id, OutSum);
  return { success: true, message: "Payment processed" };
}

async function completePayment(paymentId: string, outSum: string): Promise<void> {
  const client = await pgPool.connect();
  
  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `UPDATE payments
       SET status = 'paid', paid_at = NOW()
       WHERE id = $1
       RETURNING user_id, payload`,
      [paymentId],
    );

    if (paymentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }

    const { user_id: userId, payload } = paymentResult.rows[0];
    const payloadData = typeof payload === "string" ? JSON.parse(payload) : payload;
    const planCode = payloadData.planCode;
    const plan = getPlanByCode(planCode);

    if (!plan) {
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      `UPDATE subscriptions
       SET status = 'expired'
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

    const subscriptionResult = await client.query(
      `INSERT INTO subscriptions (user_id, plan_code, plan_name, status, started_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       RETURNING id`,
      [userId, plan.code, plan.name, "active", expiresAt],
    );

    const subscriptionId = subscriptionResult.rows[0].id;

    await client.query(
      `UPDATE payments
       SET subscription_id = $1
       WHERE id = $2`,
      [subscriptionId, paymentId],
    );

    await updateUserLimits(client, userId, plan);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateUserLimits(client: PoolClient, userId: string, plan: SubscriptionPlan): Promise<void> {
  const limitEntries = Object.entries(plan.limits);

  for (const [limitKey, limitValue] of limitEntries) {
    await client.query(
      `INSERT INTO usage_limits (user_id, limit_key, limit_value, consumed_value, resets_at)
       VALUES ($1, $2, $3, 0, NULL)
       ON CONFLICT (user_id, limit_key)
       DO UPDATE SET limit_value = $3, consumed_value = 0, updated_at = NOW()`,
      [userId, limitKey, limitValue],
    );
  }
}
