import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { JobTypes } from "@/jobs/jobTypes";
import { addJob } from "@/utils/queueHelpers";
import { verifyJWT } from "@/middleware/verifyJWT";
import { getCurrentUser } from "@/middleware/getCurrentUser";
import { validateRequest } from "@/middleware/validateRequest";
import { assertActiveSubscription } from "@/services/parsing/usage.service";
import {
  CampaignListFilters,
  BroadcastCampaign,
  createCampaign,
  getCampaignForUser,
  listCampaigns,
  listBroadcastLogs,
  updateCampaignStatus,
} from "@/services/broadcast/broadcast.service";
import { checkBroadcastQuota, checkAndIncrementBroadcastUsage } from "@/services/broadcast/usage.service";
import { BroadcastProgressSnapshot, readBroadcastProgress, saveBroadcastProgress } from "@/services/broadcast/progress.service";
import { getSegment, calculateTotalRecipients, getSegmentRecipients } from "@/services/audience/audienceService";
import { AuthError, ValidationError } from "@/utils/errors";

const MAX_MANUAL_RECIPIENTS = 1000;
const MAX_ATTACHMENTS = 5;
const TERMINAL_PROGRESS_STATUSES = new Set<BroadcastProgressSnapshot["status"]>(["completed", "failed"]);

const campaignStatusEnum = z.enum(["draft", "scheduled", "in_progress", "completed", "failed"]);
const logStatusEnum = z.enum(["sent", "failed", "skipped"]);

const createCampaignSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3)
      .max(160),
    content: z
      .string()
      .trim()
      .min(1)
      .max(4096),
    segment_id: z.string().uuid().optional(),
    recipients: z
      .array(z.string().trim())
      .max(MAX_MANUAL_RECIPIENTS)
      .optional(),
    attachments: z.array(z.string().trim()).max(MAX_ATTACHMENTS).optional(),
  })
  .refine(
    (value) => value.segment_id || (value.recipients && value.recipients.length > 0),
    {
      message: "Provide segment_id or at least one recipient",
      path: ["recipients"],
    },
  )
  .refine(
    (value) => !(value.segment_id && value.recipients && value.recipients.length > 0),
    {
      message: "Use either segment_id or recipients, not both",
      path: ["recipients"],
    },
  );

const campaignParamsSchema = z.object({
  id: z.string().uuid(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: campaignStatusEnum.optional(),
});

const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  status: logStatusEnum.optional(),
});

type CreateCampaignBody = z.infer<typeof createCampaignSchema>;
type CampaignParams = z.infer<typeof campaignParamsSchema>;
type HistoryQuery = z.infer<typeof historyQuerySchema>;
type LogsQuery = z.infer<typeof logsQuerySchema>;

type CampaignSource = "segment" | "manual";

interface CampaignMetadataSummary {
  source?: CampaignSource;
  totalRecipients?: number;
  manualRecipients?: string[];
  attachments?: string[];
  jobId?: string | null;
  retryCount: number;
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
}

