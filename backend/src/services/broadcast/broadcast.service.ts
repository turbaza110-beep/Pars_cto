import { pgPool } from "@/utils/clients";
import { NotFoundError } from "@/utils/errors";
import { logger } from "@/utils/logger";

interface BroadcastCampaignRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  status: string;
  segment_id: string | null;
  scheduled_at: Date | null;
  last_sent_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

interface BroadcastLogRow {
  id: string;
  campaign_id: string;
  user_id: string | null;
  recipient: string;
  status: string;
  error_message: string | null;
  metadata: unknown;
  sent_at: Date;
}

export interface BroadcastCampaign {
  id: string;
  userId: string;
  title: string;
  content: string;
  status: "draft" | "scheduled" | "in_progress" | "completed" | "failed";
  segmentId: string | null;
  scheduledAt: Date | null;
  lastSentAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface BroadcastLog {
  id: string;
  campaignId: string;
  userId: string | null;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  metadata: unknown;
  sentAt: Date;
}

export interface CreateCampaignInput {
  userId: string;
  title: string;
  content: string;
  segmentId?: string | null;
  metadata?: unknown;
}

export interface StartCampaignInput {
  campaignId: string;
}

export interface UpdateCampaignStatusInput {
  campaignId: string;
  status: BroadcastCampaign["status"];
  lastSentAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface LogBroadcastOutcomeInput {
  campaignId: string;
  userId: string | null;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  errorMessage?: string | null;
  metadata?: unknown;
}

function mapRowToCampaign(row: BroadcastCampaignRow): BroadcastCampaign {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    status: row.status as BroadcastCampaign["status"],
    segmentId: row.segment_id,
    scheduledAt: row.scheduled_at,
    lastSentAt: row.last_sent_at,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCampaign(input: CreateCampaignInput): Promise<BroadcastCampaign> {
  const { userId, title, content, segmentId, metadata } = input;

  const result = await pgPool.query<BroadcastCampaignRow>(
    `INSERT INTO broadcast_campaigns (user_id, title, content, segment_id, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, title, content, status, segment_id, scheduled_at, last_sent_at, metadata, created_at, updated_at`,
    [userId, title, content, segmentId, "draft", metadata ?? {}],
  );

  if (result.rowCount === 0) {
    throw new Error("Failed to create campaign");
  }

  return mapRowToCampaign(result.rows[0]);
}

export async function getCampaign(campaignId: string): Promise<BroadcastCampaign> {
  const result = await pgPool.query<BroadcastCampaignRow>(
    `SELECT id, user_id, title, content, status, segment_id, scheduled_at, last_sent_at, metadata, created_at, updated_at
     FROM broadcast_campaigns WHERE id = $1`,
    [campaignId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Campaign ${campaignId} not found`);
  }

  return mapRowToCampaign(result.rows[0]);
}

export async function startCampaign(input: StartCampaignInput): Promise<BroadcastCampaign> {
  const { campaignId } = input;

  const result = await pgPool.query<BroadcastCampaignRow>(
    `UPDATE broadcast_campaigns 
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, user_id, title, content, status, segment_id, scheduled_at, last_sent_at, metadata, created_at, updated_at`,
    ["in_progress", campaignId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Campaign ${campaignId} not found`);
  }

  return mapRowToCampaign(result.rows[0]);
}

export async function updateCampaignStatus(input: UpdateCampaignStatusInput): Promise<BroadcastCampaign> {
  const { campaignId, status, lastSentAt, metadata } = input;

  let metadataValue = {};
  if (metadata) {
    const existing = await pgPool.query(
      "SELECT metadata FROM broadcast_campaigns WHERE id = $1",
      [campaignId],
    );
    if (existing.rowCount > 0) {
      metadataValue = { ...existing.rows[0].metadata, ...metadata };
    } else {
      metadataValue = metadata;
    }
  }

  const result = await pgPool.query<BroadcastCampaignRow>(
    `UPDATE broadcast_campaigns 
     SET status = $1, last_sent_at = COALESCE($2, last_sent_at), metadata = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING id, user_id, title, content, status, segment_id, scheduled_at, last_sent_at, metadata, created_at, updated_at`,
    [status, lastSentAt, metadataValue, campaignId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Campaign ${campaignId} not found`);
  }

  return mapRowToCampaign(result.rows[0]);
}

export async function logBroadcastOutcome(input: LogBroadcastOutcomeInput): Promise<BroadcastLog> {
  const { campaignId, userId, recipient, status, errorMessage, metadata } = input;

  const result = await pgPool.query<BroadcastLogRow>(
    `INSERT INTO broadcast_logs (campaign_id, user_id, recipient, status, error_message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, campaign_id, user_id, recipient, status, error_message, metadata, sent_at`,
    [campaignId, userId, recipient, status, errorMessage ?? null, metadata ?? {}],
  );

  if (result.rowCount === 0) {
    throw new Error("Failed to log broadcast outcome");
  }

  const row = result.rows[0];
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    recipient: row.recipient,
    status: row.status as BroadcastLog["status"],
    errorMessage: row.error_message,
    metadata: row.metadata,
    sentAt: row.sent_at,
  };
}

export async function getBroadcastLogs(
  campaignId: string,
  status?: "sent" | "failed" | "skipped",
  limit = 100,
): Promise<BroadcastLog[]> {
  let query = `SELECT id, campaign_id, user_id, recipient, status, error_message, metadata, sent_at
               FROM broadcast_logs
               WHERE campaign_id = $1`;
  const params: unknown[] = [campaignId];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY sent_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pgPool.query<BroadcastLogRow>(query, params);

  return result.rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    recipient: row.recipient,
    status: row.status as BroadcastLog["status"],
    errorMessage: row.error_message,
    metadata: row.metadata,
    sentAt: row.sent_at,
  }));
}
