import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockEnqueuePendingPaymentReminder, mockEnqueuePaymentCancellationNotice } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockEnqueuePendingPaymentReminder: vi.fn(),
  mockEnqueuePaymentCancellationNotice: vi.fn(),
}));

vi.mock("@/utils/clients", () => ({
  pgPool: {
    query: mockQuery,
  },
}));

vi.mock("@/services/notification/notification.service", () => ({
  enqueuePendingPaymentReminder: mockEnqueuePendingPaymentReminder,
  enqueuePaymentCancellationNotice: mockEnqueuePaymentCancellationNotice,
}));

import { runPaymentCheck } from "./paymentCheck";

describe("paymentCheck cron job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should cancel payments older than 24 hours", async () => {
    const oldPayment = {
      id: "payment-1",
      user_id: "user-1",
      amount: "100.00",
      currency: "RUB",
      status: "pending",
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      last_reminder_at: null,
    };

    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, user_id")) {
        return Promise.resolve({ rows: [oldPayment] });
      }
      return Promise.resolve({ rows: [] });
    });

    mockEnqueuePaymentCancellationNotice.mockResolvedValue("notif-1");

    await runPaymentCheck();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE payments"),
      ["payment-1"],
    );

    expect(mockEnqueuePaymentCancellationNotice).toHaveBeenCalledWith(
      "user-1",
      "payment-1",
      100.0,
      "RUB",
    );
  });

  it("should send reminders for pending payments older than 30 minutes", async () => {
    const recentPayment = {
      id: "payment-2",
      user_id: "user-2",
      amount: "200.50",
      currency: "RUB",
      status: "pending",
      created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      last_reminder_at: null,
    };

    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, user_id")) {
        return Promise.resolve({ rows: [recentPayment] });
      }
      return Promise.resolve({ rows: [] });
    });

    mockEnqueuePendingPaymentReminder.mockResolvedValue("notif-2");

    await runPaymentCheck();

    expect(mockEnqueuePendingPaymentReminder).toHaveBeenCalledWith(
      "user-2",
      "payment-2",
      200.5,
      "RUB",
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE payments"),
      ["payment-2"],
    );
  });

  it("should not send reminders too frequently", async () => {
    const payment = {
      id: "payment-3",
      user_id: "user-3",
      amount: "150.00",
      currency: "RUB",
      status: "pending",
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      last_reminder_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    mockQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, user_id")) {
        return Promise.resolve({ rows: [payment] });
      }
      return Promise.resolve({ rows: [] });
    });

    await runPaymentCheck();

    expect(mockEnqueuePendingPaymentReminder).not.toHaveBeenCalled();
    expect(mockEnqueuePaymentCancellationNotice).not.toHaveBeenCalled();
  });

  it("should handle no pending payments", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await runPaymentCheck();

    expect(mockEnqueuePendingPaymentReminder).not.toHaveBeenCalled();
    expect(mockEnqueuePaymentCancellationNotice).not.toHaveBeenCalled();
  });
});
