import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@/utils/clients", () => ({
  pgPool: {
    query: mockQuery,
  },
}));

import { runErrorLogCleanup } from "./errorLogCleanup";

describe("errorLogCleanup cron job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete old error logs", async () => {
    mockQuery.mockResolvedValue({ rowCount: 5 });

    await runErrorLogCleanup();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM error_logs"),
      expect.any(Array),
    );
  });

  it("should handle errors during deletion", async () => {
    mockQuery.mockImplementationOnce(() => Promise.reject(new Error("db error")));
    mockQuery.mockResolvedValueOnce({});

    await expect(runErrorLogCleanup()).rejects.toThrow("db error");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO error_logs"),
      expect.any(Array),
    );
  });
});
