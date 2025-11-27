import { describe, it, expect, beforeEach } from "vitest";
import { AntiSpamService } from "./antiSpam.service";

describe("AntiSpamService", () => {
  let service: AntiSpamService;

  beforeEach(() => {
    service = new AntiSpamService();
  });

  describe("getBaseDelay", () => {
    it("should return doubled delay for new accounts (0 days old)", () => {
      const service = new AntiSpamService({ accountAge: 0 });
      const delay = service.getBaseDelay();
      expect(delay).toBe(1000); // 500 * 2
    });

    it("should return 1.5x delay for accounts less than 7 days old", () => {
      const service = new AntiSpamService({ accountAge: 3 });
      const delay = service.getBaseDelay();
      expect(delay).toBe(750); // 500 * 1.5
    });

    it("should return base delay for established accounts (7+ days old)", () => {
      const service = new AntiSpamService({ accountAge: 30 });
      const delay = service.getBaseDelay();
      expect(delay).toBe(500); // base delay
    });

    it("should default to 2x delay when accountAge is not specified (treated as new account)", () => {
      const delay = service.getBaseDelay();
      expect(delay).toBe(1000); // 500 * 2 (default accountAge is 0)
    });
  });

  describe("calculateDelay", () => {
    it("should calculate delay within expected range", () => {
      const delay = service.calculateDelay();
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000); // MAX_DELAY_MS
    });

    it("should apply exponential backoff based on failure rate", () => {
      const service = new AntiSpamService({ accountAge: 30 });

      // Record some failures
      for (let i = 0; i < 3; i++) {
        service.recordFailure();
      }
      for (let i = 0; i < 1; i++) {
        service.recordSuccess();
      }

      const delayWithFailures = service.calculateDelay();
      const baseDelay = 500;

      // With 3 failures and 1 success, failure rate is 0.75
      // backoff factor = 1.5 ^ 0.75 ≈ 1.34
      const expectedMinDelay = Math.round(baseDelay * 1.34 * 0.8); // allowing for jitter
      const expectedMaxDelay = Math.round(baseDelay * 1.34 * 1.2); // allowing for jitter

      expect(delayWithFailures).toBeGreaterThanOrEqual(expectedMinDelay - 100); // some tolerance
      expect(delayWithFailures).toBeLessThanOrEqual(Math.min(expectedMaxDelay + 100, 5000));
    });

    it("should apply flood wait penalty (3x multiplier)", () => {
      const service = new AntiSpamService({ accountAge: 30 });
      const baseDelay = service.calculateDelay(false);
      const floodWaitDelay = service.calculateDelay(true);

      // Flood wait delay should be roughly 3x (accounting for jitter)
      const ratio = floodWaitDelay / baseDelay;
      expect(ratio).toBeGreaterThan(2.0); // allowing for jitter variance
      expect(ratio).toBeLessThan(4.0); // but not more than 3x + jitter
    });

    it("should apply random jitter within ±20%", () => {
      const service = new AntiSpamService({ accountAge: 30 });
      const delays: number[] = [];

      for (let i = 0; i < 100; i++) {
        delays.push(service.calculateDelay());
      }

      const minDelay = Math.min(...delays);
      const maxDelay = Math.max(...delays);
      const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;

      // Average should be close to base delay (500ms)
      expect(avgDelay).toBeGreaterThan(400);
      expect(avgDelay).toBeLessThan(600);

      // Spread should reflect jitter
      expect(maxDelay - minDelay).toBeGreaterThan(50); // some variance
    });

    it("should clamp delay to MAX_DELAY_MS (5000)", () => {
      const service = new AntiSpamService({ accountAge: 0 });

      // Record many failures to trigger high backoff
      for (let i = 0; i < 100; i++) {
        service.recordFailure();
      }

      const delay = service.calculateDelay(true);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe("recordSuccess and recordFailure", () => {
    it("should track success count", () => {
      service.recordSuccess();
      service.recordSuccess();
      const stats = service.getStats();
      expect(stats.successCount).toBe(2);
    });

    it("should track failure count", () => {
      service.recordFailure();
      service.recordFailure();
      service.recordFailure();
      const stats = service.getStats();
      expect(stats.failureCount).toBe(3);
    });

    it("should calculate failure rate correctly", () => {
      for (let i = 0; i < 3; i++) {
        service.recordSuccess();
      }
      for (let i = 0; i < 2; i++) {
        service.recordFailure();
      }

      const stats = service.getStats();
      expect(stats.failureRate).toBe(2 / 5); // 0.4
    });

    it("should return 0 failure rate when no messages sent", () => {
      const stats = service.getStats();
      expect(stats.failureRate).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return current stats", () => {
      service.recordSuccess();
      service.recordSuccess();
      service.recordFailure();

      const stats = service.getStats();
      expect(stats).toEqual({
        successCount: 2,
        failureCount: 1,
        failureRate: 1 / 3,
      });
    });
  });

  describe("reset", () => {
    it("should reset all counters", () => {
      service.recordSuccess();
      service.recordSuccess();
      service.recordFailure();

      service.reset();

      const stats = service.getStats();
      expect(stats.successCount).toBe(0);
      expect(stats.failureCount).toBe(0);
      expect(stats.failureRate).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle 100% failure rate without crashing", () => {
      for (let i = 0; i < 10; i++) {
        service.recordFailure();
      }

      const delay = service.calculateDelay();
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it("should handle 0% failure rate (all successes)", () => {
      for (let i = 0; i < 10; i++) {
        service.recordSuccess();
      }

      const delay = service.calculateDelay();
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it("should handle mixed success/failure patterns", () => {
      const patterns = [
        { success: 5, failure: 1 }, // 20% failure
        { success: 3, failure: 7 }, // 70% failure
        { success: 1, failure: 0 }, // 0% failure
      ];

      for (const pattern of patterns) {
        service.reset();
        for (let i = 0; i < pattern.success; i++) {
          service.recordSuccess();
        }
        for (let i = 0; i < pattern.failure; i++) {
          service.recordFailure();
        }

        const delay = service.calculateDelay();
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(5000);
      }
    });
  });
});