export async function registerBroadcastRoutes(app: FastifyInstance) {
  app.post(
    "/campaigns",
    {
      preHandler: [
        verifyJWT,
        getCurrentUser,
        validateRequest({ body: createCampaignSchema }),
      ],
    },
    async (request, reply) => {
      const userId = requireUserId(request);
      await assertActiveSubscription(userId);

      const body = request.body as CreateCampaignBody;
      const manualRecipients = normalizeManualRecipients(body.recipients);
      const attachments = normalizeAttachments(body.attachments);

      let recipientCount = 0;
      let source: CampaignSource = "manual";
      const metadata: Record<string, unknown> = {};

      if (body.segment_id) {
        source = "segment";
        const segment = await getSegment(userId, body.segment_id);
        let totalRecipients = segment.totalRecipients ?? 0;

        if ((totalRecipients === null || totalRecipients <= 0) && segment.sourceParsingId) {
          totalRecipients = await calculateTotalRecipients({
            userId,
            sourceParsingId: segment.sourceParsingId,
            filters: segment.filters,
          });
        }

        if (!totalRecipients || totalRecipients <= 0) {
          throw new ValidationError("Audience segment does not contain recipients");
        }

        recipientCount = totalRecipients;
        metadata.segment_id = body.segment_id;
      } else {
        if (!manualRecipients || manualRecipients.length === 0) {
          throw new ValidationError("Recipients list cannot be empty");
        }
        recipientCount = manualRecipients.length;
        metadata.manual_recipients = manualRecipients;
      }

      if (attachments && attachments.length > 0) {
        metadata.attachments = attachments;
      }

      metadata.source = source;
      metadata.total_recipients = recipientCount;

      await checkBroadcastQuota(userId, recipientCount);

      const campaign = await createCampaign({
        userId,
        title: body.title.trim(),
        content: body.content.trim(),
        segmentId: body.segment_id ?? null,
        metadata,
      });

      reply.code(201);
      return buildCampaignSummary(campaign, parseCampaignMetadata(campaign.metadata));
    },
  );

  app.post(
    "/:id/start",
    {
      preHandler: [
        verifyJWT,
        getCurrentUser,
        validateRequest({ params: campaignParamsSchema }),
      ],
    },
    async (request, reply) => {
      const userId = requireUserId(request);
      await assertActiveSubscription(userId);

      const params = request.params as CampaignParams;
      const campaign = await getCampaignForUser(params.id, userId);
      if (campaign.status !== "draft") {
        throw new ValidationError("Only draft campaigns can be started");
      }

      const metadata = parseCampaignMetadata(campaign.metadata);
      const recipients = await resolveCampaignRecipients(campaign, metadata, userId);

      await checkAndIncrementBroadcastUsage(userId, recipients.length);

      const job = await addJob(JobTypes.BROADCAST, {
        campaignId: campaign.id,
        userId,
        recipients,
        text: campaign.content,
        attachments: metadata.attachments,
      });

      const jobId = job.id ? job.id.toString() : null;
      const nowIso = new Date().toISOString();

      const updated = await updateCampaignStatus({
        campaignId: campaign.id,
        status: "scheduled",
        metadata: {
          job_id: jobId,
          last_job_id: jobId,
          queued_at: nowIso,
          last_started_at: nowIso,
          total_recipients: recipients.length,
        },
      });

      await saveBroadcastProgress(campaign.id, {
        status: "initializing",
        progress: 0,
        processed: 0,
        total: recipients.length,
        sent: 0,
        failed: 0,
        skipped: 0,
      });

      reply.code(202);
      return {
        id: updated.id,
        status: updated.status,
        job_id: jobId,
        total_recipients: recipients.length,
        queued_at: nowIso,
      };
    },
  );

  app.post(
    "/:id/retry",
    {
      preHandler: [
        verifyJWT,
        getCurrentUser,
        validateRequest({ params: campaignParamsSchema }),
      ],
    },
    async (request, reply) => {
      const userId = requireUserId(request);
      await assertActiveSubscription(userId);

      const params = request.params as CampaignParams;
      const campaign = await getCampaignForUser(params.id, userId);
      if (campaign.status !== "failed") {
        throw new ValidationError("Only failed campaigns can be retried");
      }

      const metadata = parseCampaignMetadata(campaign.metadata);
      const recipients = await resolveCampaignRecipients(campaign, metadata, userId);

      await checkAndIncrementBroadcastUsage(userId, recipients.length);

      const job = await addJob(JobTypes.BROADCAST, {
        campaignId: campaign.id,
        userId,
        recipients,
        text: campaign.content,
        attachments: metadata.attachments,
      });

      const jobId = job.id ? job.id.toString() : null;
      const nowIso = new Date().toISOString();
      const retryCount = metadata.retryCount + 1;

      const updated = await updateCampaignStatus({
        campaignId: campaign.id,
        status: "scheduled",
        metadata: {
          job_id: jobId,
          last_job_id: jobId,
          retried_at: nowIso,
          retry_count: retryCount,
          error: null,
          total_recipients: recipients.length,
        },
      });

      await saveBroadcastProgress(campaign.id, {
        status: "initializing",
        progress: 0,
        processed: 0,
        total: recipients.length,
        sent: 0,
        failed: 0,
        skipped: 0,
      });

      reply.code(202);
      return {
        id: updated.id,
        status: updated.status,
        job_id: jobId,
        retry_count: retryCount,
        total_recipients: recipients.length,
        queued_at: nowIso,
      };
    },
  );

  app.get(
    "/:id/progress",
    {
      preHandler: [
        verifyJWT,
        getCurrentUser,
        validateRequest({ params: campaignParamsSchema }),
      ],
    },
    async (request, reply) => {
      const userId = requireUserId(request);
      const params = request.params as CampaignParams;
      const campaign = await getCampaignForUser(params.id, userId);
      const metadata = parseCampaignMetadata(campaign.metadata);

      reply.code(200);
      await streamProgress(reply, campaign, metadata);
      return reply;
    },
  );

  app.get(
    "/:id/logs",
    {
      preHandler: [
        verifyJWT,
        getCurrentUser,
        validateRequest({ params: campaignParamsSchema, query: logsQuerySchema }),
      ],
    },
    async (request) => {
      const userId = requireUserId(request);
      const params = request.params as CampaignParams;
      const query = request.query as LogsQuery;

      await getCampaignForUser(params.id, userId);
      const { total, logs } = await listBroadcastLogs(userId, params.id, {
        status: query.status,
        page: query.page,
        limit: query.limit,
      });

      return {
        total,
        page: query.page,
        limit: query.limit,
        logs: logs.map((log) => ({
          id: log.id,
          recipient: log.recipient,
          status: log.status,
          error_message: log.errorMessage,
          sent_at: log.sentAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/history",
    {
      preHandler: [
        verifyJWT,
        getCurrentUser,
        validateRequest({ query: historyQuerySchema }),
      ],
    },
    async (request) => {
      const userId = requireUserId(request);
      const query = request.query as HistoryQuery;

      const filters: CampaignListFilters | undefined = query.status
        ? { status: query.status }
        : undefined;

      const { total, campaigns } = await listCampaigns(userId, query.page, query.limit, filters);

      return {
        total,
        page: query.page,
        limit: query.limit,
        campaigns: campaigns.map((campaign) => buildCampaignSummary(campaign, parseCampaignMetadata(campaign.metadata))),
      };
    },
  );
}

function requireUserId(request: FastifyRequest): string {
  const userId = request.user?.id;
  if (!userId) {
    throw new AuthError("Authentication required");
  }
  return userId;
}

function normalizeManualRecipients(input?: string[]): string[] | null {
  if (!input) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== "string") {
      continue;
    }
    const formatted = formatRecipient(raw);
    if (!formatted || seen.has(formatted)) {
      continue;
    }

    normalized.push(formatted);
    seen.add(formatted);

    if (normalized.length > MAX_MANUAL_RECIPIENTS) {
      throw new ValidationError(`Recipients limit of ${MAX_MANUAL_RECIPIENTS} exceeded`);
    }
  }

  return normalized.length > 0 ? normalized : null;
}

function normalizeAttachments(input?: string[]): string[] | undefined {
  if (!input) {
    return undefined;
  }

  const attachments: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    attachments.push(trimmed);
    seen.add(trimmed);

    if (attachments.length > MAX_ATTACHMENTS) {
      throw new ValidationError(`Attachments limit of ${MAX_ATTACHMENTS} exceeded`);
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

function formatRecipient(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/^@+/, "").trim();
  if (!normalized) {
    return null;
  }

  return `@${normalized}`;
}

function parseCampaignMetadata(metadata: unknown): CampaignMetadataSummary {
  if (!metadata || typeof metadata !== "object") {
    return {
      retryCount: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const record = metadata as Record<string, unknown>;
  const manualRecipients = extractStringArray(record.manual_recipients ?? record.manualRecipients);
  const attachments = extractStringArray(record.attachments);

  const source = record.source === "segment" || record.source === "manual"
    ? (record.source as CampaignSource)
    : undefined;

  const totalRecipients = toNumber(record.total_recipients ?? record.totalRecipients);
  const retryCount = toNumber(record.retry_count ?? record.retryCount) ?? 0;

  return {
    source,
    totalRecipients,
    manualRecipients,
    attachments,
    jobId: typeof record.job_id === "string"
      ? record.job_id
      : typeof record.jobId === "string"
        ? record.jobId
        : null,
    retryCount,
    sent: toNumber(record.sent) ?? 0,
    failed: toNumber(record.failed) ?? 0,
    skipped: toNumber(record.skipped) ?? 0,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return result.length > 0 ? result : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function buildCampaignSummary(campaign: BroadcastCampaign, metadata: CampaignMetadataSummary) {
  const totalRecipients = metadata.totalRecipients
    ?? metadata.manualRecipients?.length
    ?? 0;

  const source: CampaignSource = metadata.source
    ?? (campaign.segmentId ? "segment" : "manual");

  return {
    id: campaign.id,
    title: campaign.title,
    status: campaign.status,
    source,
    segment_id: campaign.segmentId,
    total_recipients: totalRecipients,
    sent: metadata.sent,
    failed: metadata.failed,
    skipped: metadata.skipped,
    retry_count: metadata.retryCount,
    created_at: campaign.createdAt.toISOString(),
    updated_at: campaign.updatedAt.toISOString(),
    last_sent_at: campaign.lastSentAt ? campaign.lastSentAt.toISOString() : null,
  };
}

async function resolveCampaignRecipients(
  campaign: BroadcastCampaign,
  metadata: CampaignMetadataSummary,
  userId: string,
): Promise<string[]> {
  if (campaign.segmentId) {
    const recipients = await getSegmentRecipients(userId, campaign.segmentId);
    if (recipients.length === 0) {
      throw new ValidationError("Audience segment does not contain recipients");
    }
    return recipients;
  }

  const manualRecipients = metadata.manualRecipients ?? [];
  if (manualRecipients.length === 0) {
    throw new ValidationError("Campaign has no manual recipients configured");
  }

  return manualRecipients;
}

async function streamProgress(
  reply: FastifyReply,
  campaign: BroadcastCampaign,
  metadata: CampaignMetadataSummary,
) {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.flushHeaders?.();
  reply.hijack();

  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  const sendSnapshot = async () => {
    if (closed) {
      return;
    }

    const snapshot = (await readBroadcastProgress(campaign.id)) ?? buildFallbackProgressSnapshot(campaign, metadata);
    reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    if (TERMINAL_PROGRESS_STATUSES.has(snapshot.status)) {
      closed = true;
      if (timer) {
        clearInterval(timer);
      }
      reply.raw.end();
    }
  };

  await sendSnapshot();

  if (!closed) {
    timer = setInterval(() => {
      void sendSnapshot();
    }, 1000);

    reply.raw.on("close", () => {
      closed = true;
      if (timer) {
        clearInterval(timer);
      }
    });
  }
}

function buildFallbackProgressSnapshot(
  campaign: BroadcastCampaign,
  metadata: CampaignMetadataSummary,
): BroadcastProgressSnapshot {
  const total = metadata.totalRecipients ?? metadata.manualRecipients?.length ?? 0;
  const sent = metadata.sent;
  const failed = metadata.failed;
  const skipped = metadata.skipped;
  const processed = Math.min(total, sent + failed + skipped);

  let status: BroadcastProgressSnapshot["status"] = "initializing";
  if (campaign.status === "in_progress") {
    status = "sending";
  } else if (campaign.status === "completed") {
    status = "completed";
  } else if (campaign.status === "failed") {
    status = "failed";
  }

  const baseProgress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const progress = status === "completed" || status === "failed" ? 100 : baseProgress;

  return {
    campaignId: campaign.id,
    status,
    progress,
    processed,
    total,
    sent,
    failed,
    skipped,
    error: metadata.error,
    updated_at: campaign.updatedAt.toISOString(),
  };
}
