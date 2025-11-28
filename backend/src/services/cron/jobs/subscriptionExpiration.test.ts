import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockEnqueueSubscriptionExpirationReminder } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockEnqueueSubscriptionExpirationReminder: vi.fn(),
}));

declare module "@/utils/clients" {
  export const pgPool: {
    query: ReturnType<typeof vi.fn>;
  };
}

vi.mock("@/utils/clients", () => ({
  pgPool: {
    query: mockQuery,
  },
}));

vi.mock("@/services/notification/notification.service", () => ({
  enqueueSubscriptionExpirationReminder: mockEnqueueSubscriptionExpirationReminder,
}));

import { runSubscriptionExpirationCheck } from "./subscriptionExpiration";

describe("subscriptionExpiration cron job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should find expiring subscriptions and enqueue notifications", async () => {
    const expiringSubscriptions = [
      {
        id: "sub-1",
        user_id: "user-1",
        plan_code: "premium",
        plan_name: "Premium",
        status: "active",
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        metadata: {},
      },
      {
        id: "sub-2",
        user_id: "user-2",
        plan_code: "basic",
        plan_name: "Basic",
        status: "active",
        expires_at: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
        metadata: {},
      },
    ];

    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, user_id")) {
        return Promise.resolve({ rows: expiringSubscriptions });
      }
      return Promise.resolve({ rows: [] });
    });

    mockEnqueueSubscriptionExpirationReminder.mockResolvedValue("notif-1");

    await runSubscriptionExpirationCheck();

    expect(mockEnqueueSubscriptionExpirationReminder).toHaveBeenCalledTimes(2);
    expect(mockEnqueueSubscriptionExpirationReminder).toHaveBeenCalledWith(
      "user-1",
      "sub-1",
      expect.any(Date),
    );
    expect(mockEnqueueSubscriptionExpirationReminder).toHaveBeenCalledWith(
      "user-2",
      "sub-2",
      expect.any(Date),
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE subscriptions"),
      ["sub-1"],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE subscriptions"),
      ["sub-2"],
    );
  });

  it("should skip subscriptions that already have reminders sent", async () => {
    const subscriptions = [
      {
        id: "sub-1",
        user_id: "user-1",
        plan_code: "premium",
        plan_name: "Premium",
        status: "active",
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        metadata: { expiration_reminder_sent: true },
      },
      {
        id: "sub-2",
        user_id: "user-2",
        plan_code: "basic",
        plan_name: "Basic",
        status: "active",
        expires_at: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
        metadata: {},
      },
    ];

    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, user_id")) {
        return Promise.resolve({ rows: subscriptions });
      }
      return Promise.resolve({ rows: [] });
    });

    mockEnqueueSubscriptionExpirationReminder.mockResolvedValue("notif-1");

    await runSubscriptionExpirationCheck();

    expect(mockEnqueueSubscriptionExpirationReminder).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSubscriptionExpirationReminder).toHaveBeenCalledWith(
      "user-2",
      "sub-2",
      expect.any(Date),
    );
  });

  it("should log errors when notification fails", async () => {
    const subscriptions = [
      {
        id: "sub-1",
        user_id: "user-1",
        plan_code: "premium",
        plan_name: "Premium",
        status: "active",
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        metadata: {},
      },
    ];

    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, user_id")) {
        return Promise.resolve({ rows: subscriptions });
      }
      if (query.includes("INSERT INTO error_logs")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    mockEnqueueSubscriptionExpirationReminder.mockRejectedValue(new Error("Queue unavailable"));

    await runSubscriptionExpirationCheck();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO error_logs"),
      expect.arrayContaining(["user-1", expect.any(String), expect.any(String), expect.any(String)]),
    );
  });

  it("should handle no expiring subscriptions", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await runSubscriptionExpirationCheck();

    expect(mockEnqueueSubscriptionExpirationReminder).not.toHaveBeenCalled();
  });
});
