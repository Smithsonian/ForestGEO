/**
 * Upload Processing Utilities
 *
 * Extracted helper functions and classes for the upload system.
 * These utilities handle ETA calculation, time formatting, and queue management.
 */

import ailogger from '@/ailogger';

/**
 * Formats milliseconds into a human-readable time remaining string
 */
export function formatTimeRemaining(ms: number): string {
  if (ms < 0 || !isFinite(ms)) return 'Calculating...';

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s remaining`;
  } else if (seconds > 10) {
    return `${seconds}s remaining`;
  } else {
    return 'Almost done...';
  }
}

/**
 * Exponential Moving Average (EMA) Calculator for ETA estimation
 *
 * Uses EMA to smooth out speed measurements for more accurate time remaining estimates.
 * EMA gives more weight to recent measurements while still considering historical data.
 *
 * Formula: EMA(t) = α * value(t) + (1 - α) * EMA(t-1)
 * Where α (alpha) is the smoothing factor between 0 and 1.
 *
 * Higher alpha = more responsive to recent changes (but more volatile)
 * Lower alpha = smoother estimates (but slower to adapt)
 *
 * References:
 * - https://stackoverflow.com/questions/40057020/calculating-exponential-moving-average-ema-using-javascript
 * - https://stackoverflow.com/questions/933242/smart-progress-bar-eta-computation
 */
export class ETACalculator {
  private emaSpeed: number | null = null;
  private lastTimestamp: number = 0;
  private lastProgress: number = 0;
  private alpha: number;
  private minSamples: number;
  private sampleCount: number = 0;

  /**
   * @param alpha - Smoothing factor (0.1 = very smooth, 0.3 = responsive). Default 0.2
   * @param minSamples - Minimum samples before providing ETA. Default 3
   */
  constructor(alpha: number = 0.2, minSamples: number = 3) {
    this.alpha = alpha;
    this.minSamples = minSamples;
  }

  /**
   * Update with new progress measurement
   * @param currentProgress - Current progress (0 to total)
   * @param total - Total units of work
   * @returns Estimated time remaining in milliseconds, or null if insufficient data
   */
  update(currentProgress: number, total: number): number | null {
    const now = performance.now();

    if (this.lastTimestamp === 0) {
      // First measurement - just record it
      this.lastTimestamp = now;
      this.lastProgress = currentProgress;
      return null;
    }

    const timeDelta = now - this.lastTimestamp;
    const progressDelta = currentProgress - this.lastProgress;

    // Skip if no progress or negative time (shouldn't happen)
    if (progressDelta <= 0 || timeDelta <= 0) {
      return this.emaSpeed !== null ? this.calculateETA(currentProgress, total) : null;
    }

    // Calculate instantaneous speed (units per millisecond)
    const instantSpeed = progressDelta / timeDelta;

    // Apply EMA smoothing
    if (this.emaSpeed === null) {
      this.emaSpeed = instantSpeed;
    } else {
      this.emaSpeed = this.alpha * instantSpeed + (1 - this.alpha) * this.emaSpeed;
    }

    // Update state
    this.lastTimestamp = now;
    this.lastProgress = currentProgress;
    this.sampleCount++;

    // Only return ETA after minimum samples collected
    if (this.sampleCount < this.minSamples) {
      return null;
    }

    return this.calculateETA(currentProgress, total);
  }

  private calculateETA(currentProgress: number, total: number): number | null {
    if (this.emaSpeed === null || this.emaSpeed <= 0) {
      return null;
    }

    const remaining = total - currentProgress;
    if (remaining <= 0) {
      return 0;
    }

    // ETA = remaining work / smoothed speed
    return remaining / this.emaSpeed;
  }

  /**
   * Reset calculator for new operation
   */
  reset(): void {
    this.emaSpeed = null;
    this.lastTimestamp = 0;
    this.lastProgress = 0;
    this.sampleCount = 0;
  }
}

/**
 * Transaction-aware queue interface
 */
export interface TransactionAwareQueue {
  add: (task: () => Promise<void>) => void;
  clear: () => void;
  onEmpty: () => Promise<void>;
  readonly size: number;
}

/**
 * Creates a transaction-aware queue with proper concurrency control
 *
 * Uses iterative approach instead of recursion to prevent stack overflow on large queues.
 *
 * @param concurrency - Maximum number of concurrent tasks
 * @returns Queue interface with add, clear, onEmpty, and size
 */
export function createTransactionAwareQueue(concurrency: number): TransactionAwareQueue {
  let running = 0;
  let pending: (() => Promise<void>)[] = [];
  let isEmpty = true;
  let emptyResolvers: (() => void)[] = [];

  // Use iterative approach instead of recursion to prevent stack overflow on large queues
  const processNext = async () => {
    if (pending.length === 0) {
      if (running === 0) {
        isEmpty = true;
        emptyResolvers.forEach(resolve => resolve());
        emptyResolvers = [];
      }
      return;
    }

    const task = pending.shift()!;
    running++;
    isEmpty = false;

    try {
      await task();
    } catch (error) {
      ailogger.error('Task failed:', error instanceof Error ? error : new Error(String(error)));
    } finally {
      running--;
      // Use setImmediate/setTimeout to break recursion chain and prevent stack overflow
      if (pending.length > 0 && running < concurrency) {
        setTimeout(() => processNext(), 0);
      } else if (running === 0 && pending.length === 0) {
        isEmpty = true;
        emptyResolvers.forEach(resolve => resolve());
        emptyResolvers = [];
      }
    }
  };

  return {
    add: (task: () => Promise<void>) => {
      pending.push(task);
      if (running < concurrency) {
        processNext();
      }
    },
    clear: () => {
      pending = [];
    },
    onEmpty: () => {
      if (isEmpty && running === 0) {
        return Promise.resolve();
      }
      return new Promise<void>(resolve => {
        emptyResolvers.push(resolve);
      });
    },
    get size() {
      return pending.length;
    }
  };
}
