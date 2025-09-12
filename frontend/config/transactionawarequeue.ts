import PQueue from 'p-queue';
import ConnectionManager from './connectionmanager';
import ailogger from '@/ailogger';
import { v4 as uuidv4 } from 'uuid';

/**
 * TransactionAwarePQueue
 *
 * A wrapper around PQueue that coordinates with MySQL transaction management
 * to prevent deadlocks caused by concurrent database operations.
 *
 * Key Features:
 * - Synchronizes queue concurrency with MySQL connection pool limits
 * - Implements application-level locks for shared database resources
 * - Provides transaction-aware task scheduling with dependency tracking
 * - Handles deadlock detection and automatic retry with exponential backoff
 */

interface ResourceLock {
  lockId: string;
  ownerId: string;
  lockedAt: number;
  resource: string;
}

interface TaskOptions {
  priority?: number;
  dependencies?: string[];
  resourceLocks?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
}

class TransactionAwarePQueue extends PQueue {
  private connectionManager: ConnectionManager;
  private resourceLocks: Map<string, ResourceLock> = new Map();
  private taskDependencies: Map<string, Set<string>> = new Map();
  private lockTimeout = 60000; // 1 minute timeout for locks
  private readonly DEADLOCK_RETRY_BASE_DELAY = 100; // Base delay for deadlock retries
  private readonly MAX_DEADLOCK_RETRIES = 5;

  constructor(options: { concurrency?: number } = {}) {
    // Limit concurrency to prevent overwhelming MySQL connection pool
    const safeConcurrency = Math.min(options.concurrency || 12, 12);
    super({
      concurrency: safeConcurrency,
      intervalCap: safeConcurrency * 2,
      interval: 1000, // Allow bursts but throttle over time
      carryoverConcurrencyCount: true
    });

    this.connectionManager = ConnectionManager.getInstance();

    // Clean up expired locks periodically
    setInterval(() => this.cleanupExpiredLocks(), 30000);

    ailogger.info(`TransactionAwarePQueue initialized with concurrency: ${safeConcurrency}`);
  }

  /**
   * Add a transaction-aware task to the queue
   */
  async addTransactionTask<T>(task: () => Promise<T>, options: TaskOptions = {}): Promise<T> {
    const taskId = uuidv4();
    const {
      priority = 0,
      dependencies = [],
      resourceLocks = [],
      maxRetries = this.MAX_DEADLOCK_RETRIES,
      retryDelayMs = this.DEADLOCK_RETRY_BASE_DELAY
    } = options;

    const result = this.add(
      async () => {
        // Wait for dependencies
        await this.waitForDependencies(dependencies);

        // Acquire resource locks
        const acquiredLocks: string[] = [];

        try {
          for (const resource of resourceLocks) {
            const lockId = await this.acquireResourceLock(resource, taskId);
            acquiredLocks.push(lockId);
          }

          // Execute task with deadlock retry logic
          return await this.executeWithDeadlockRetry(task, maxRetries, retryDelayMs);
        } finally {
          // Release all acquired locks
          for (const lockId of acquiredLocks) {
            await this.releaseResourceLock(lockId);
          }
        }
      },
      { priority }
    );

    return result as Promise<T>;
  }

  /**
   * Create a batch-aware task that processes files sequentially but batches within files concurrently
   */
  async addBatchTask<T>(fileId: string, batchTasks: (() => Promise<T>)[], options: TaskOptions = {}): Promise<T[]> {
    const batchId = uuidv4();
    const resourceLocks = [
      `file:${fileId}`, // File-level lock
      'temporarymeasurements', // Table-level lock for uploads
      ...(options.resourceLocks || [])
    ];

    return this.addTransactionTask(
      async () => {
        ailogger.info(`Starting batch processing for file: ${fileId} (${batchTasks.length} tasks)`);

        // Process all batch tasks concurrently within the file lock
        const results = await Promise.all(
          batchTasks.map((batchTask, index) =>
            this.executeWithDeadlockRetry(batchTask, options.maxRetries || this.MAX_DEADLOCK_RETRIES, options.retryDelayMs || this.DEADLOCK_RETRY_BASE_DELAY)
          )
        );

        ailogger.info(`Completed batch processing for file: ${fileId}`);
        return results;
      },
      {
        ...options,
        resourceLocks
      }
    );
  }

