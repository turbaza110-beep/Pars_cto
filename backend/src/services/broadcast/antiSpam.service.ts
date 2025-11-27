import { logger } from "@/utils/logger";

const BASE_DELAY_MS = 500; // base delay between messages in ms
const MAX_DELAY_MS = 5000; // maximum delay
const JITTER_PERCENT = 0.2; // 20% random jitter
const BACKOFF_MULTIPLIER = 1.5; // exponential backoff multiplier

export interface AntiSpamConfig {
  accountAge?: number; // account age in days
  baseDelay?: number; // base delay in ms
  failureRate?: number; // failure rate (0-1)
}

export class AntiSpamService {
  private failureCount = 0;
  private successCount = 0;

  constructor(private config: AntiSpamConfig = {}) {}

  getBaseDelay(): number {
    const accountAge = this.config.accountAge ?? 0;
    if (accountAge === 0) {
      return BASE_DELAY_MS * 2; // new accounts wait longer
    }
    if (accountAge < 7) {
      return BASE_DELAY_MS * 1.5; // accounts less than a week old
    }
    return BASE_DELAY_MS; // established accounts
  }

  /**
   * Calculate adaptive delay with jitter and backoff
   * @param isFloodWait if true, apply exponential backoff
   * @returns delay in milliseconds
   */
  calculateDelay(isFloodWait = false): number {
    const base = this.getBaseDelay();
    const failureRate = this.successCount + this.failureCount > 0
      ? this.failureCount / (this.successCount + this.failureCount)
      : 0;

    // Apply exponential backoff based on failure rate
    const backoffFactor = Math.pow(BACKOFF_MULTIPLIER, Math.max(0, failureRate));
    let delay = base * backoffFactor;

    // Apply flood wait penalty
    if (isFloodWait) {
      delay *= 3; // triple the delay on flood wait
    }

    // Apply random jitter
    const jitterAmount = delay * JITTER_PERCENT;
    const randomJitter = (Math.random() - 0.5) * 2 * jitterAmount;
    delay += randomJitter;

    // Clamp to max delay
    return Math.min(Math.max(Math.round(delay), 0), MAX_DELAY_MS);
  }

  recordSuccess(): void {
    this.successCount += 1;
  }

  recordFailure(): void {
    this.failureCount += 1;
  }

  getStats() {
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      failureRate: this.successCount + this.failureCount > 0
        ? this.failureCount / (this.successCount + this.failureCount)
        : 0,
    };
  }

  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
  }
}
