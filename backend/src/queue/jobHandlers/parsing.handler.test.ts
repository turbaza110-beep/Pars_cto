import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bull";

import { ParseSearchJob } from "@/jobs/parseSearchJob";
import { handleParsingJob } from "@/queue/jobHandlers/parsing.handler";

const mockPersistParsedChannels = vi.fn();
const mockMarkParsingStatus = vi.fn();
const mockSaveParsingProgress = vi.fn();
const mockIncrementParsingUsage = vi.fn();
const mockSearchTelegramChannels = vi.fn();

vi.mock("@/services/parsing/parsing.service", () => ({
  persistParsedChannels: mockPersistParsedChannels,
  markParsingStatus: mockMarkParsingStatus,
}));

vi.mock("@/services/parsing/progress.service", () => ({
  saveParsingProgress: mockSaveParsingProgress,
}));

vi.mock("@/services/parsing/usage.service", () => ({
  incrementParsingUsage: mockIncrementParsingUsage,
}));

vi.mock("@/services/telegram/searchService", () => ({
  searchTelegramChannels: mockSearchTelegramChannels,
}));

describe("parsing job handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistParsedChannels.mockResolvedValue(1);
    mockSearchTelegramChannels.mockResolvedValue([
      {
        channelId: "1001",
        title: "Crypto Alpha",
        username: "@crypto_alpha",
        subscribers: 42000,
        description: "Alpha",
        language: "en",
        activityScore: 0.82,
        activityLevel: "high",
        lastPost: "2025-01-15T10:00:00Z",
      },
    ]);
  });

  it("saves parsed channels and updates usage", async () => {
    const job = buildJob();
    await handleParsingJob(job);

    expect(mockMarkParsingStatus).toHaveBeenCalledWith("search-1", "processing", expect.any(Object));
    expect(mockPersistParsedChannels).toHaveBeenCalledWith("search-1", expect.any(Array));
    expect(mockIncrementParsingUsage).toHaveBeenCalledWith("user-1", 1);
    expect(job.progress).toHaveBeenLastCalledWith(100);

    const finalProgress = mockSaveParsingProgress.mock.calls.at(-1)?.[1];
    expect(finalProgress?.status).toBe("completed");
  });

  it("marks job as failed when search fails", async () => {
    const job = buildJob();
    mockSearchTelegramChannels.mockRejectedValueOnce(new Error("telegram unavailable"));

    await expect(handleParsingJob(job)).rejects.toThrow("telegram unavailable");

    const failureCall = mockMarkParsingStatus.mock.calls.at(-1);
    expect(failureCall?.[1]).toBe("failed");
    const progressCall = mockSaveParsingProgress.mock.calls.at(-1);
    expect(progressCall?.[1].status).toBe("failed");
  });
});

function buildJob(overrides?: Partial<ParseSearchJob>): Job<ParseSearchJob> {
  const progress = vi.fn().mockResolvedValue(undefined);
  const data: ParseSearchJob = {
    requestId: "req-1",
    searchId: "search-1",
    userId: "user-1",
    query: "crypto",
    filters: undefined,
    mode: "simulation",
    ...overrides,
  };

  return {
    id: "job-1",
    data,
    progress,
  } as unknown as Job<ParseSearchJob>;
}