  /**
   * Get queue statistics for monitoring
   */
  getStats() {
    return {
      size: this.size,
      pending: this.pending,
      concurrency: this.concurrency,
      activeLocks: this.resourceLocks.size,
      lockDetails: Array.from(this.resourceLocks.entries()).map(([resource, lock]) => ({
        resource,
        ownerId: lock.ownerId,
        lockedAt: new Date(lock.lockedAt).toISOString(),
        age: Date.now() - lock.lockedAt
      }))
    };
  }

  /**
   * Execute a task with automatic deadlock detection and retry
   */
  private async executeWithDeadlockRetry<T>(task: () => Promise<T>, maxRetries: number, baseDelayMs: number): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      try {
        return await task();
      } catch (error: any) {
        attempt++;
        lastError = error;

        if (this.isDeadlockError(error) && attempt < maxRetries) {
          // Exponential backoff with jitter for deadlock retries
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
          ailogger.warn(`Deadlock detected (attempt ${attempt}/${maxRetries}), retrying after ${delay.toFixed(0)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-deadlock error or max retries exceeded
        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Acquire a resource lock to prevent concurrent access to shared database resources
   */
  private async acquireResourceLock(resource: string, ownerId: string): Promise<string> {
    const lockId = uuidv4();
    const maxWaitTime = this.lockTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const existingLock = this.resourceLocks.get(resource);

      if (!existingLock) {
        // No existing lock, acquire it
        const lock: ResourceLock = {
          lockId,
          ownerId,
          lockedAt: Date.now(),
          resource
        };

        this.resourceLocks.set(resource, lock);
        ailogger.info(`Resource lock acquired: ${resource} by ${ownerId} (${lockId})`);
        return lockId;
      } else if (existingLock.ownerId === ownerId) {
        // Same owner, reuse existing lock
        ailogger.info(`Resource lock reused: ${resource} by ${ownerId} (${existingLock.lockId})`);
        return existingLock.lockId;
      }

      // Wait for lock to be released
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error(`Failed to acquire resource lock for ${resource} within ${maxWaitTime}ms`);
  }

  /**
   * Release a resource lock
   */
  private async releaseResourceLock(lockId: string): Promise<void> {
    for (const [resource, lock] of this.resourceLocks.entries()) {
      if (lock.lockId === lockId) {
        this.resourceLocks.delete(resource);
        ailogger.info(`Resource lock released: ${resource} (${lockId})`);
        return;
      }
    }

    ailogger.warn(`Attempted to release non-existent lock: ${lockId}`);
  }

  /**
   * Clean up expired resource locks
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const expiredLocks: string[] = [];

    for (const [resource, lock] of this.resourceLocks.entries()) {
      if (now - lock.lockedAt > this.lockTimeout) {
        expiredLocks.push(resource);
      }
    }

    for (const resource of expiredLocks) {
      const lock = this.resourceLocks.get(resource);
      if (lock) {
        ailogger.warn(`Cleaning up expired resource lock: ${resource} (${lock.lockId})`);
        this.resourceLocks.delete(resource);
      }
    }

    if (expiredLocks.length > 0) {
      ailogger.info(`Cleaned up ${expiredLocks.length} expired resource locks`);
    }
  }

  /**
   * Wait for task dependencies to complete
   */
  private async waitForDependencies(dependencies: string[]): Promise<void> {
    for (const dependency of dependencies) {
      while (this.taskDependencies.has(dependency)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Check if an error is a MySQL deadlock error
   */
  private isDeadlockError(error: any): boolean {
    return (
      error &&
      (error.code === 'ER_LOCK_DEADLOCK' ||
        error.errno === 1213 ||
        error.message?.includes('Deadlock found') ||
        error.message?.includes('Lock wait timeout exceeded'))
    );
  }
}

export default TransactionAwarePQueue;
