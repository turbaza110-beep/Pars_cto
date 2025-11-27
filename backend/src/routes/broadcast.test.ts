import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";

import { createServer } from "@/server";
import { config } from "@/config/config";
import { JobTypes } from "@/jobs/jobTypes";
import type { BroadcastCampaign, BroadcastLog } from "@/services/broadcast/broadcast.service";
import type { BroadcastProgressSnapshot } from "@/services/broadcast/progress.service";

vi.mock("@/middleware/rateLimitMiddleware", () => ({
  rateLimitMiddleware: vi.fn(),
}));

let currentUserId = "user-123";
vi.mock("@/middleware/getCurrentUser", () => ({
  getCurrentUser: vi.fn(async (request: { user?: { id?: string } }) => {
    request.user = { id: currentUserId };
  }),
}));

vi.mock("@/services/auth/tokenBlacklist.service", () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  blacklistToken: vi.fn().mockResolvedValue(undefined),
}));

const mockAssertActiveSubscription = vi.fn();
vi.mock("@/services/parsing/usage.service", () => ({
  assertActiveSubscription: mockAssertActiveSubscription,
}));

const mockCheckBroadcastQuota = vi.fn();
const mockCheckAndIncrementBroadcastUsage = vi.fn();
vi.mock("@/services/broadcast/usage.service", () => ({
  checkBroadcastQuota: mockCheckBroadcastQuota,
  checkAndIncrementBroadcastUsage: mockCheckAndIncrementBroadcastUsage,
}));

const mockCreateCampaign = vi.fn();
const mockGetCampaignForUser = vi.fn();
const mockListCampaigns = vi.fn();
const mockListBroadcastLogs = vi.fn();
const mockUpdateCampaignStatus = vi.fn();
vi.mock("@/services/broadcast/broadcast.service", () => ({
  createCampaign: mockCreateCampaign,
  getCampaignForUser: mockGetCampaignForUser,
  listCampaigns: mockListCampaigns,
  listBroadcastLogs: mockListBroadcastLogs,
  updateCampaignStatus: mockUpdateCampaignStatus,
}));

const mockSaveBroadcastProgress = vi.fn();
const mockReadBroadcastProgress = vi.fn();
vi.mock("@/services/broadcast/progress.service", () => ({
  saveBroadcastProgress: mockSaveBroadcastProgress,
  readBroadcastProgress: mockReadBroadcastProgress,
}));

const mockGetSegment = vi.fn();
const mockCalculateTotalRecipients = vi.fn();
const mockGetSegmentRecipients = vi.fn();
vi.mock("@/services/audience/audienceService", () => ({
  getSegment: mockGetSegment,
  calculateTotalRecipients: mockCalculateTotalRecipients,
  getSegmentRecipients: mockGetSegmentRecipients,
}));

const mockAddJob = vi.fn();
vi.mock("@/utils/queueHelpers", () => ({
  addJob: mockAddJob,
}));

