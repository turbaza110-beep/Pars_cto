import request from "supertest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";

import { createServer } from "@/server";
import { config } from "@/config/config";
import { AudienceSegment } from "@/types/audience";
import { RateLimitError, SubscriptionError } from "@/utils/errors";

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
vi.mock("@/services/parsing/usage.service", () => ({
  assertActiveSubscription: mockAssertActiveSubscription,
}));

const mockAddJob = vi.fn();
vi.mock("@/utils/queueHelpers", () => ({
  addJob: mockAddJob,
}));

const mockCreateSegment = vi.fn();
const mockListSegments = vi.fn();
const mockGetSegment = vi.fn();
const mockUpdateSegment = vi.fn();
const mockDeleteSegment = vi.fn();
const mockGetSegmentPreview = vi.fn();

vi.mock("@/services/audience/audienceService", () => ({
  createSegment: mockCreateSegment,
  listSegments: mockListSegments,
  getSegment: mockGetSegment,
  updateSegment: mockUpdateSegment,
  deleteSegment: mockDeleteSegment,
  getSegmentPreview: mockGetSegmentPreview,
}));

describe("Audience routes", () => {
  const defaultSegment: AudienceSegment = {
    id: "segment-1",
    userId: "user-123",
    name: "Crypto Enthusiasts",
    description: "Users into crypto",
    sourceParsingId: "search-1",
    filters: {
      language: "en",
      engagementMin: 0.4,
      minSubscribers: 1000,
    },
    totalRecipients: 1250,
    status: "ready",
    createdAt: new Date("2025-01-01T10:00:00Z").toISOString(),
    updatedAt: new Date("2025-01-01T11:00:00Z").toISOString(),
  } satisfies AudienceSegment;

  beforeEach(() => {
    vi.clearAllMocks();
    currentUserId = "user-123";
    mockAssertActiveSubscription.mockResolvedValue(undefined);
    mockCreateSegment.mockResolvedValue(defaultSegment);
    mockListSegments.mockResolvedValue([defaultSegment]);
    mockGetSegment.mockResolvedValue(defaultSegment);
    mockUpdateSegment.mockResolvedValue({ ...defaultSegment, totalRecipients: 1500 });
    mockGetSegmentPreview.mockResolvedValue({
      total: 1250,
      preview: [
        {
          username: "@user1",
          userId: 123456789,
          engagementScore: 0.85,
          activityLevel: "high",
        },
      ],
    });
  });

  it("creates an audience segment with normalized filters", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .post("/api/v1/audience/segments")
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({
          name: " Crypto Fans ",
          description: "Daily alpha",
          source_parsing_id: "search-1",
          filters: { language: "EN", engagement_min: 0.4, min_subscribers: 1000 },
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ id: "segment-1", total_recipients: 1250, status: "ready" });
      expect(mockCreateSegment).toHaveBeenCalledWith({
        userId: currentUserId,
        name: " Crypto Fans ",
        description: "Daily alpha",
        sourceParsingId: "search-1",
        filters: { language: "en", engagementMin: 0.4, minSubscribers: 1000 },
      });
      expect(mockAddJob).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns paginated segments with created_at", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get("/api/v1/audience/segments")
        .query({ page: 1, limit: 10 })
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body[0]).toMatchObject({ id: "segment-1", created_at: defaultSegment.createdAt });
      expect(mockListSegments).toHaveBeenCalledWith(currentUserId, 1, 10);
    } finally {
      await app.close();
    }
  });

  it("returns segment details with formatted filters", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get(`/api/v1/audience/${defaultSegment.id}`)
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: defaultSegment.id,
        filters: { language: "en", engagement_min: 0.4 },
      });
    } finally {
      await app.close();
    }
  });

  it("updates segment filters and enqueues refresh job", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .put(`/api/v1/audience/${defaultSegment.id}`)
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({ filters: { engagement_min: 0.6 } });

      expect(response.status).toBe(200);
      expect(mockUpdateSegment).toHaveBeenCalledWith({
        userId: currentUserId,
        segmentId: defaultSegment.id,
        filters: { engagementMin: 0.6 },
      });
      expect(mockAddJob).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("deletes a segment", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .delete(`/api/v1/audience/${defaultSegment.id}`)
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockDeleteSegment).toHaveBeenCalledWith(currentUserId, defaultSegment.id);
    } finally {
      await app.close();
    }
  });

  it("returns preview entries", async () => {
    const app = await buildServer();
    try {
      const response = await request(app.server)
        .get(`/api/v1/audience/${defaultSegment.id}/preview`)
        .query({ limit: 5 })
        .set("Authorization", buildAuthHeader(currentUserId));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ total: 1250 });
      expect(response.body.preview[0]).toMatchObject({ username: "@user1", engagement_score: 0.85 });
      expect(mockGetSegmentPreview).toHaveBeenCalledWith(currentUserId, defaultSegment.id, 5);
    } finally {
      await app.close();
    }
  });

  it("propagates subscription errors", async () => {
    const app = await buildServer();
    mockAssertActiveSubscription.mockRejectedValueOnce(new SubscriptionError("Subscription required"));

    try {
      const response = await request(app.server)
        .post("/api/v1/audience/segments")
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({ name: "Test", source_parsing_id: "search-1" });

      expect(response.status).toBe(402);
    } finally {
      await app.close();
    }
  });

  it("returns 429 when limit is exceeded", async () => {
    const app = await buildServer();
    mockCreateSegment.mockRejectedValueOnce(new RateLimitError("Audience limit exceeded"));

    try {
      const response = await request(app.server)
        .post("/api/v1/audience/segments")
        .set("Authorization", buildAuthHeader(currentUserId))
        .send({ name: "Test", source_parsing_id: "search-1" });

      expect(response.status).toBe(429);
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
