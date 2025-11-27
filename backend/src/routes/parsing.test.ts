import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";

import { createServer } from "@/server";
import { config } from "@/config/config";
import { ParsingHistoryEntry, ParsedChannel, ParsingProgressSnapshot } from "@/types/parsing";
import { SubscriptionError } from "@/utils/errors";

vi.mock("@/middleware/rateLimitMiddleware", () => ({
  rateLimitMiddleware: vi.fn(),
}));

let currentUserId = "user-123";
vi.mock("@/middleware/getCurrentUser", () => ({
  getCurrentUser: vi.fn(async (request) => {
    request.user = { id: currentUserId };
  }),
}));

vi.mock("@/services/auth/tokenBlacklist.service", () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  blacklistToken: vi.fn().mockResolvedValue(undefined),
}));

const mockAssertActiveSubscription = vi.fn();
const mockAssertParsingQuotaAvailable = vi.fn();
const mockIncrementParsingUsage = vi.fn();

vi.mock("@/services/parsing/usage.service", () => ({
  assertActiveSubscription: mockAssertActiveSubscription,
  assertParsingQuotaAvailable: mockAssertParsingQuotaAvailable,
  incrementParsingUsage: mockIncrementParsingUsage,
}));

const mockCreateParsingSearch = vi.fn();
const mockMergeParsingMetadata = vi.fn();
const mockGetParsingResults = vi.fn();
const mockListParsingHistory = vi.fn();
const mockGetParsingSearchSummary = vi.fn();
const mockGetAllParsedChannels = vi.fn();

vi.mock("@/services/parsing/parsing.service", () => ({
  createParsingSearch: mockCreateParsingSearch,
  mergeParsingMetadata: mockMergeParsingMetadata,
  getParsingResults: mockGetParsingResults,
  listParsingHistory: mockListParsingHistory,
  getParsingSearchSummary: mockGetParsingSearchSummary,
  getAllParsedChannels: mockGetAllParsedChannels,
}));

const mockSaveParsingProgress = vi.fn();
const mockReadParsingProgress = vi.fn();

vi.mock("@/services/parsing/progress.service", () => ({
  saveParsingProgress: mockSaveParsingProgress,
  readParsingProgress: mockReadParsingProgress,
}));

const mockAddJob = vi.fn();

vi.mock("@/utils/queueHelpers", () => ({
  addJob: mockAddJob,
}));

describe("Parsing routes", () => {
  beforeEach(() => {
    currentUserId = "user-123";
    vi.clearAllMocks();

    const defaultHistoryEntry: ParsingHistoryEntry = {
      id: "search-1",
      query: "crypto",
      status: "pending",
      resultCount: 0,
      createdAt: new Date("2025-01-15T10:00:00Z").toISOString(),
      filters: { language: "en" },
    };

    mockCreateParsingSearch.mockResolvedValue(defaultHistoryEntry);
    mockListParsingHistory.mockResolvedValue([defaultHistoryEntry]);
    mockGetParsingResults.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 50,
      results: [
        {
          channelId: "1001",
          title: "Crypto Alpha",
          username: "@crypto_alpha",
          subscribers: 42000,
          description: "Daily alpha",
          language: "en",
          activityScore: 0.82,
          activityLevel: "high",
          lastPost: "2025-01-15T09:00:00Z",
        } satisfies ParsedChannel,
      ],
    });
    mockGetAllParsedChannels.mockResolvedValue([]);
    mockGetParsingSearchSummary.mockResolvedValue(defaultHistoryEntry);
    mockAddJob.mockResolvedValue({ id: "job-1" });
    mockReadParsingProgress.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates parsing search jobs", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .post("/api/v1/parsing/search")
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({ query: "Crypto", filters: { language: "EN", min_subscribers: 1000 } });

      expect(response.status).toBe(202);
      expect(response.body.search_id).toBe("search-1");
      expect(mockCreateParsingSearch).toHaveBeenCalledWith(currentUserId, "Crypto", { language: "en", minSubscribers: 1000 }, "simulation");
      expect(mockAddJob).toHaveBeenCalled();
      expect(mockSaveParsingProgress).toHaveBeenCalledWith("search-1", expect.objectContaining({ status: "pending", progress: 0 }));
      expect(mockMergeParsingMetadata).toHaveBeenCalledWith("search-1", { jobId: "job-1" });
    } finally {
      await app.close();
    }
  });

  it("returns 402 when subscription is missing", async () => {
    const app = await buildServer();
    mockAssertActiveSubscription.mockRejectedValueOnce(new SubscriptionError("Active subscription required"));

    try {
      const response = await request(app.server)
        .post("/api/v1/parsing/search")
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({ query: "Crypto" });

      expect(response.status).toBe(402);
    } finally {
      await app.close();
    }
  });

  it("returns history entries with filters", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get("/api/v1/parsing/history")
        .query({ page: 1, limit: 20 })
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body[0]).toMatchObject({
        id: "search-1",
        filters: { language: "en" },
        status: "pending",
      });
    } finally {
      await app.close();
    }
  });

  it("returns paginated results", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get("/api/v1/parsing/search-1/results")
        .query({ page: 1, limit: 50, sort_by: "activity" })
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.results[0]).toMatchObject({
        channel_id: "1001",
        activity_level: "high",
      });
    } finally {
      await app.close();
    }
  });

  it("exports CSV payload", async () => {
    mockGetAllParsedChannels.mockResolvedValue([
      {
        channelId: "1001",
        title: "Crypto Alpha",
        username: "@crypto_alpha",
        subscribers: 42000,
        description: "Daily alpha",
        language: "en",
        activityScore: 0.82,
        activityLevel: "high",
        lastPost: "2025-01-15T09:00:00Z",
      } satisfies ParsedChannel,
    ]);

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get("/api/v1/parsing/search-1/export")
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.header["content-type"]).toContain("text/csv");
      expect(response.text).toContain("id,title,username");
      expect(response.text).toContain("Crypto Alpha");
    } finally {
      await app.close();
    }
  });

  it("streams progress via SSE", async () => {
    const snapshot: ParsingProgressSnapshot = {
      searchId: "search-1",
      status: "completed",
      progress: 100,
      results: 2,
      current: 2,
      total: 2,
      updated_at: new Date().toISOString(),
    };
    mockReadParsingProgress.mockResolvedValue(snapshot);

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get("/api/v1/parsing/search-1/progress")
        .set("Authorization", buildAuthHeader(currentUserId))
        .set("Accept", "text/event-stream");

      expect(response.status).toBe(200);
      expect(response.header["content-type"]).toContain("text/event-stream");
      expect(response.text).toContain("\"status\":\"completed\"");
    } finally {
      await app.close();
    }
  });
});

async function buildServer(): Promise<FastifyInstance> {
  const app = await createServer();
  await app.ready();
  return app;
}

function buildAuthHeader(userId: string) {
  const token = jwt.sign({ sub: userId }, config.security.jwtSecret, { expiresIn: "1h" });
  return `Bearer ${token}`;
}
