import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockWithRedisClient } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithRedisClient: vi.fn(),
}));

vi.mock("@/utils/clients", () => ({
  pgPool: {
    query: mockQuery,
  },
}));

vi.mock("@/services/redis.service", () => ({
  withRedisClient: mockWithRedisClient,
}));

import { runSubscriptionCleanup } from "./subscriptionCleanup";

describe("subscriptionCleanup cron job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should clean up data for expired users", async () => {
    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT DISTINCT user_id")) {
        return Promise.resolve({ rows: [{ user_id: "user-1" }, { user_id: "user-2" }] });
      }
      if (query.includes("SELECT id FROM parsing_history")) {
        return Promise.resolve({ rows: [{ id: "history-1" }, { id: "history-2" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    mockWithRedisClient.mockImplementation(async (callback: (client: { multi: () => { del: (...keys: string[]) => void; exec: () => Promise<void> } }) => Promise<void>) => {
      const mockPipeline = {
        del: vi.fn(),
        exec: vi.fn().mockResolvedValue(undefined),
      };
      const client = {
        multi: vi.fn().mockReturnValue(mockPipeline),
      };
      await callback(client as never);
    });

    await runSubscriptionCleanup();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM parsing_history"),
      expect.arrayContaining(["user-1", "user-2"]),
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM audience_segments"),
      expect.arrayContaining(["user-1", "user-2"]),
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM broadcast_campaigns"),
      expect.arrayContaining(["user-1", "user-2"]),
    );
  });

  it("should skip cleanup when no users qualify", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await runSubscriptionCleanup();

    expect(mockWithRedisClient).not.toHaveBeenCalled();
  });
});
