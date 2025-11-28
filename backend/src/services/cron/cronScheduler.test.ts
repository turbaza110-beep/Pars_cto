import { beforeEach, describe, expect, it, vi } from "vitest";
import { startCronJobs, stopCronJobs, isRunning } from "./cronScheduler";

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({
      stop: vi.fn(),
    }),
  },
}));

vi.mock("./jobs/subscriptionExpiration", () => ({
  runSubscriptionExpirationCheck: vi.fn(),
}));

vi.mock("./jobs/subscriptionCleanup", () => ({
  runSubscriptionCleanup: vi.fn(),
}));

vi.mock("./jobs/paymentCheck", () => ({
  runPaymentCheck: vi.fn(),
}));

vi.mock("./jobs/errorLogCleanup", () => ({
  runErrorLogCleanup: vi.fn(),
}));

describe("cronScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopCronJobs();
  });

  it("should start cron jobs", () => {
    expect(isRunning()).toBe(false);
    startCronJobs();
    expect(isRunning()).toBe(true);
  });

  it("should stop cron jobs", () => {
    startCronJobs();
    expect(isRunning()).toBe(true);
    stopCronJobs();
    expect(isRunning()).toBe(false);
  });

  it("should not start if already running", () => {
    startCronJobs();
    const firstIsRunning = isRunning();
    startCronJobs();
    expect(firstIsRunning).toBe(true);
    expect(isRunning()).toBe(true);
  });

  it("should handle stop when not running", () => {
    expect(isRunning()).toBe(false);
    stopCronJobs();
    expect(isRunning()).toBe(false);
  });
});
