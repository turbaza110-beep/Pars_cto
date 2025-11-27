import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { config } from "@/config/config";
import { JobTypes } from "@/jobs/jobTypes";
import { addJob } from "@/utils/queueHelpers";
import { verifyJWT } from "@/middleware/verifyJWT";
import { getCurrentUser } from "@/middleware/getCurrentUser";
import { validateRequest } from "@/middleware/validateRequest";
import {
  createParsingSearch,
  mergeParsingMetadata,
  getParsingResults,
  listParsingHistory,
  getParsingSearchSummary,
  getAllParsedChannels,
} from "@/services/parsing/parsing.service";
import { assertActiveSubscription, assertParsingQuotaAvailable } from "@/services/parsing/usage.service";
import { saveParsingProgress, readParsingProgress } from "@/services/parsing/progress.service";
import {
  NormalizedParsingFilters,
  ParsedChannel,
  ParsingFilters,
  ParsingProgressSnapshot,
  ParsingHistoryEntry,
  SearchMode,
} from "@/types/parsing";
import { NotFoundError, AuthError } from "@/utils/errors";

const parsingFiltersSchema = z
  .object({
    language: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .optional(),
    min_subscribers: z.coerce.number().int().min(0).optional(),
    max_subscribers: z.coerce.number().int().min(1).optional(),
    activity_level: z.enum(["low", "medium", "high"]).optional(),
  })
  .refine(
    (value) => {
      if (value.min_subscribers !== undefined && value.max_subscribers !== undefined) {
        return value.max_subscribers >= value.min_subscribers;
      }
      return true;
    },
    { message: "max_subscribers must be greater than or equal to min_subscribers", path: ["max_subscribers"] },
  );

const searchBodySchema = z.object({
  query: z.string().trim().min(2).max(512),
  filters: parsingFiltersSchema.optional(),
});

const searchIdParamsSchema = z.object({
  search_id: z.string().uuid(),
});

const resultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort_by: z.enum(["subscribers", "activity"]).default("subscribers"),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const exportQuerySchema = z.object({
  format: z.enum(["csv"]).default("csv"),
});

function resolveSearchMode(): SearchMode {
  return config.nodeEnv === "production" ? "live" : "simulation";
}

type ApiFiltersInput = z.infer<typeof parsingFiltersSchema>;

type HistoryQuery = z.infer<typeof historyQuerySchema>;
type ResultsQuery = z.infer<typeof resultsQuerySchema>;
type ExportQuery = z.infer<typeof exportQuerySchema>;

type SearchBody = z.infer<typeof searchBodySchema>;
type SearchParams = z.infer<typeof searchIdParamsSchema>;

