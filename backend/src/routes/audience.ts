import { FastifyInstance } from "fastify";
import { z } from "zod";

import { JobTypes } from "@/jobs/jobTypes";
import { addJob } from "@/utils/queueHelpers";
import { verifyJWT } from "@/middleware/verifyJWT";
import { getCurrentUser } from "@/middleware/getCurrentUser";
import { validateRequest } from "@/middleware/validateRequest";
import {
  createSegment,
  deleteSegment,
  getSegment,
  getSegmentPreview,
  listSegments,
  updateSegment,
} from "@/services/audience/audienceService";
import { assertActiveSubscription } from "@/services/parsing/usage.service";
import { AuthError } from "@/utils/errors";
import { logger } from "@/utils/logger";
import { AudienceSegment, NormalizedAudienceSegmentFilters, AudienceSegmentFilters } from "@/types/audience";

const filtersSchema = z
  .object({
    engagement_min: z.coerce.number().min(0).max(1).optional(),
    engagement_max: z.coerce.number().min(0).max(1).optional(),
    post_frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    language: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .optional(),
    min_subscribers: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (value) => {
      if (value.engagement_min !== undefined && value.engagement_max !== undefined) {
        return value.engagement_max >= value.engagement_min;
      }
      return true;
    },
    { message: "engagement_max must be greater than or equal to engagement_min", path: ["engagement_max"] },
  );

const createBodySchema = z.object({
  name: z.string().trim().min(3).max(128),
  description: z
    .string()
    .trim()
    .max(500)
    .optional(),
  source_parsing_id: z.string().uuid(),
  filters: filtersSchema.optional(),
});

const updateBodySchema = z.object({
  filters: filtersSchema.optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const previewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const segmentParamsSchema = z.object({
  segment_id: z.string().uuid(),
});

type CreateBody = z.infer<typeof createBodySchema>;
type UpdateBody = z.infer<typeof updateBodySchema>;
type ListQuery = z.infer<typeof listQuerySchema>;
type PreviewQuery = z.infer<typeof previewQuerySchema>;
type SegmentParams = z.infer<typeof segmentParamsSchema>;
type FiltersInput = z.infer<typeof filtersSchema>;

function normalizeFiltersInput(filters?: FiltersInput): NormalizedAudienceSegmentFilters | null | undefined {
  if (filters === undefined) {
    return undefined;
  }

  const normalized: NormalizedAudienceSegmentFilters = {};

  if (typeof filters.engagement_min === "number") {
    normalized.engagementMin = Number(filters.engagement_min);
  }

  if (typeof filters.engagement_max === "number") {
    normalized.engagementMax = Number(filters.engagement_max);
  }

  if (typeof filters.min_subscribers === "number") {
    normalized.minSubscribers = filters.min_subscribers;
  }

  if (typeof filters.language === "string" && filters.language.trim().length > 0) {
    normalized.language = filters.language.trim().toLowerCase();
  }

  if (filters.post_frequency) {
    normalized.postFrequency = filters.post_frequency;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function formatFiltersResponse(filters?: NormalizedAudienceSegmentFilters | null): AudienceSegmentFilters | null {
  if (!filters) {
    return null;
  }

  const payload: AudienceSegmentFilters = {};

  if (typeof filters.engagementMin === "number") {
    payload.engagement_min = Number(filters.engagementMin.toFixed(2));
  }

  if (typeof filters.engagementMax === "number") {
    payload.engagement_max = Number(filters.engagementMax.toFixed(2));
  }

  if (typeof filters.minSubscribers === "number") {
    payload.min_subscribers = filters.minSubscribers;
  }

  if (filters.language) {
    payload.language = filters.language;
  }

  if (filters.postFrequency) {
    payload.post_frequency = filters.postFrequency;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function buildSegmentSummary(segment: AudienceSegment, options?: { includeCreatedAt?: boolean }) {
  const summary: Record<string, unknown> = {
    id: segment.id,
    name: segment.name,
    total_recipients: segment.totalRecipients,
    status: segment.status,
  };

  if (options?.includeCreatedAt) {
    summary.created_at = segment.createdAt;
  }

  return summary;
}

function buildSegmentDetail(segment: AudienceSegment) {
  return {
    id: segment.id,
    name: segment.name,
    description: segment.description,
    source_parsing_id: segment.sourceParsingId,
    filters: formatFiltersResponse(segment.filters),
    total_recipients: segment.totalRecipients,
    status: segment.status,
    created_at: segment.createdAt,
    updated_at: segment.updatedAt,
  };
}

async function enqueueAudienceRefresh(userId: string, segmentId: string) {
  try {
    await addJob(JobTypes.AUDIENCE_SEGMENT, { userId, segmentId });
  } catch (error) {
    logger.error("Failed to enqueue audience segment job", { segmentId, error });
  }
}

export async function registerAudienceRoutes(app: FastifyInstance) {
  app.post(
    "/segments",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ body: createBodySchema })],
    },
    async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      await assertActiveSubscription(userId);

      const body = request.body as CreateBody;
      const normalizedFilters = normalizeFiltersInput(body.filters) ?? null;

      const segment = await createSegment({
        userId,
        name: body.name,
        description: body.description,
        sourceParsingId: body.source_parsing_id,
        filters: normalizedFilters,
      });

      await enqueueAudienceRefresh(userId, segment.id);

      reply.code(201);
      return buildSegmentSummary(segment);
    },
  );

  app.get(
    "/segments",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ query: listQuerySchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const { page, limit } = request.query as ListQuery;
      const segments = await listSegments(userId, page, limit);
      return segments.map((segment) => buildSegmentSummary(segment, { includeCreatedAt: true }));
    },
  );

  app.get(
    "/:segment_id",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: segmentParamsSchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const params = request.params as SegmentParams;
      const segment = await getSegment(userId, params.segment_id);
      return buildSegmentDetail(segment);
    },
  );

  app.put(
    "/:segment_id",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: segmentParamsSchema, body: updateBodySchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      await assertActiveSubscription(userId);

      const params = request.params as SegmentParams;
      const body = request.body as UpdateBody;
      const normalizedFilters = normalizeFiltersInput(body.filters);
      const segment = await updateSegment({ userId, segmentId: params.segment_id, filters: normalizedFilters });

      await enqueueAudienceRefresh(userId, segment.id);

      return buildSegmentDetail(segment);
    },
  );

  app.delete(
    "/:segment_id",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: segmentParamsSchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const params = request.params as SegmentParams;
      await deleteSegment(userId, params.segment_id);

      return { success: true };
    },
  );

  app.get(
    "/:segment_id/preview",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: segmentParamsSchema, query: previewQuerySchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const params = request.params as SegmentParams;
      const { limit } = request.query as PreviewQuery;
      const preview = await getSegmentPreview(userId, params.segment_id, limit);

      return {
        total: preview.total,
        preview: preview.preview.map((entry) => ({
          username: entry.username,
          user_id: entry.userId,
          engagement_score: entry.engagementScore,
          activity_level: entry.activityLevel,
        })),
      };
    },
  );
}