describe("Broadcast routes", () => {
  const baseDate = new Date("2025-01-15T10:00:00Z");
  const manualMetadata = {
    source: "manual",
    manual_recipients: ["@alpha"],
    total_recipients: 1,
  } satisfies Record<string, unknown>;

  const draftCampaign: BroadcastCampaign = {
    id: "cmp-1",
    userId: "user-123",
    title: "Promo",
    content: "Hello",
    status: "draft",
    segmentId: null,
    scheduledAt: null,
    lastSentAt: null,
    metadata: manualMetadata,
    createdAt: baseDate,
    updatedAt: baseDate,
  };

  const failedCampaign: BroadcastCampaign = {
    ...draftCampaign,
    status: "failed",
    metadata: { ...manualMetadata, sent: 1, failed: 1 },
  };

  const defaultLog: BroadcastLog = {
    id: "log-1",
    campaignId: draftCampaign.id,
    userId: draftCampaign.userId,
    recipient: "@alpha",
    status: "sent",
    errorMessage: null,
    metadata: {},
    sentAt: baseDate,
  };

  beforeEach(() => {
    currentUserId = "user-123";
    vi.clearAllMocks();

    mockCreateCampaign.mockResolvedValue(draftCampaign);
    mockGetCampaignForUser.mockResolvedValue(draftCampaign);
    mockListCampaigns.mockResolvedValue({ total: 1, campaigns: [draftCampaign] });
    mockListBroadcastLogs.mockResolvedValue({ total: 1, logs: [defaultLog] });
    mockUpdateCampaignStatus.mockResolvedValue(draftCampaign);
    mockCheckBroadcastQuota.mockResolvedValue(undefined);
    mockCheckAndIncrementBroadcastUsage.mockResolvedValue(undefined);
    mockSaveBroadcastProgress.mockResolvedValue(undefined);
    mockReadBroadcastProgress.mockResolvedValue(null);
    mockGetSegment.mockResolvedValue({
      id: "segment-1",
      userId: draftCampaign.userId,
      name: "Test",
      description: null,
      sourceParsingId: "search-1",
      filters: null,
      totalRecipients: 5,
      status: "ready",
      createdAt: baseDate.toISOString(),
      updatedAt: baseDate.toISOString(),
    });
    mockCalculateTotalRecipients.mockResolvedValue(5);
    mockGetSegmentRecipients.mockResolvedValue(["@alpha", "@beta"]);
    mockAddJob.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("validates campaign creation payload", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .post("/api/v1/broadcast/campaigns")
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({ title: "Test", content: "Hello" });

      expect(response.status).toBe(422);
      expect(mockCreateCampaign).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("starts a campaign and enqueues a job", async () => {
    const scheduledCampaign: BroadcastCampaign = {
      ...draftCampaign,
      status: "scheduled",
      updatedAt: new Date(baseDate.getTime() + 1000),
    };
    mockUpdateCampaignStatus.mockResolvedValue(scheduledCampaign);

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .post(`/api/v1/broadcast/${draftCampaign.id}/start`)
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(202);
      expect(response.body.job_id).toBe("job-1");
      expect(mockAddJob).toHaveBeenCalledWith(
        JobTypes.BROADCAST,
        expect.objectContaining({ campaignId: draftCampaign.id, recipients: ["@alpha"] }),
      );
      expect(mockSaveBroadcastProgress).toHaveBeenCalledWith(
        draftCampaign.id,
        expect.objectContaining({ status: "initializing", total: 1 }),
      );
    } finally {
      await app.close();
    }
  });

  it("retries a failed campaign", async () => {
    mockGetCampaignForUser.mockResolvedValueOnce(failedCampaign);
    const retriedCampaign: BroadcastCampaign = { ...failedCampaign, status: "scheduled" };
    mockUpdateCampaignStatus.mockResolvedValueOnce(retriedCampaign);

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .post(`/api/v1/broadcast/${failedCampaign.id}/retry`)
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(202);
      expect(response.body.retry_count).toBe(1);
      expect(mockCheckAndIncrementBroadcastUsage).toHaveBeenCalledWith(currentUserId, 1);
    } finally {
      await app.close();
    }
  });

  it("paginates broadcast history", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get("/api/v1/broadcast/history")
        .query({ page: 1, limit: 10 })
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body.campaigns).toHaveLength(1);
      expect(response.body.total).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("streams progress over SSE", async () => {
    const snapshot: BroadcastProgressSnapshot = {
      campaignId: draftCampaign.id,
      status: "completed",
      progress: 100,
      processed: 2,
      total: 2,
      sent: 2,
      failed: 0,
      skipped: 0,
      updated_at: new Date().toISOString(),
    };
    mockReadBroadcastProgress.mockResolvedValue(snapshot);

    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get(`/api/v1/broadcast/${draftCampaign.id}/progress`)
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