function normalizeFiltersInput(filters?: ApiFiltersInput): NormalizedParsingFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const normalized: NormalizedParsingFilters = {};

  if (filters.language) {
    normalized.language = filters.language.trim().toLowerCase();
  }

  if (typeof filters.min_subscribers === "number") {
    normalized.minSubscribers = filters.min_subscribers;
  }

  if (typeof filters.max_subscribers === "number") {
    normalized.maxSubscribers = filters.max_subscribers;
  }

  if (filters.activity_level) {
    normalized.activityLevel = filters.activity_level;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function formatFiltersResponse(filters?: NormalizedParsingFilters): ParsingFilters | null {
  if (!filters) {
    return null;
  }

  const payload: ParsingFilters = {};

  if (filters.language) {
    payload.language = filters.language;
  }

  if (filters.minSubscribers !== undefined) {
    payload.min_subscribers = filters.minSubscribers;
  }

  if (filters.maxSubscribers !== undefined) {
    payload.max_subscribers = filters.maxSubscribers;
  }

  if (filters.activityLevel) {
    payload.activity_level = filters.activityLevel;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function mapChannelToResponse(channel: ParsedChannel) {
  return {
    channel_id: channel.channelId,
    title: channel.title ?? null,
    username: channel.username ?? null,
    subscribers: channel.subscribers,
    description: channel.description ?? null,
    activity_score: Number(channel.activityScore.toFixed(2)),
    activity_level: channel.activityLevel,
    last_post: channel.lastPost ?? null,
  };
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (text.includes("\n") || text.includes("\r") || text.includes(",") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsvPayload(channels: ParsedChannel[]) {
  const header = ["id", "title", "username", "subscribers", "description", "activity", "last_post"];
  const rows = channels.map((channel) => [
    channel.channelId,
    channel.title ?? "",
    channel.username ?? "",
    channel.subscribers,
    channel.description ?? "",
    channel.activityScore.toFixed(2),
    channel.lastPost ?? "",
  ]);

  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
}

const TERMINAL_PROGRESS = new Set(["completed", "failed"]);

function buildFallbackProgress(summaryId: string, status: ParsingHistoryEntry["status"], resultCount: number): ParsingProgressSnapshot {
  let resolvedStatus: ParsingProgressSnapshot["status"] = "pending";
  let resolvedProgress = 0;

  if (status === "processing") {
    resolvedStatus = "analyzing_data";
    resolvedProgress = 50;
  } else if (status === "completed") {
    resolvedStatus = "completed";
    resolvedProgress = 100;
  } else if (status === "failed") {
    resolvedStatus = "failed";
    resolvedProgress = 100;
  }

  return {
    searchId: summaryId,
    status: resolvedStatus,
    progress: resolvedProgress,
    current: resultCount,
    total: resultCount,
    results: resultCount,
    updated_at: new Date().toISOString(),
  };
}

async function streamParsingProgress(
  reply: FastifyReply,
  searchId: string,
  summaryStatus: ParsingHistoryEntry["status"],
  summaryCount: number,
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

    const snapshot = (await readParsingProgress(searchId)) ?? buildFallbackProgress(searchId, summaryStatus, summaryCount);
    reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    if (TERMINAL_PROGRESS.has(snapshot.status)) {
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

export async function registerParsingRoutes(app: FastifyInstance) {
  app.post(
    "/search",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ body: searchBodySchema })],
    },
    async (request, reply) => {
      const body = request.body as SearchBody;
      const userId = request.user?.id;

      if (!userId) {
        throw new AuthError("Authentication required");
      }

      await assertActiveSubscription(userId);
      await assertParsingQuotaAvailable(userId);

      const filters = normalizeFiltersInput(body.filters);
      const mode = resolveSearchMode();

      const search = await createParsingSearch(userId, body.query.trim(), filters, mode);
      await saveParsingProgress(search.id, { status: "pending", progress: 0, current: 0, total: 0 });

      const job = await addJob(JobTypes.PARSE_SEARCH, {
        searchId: search.id,
        userId,
        query: search.query,
        filters,
        mode,
      });

      await mergeParsingMetadata(search.id, { jobId: job.id?.toString() ?? null });

      reply.code(202);
      return {
        search_id: search.id,
        status: "processing",
        progress: 0,
      };
    },
  );

  app.get(
    "/history",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ query: historyQuerySchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const { page, limit } = request.query as HistoryQuery;
      const entries = await listParsingHistory(userId, page, limit);

      return entries.map((entry) => ({
        id: entry.id,
        query: entry.query,
        filters: formatFiltersResponse(entry.filters),
        status: entry.status,
        created_at: entry.createdAt,
        results_count: entry.resultCount,
      }));
    },
  );

  app.get(
    "/:search_id/results",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: searchIdParamsSchema, query: resultsQuerySchema })],
    },
    async (request) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const params = request.params as SearchParams;
      const { page, limit, sort_by } = request.query as ResultsQuery;
      const payload = await getParsingResults(params.search_id, userId, page, limit, sort_by);

      return {
        total: payload.total,
        page: payload.page,
        limit: payload.limit,
        results: payload.results.map(mapChannelToResponse),
      };
    },
  );

  app.get(
    "/:search_id/export",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: searchIdParamsSchema, query: exportQuerySchema })],
    },
    async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const params = request.params as SearchParams;
      const channels = await getAllParsedChannels(params.search_id, userId);
      const csv = buildCsvPayload(channels);

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", 'attachment; filename="parsing_results.csv"');
      return csv;
    },
  );

  app.get(
    "/:search_id/progress",
    {
      preHandler: [verifyJWT, getCurrentUser, validateRequest({ params: searchIdParamsSchema })],
    },
    async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) {
        throw new AuthError("Authentication required");
      }

      const params = request.params as SearchParams;
      const summary = await getParsingSearchSummary(params.search_id, userId);
      if (!summary) {
        throw new NotFoundError("Search request not found");
      }

      reply.code(200);
      await streamParsingProgress(reply, summary.id, summary.status, summary.resultCount);
      return reply;
    },
  );
}
