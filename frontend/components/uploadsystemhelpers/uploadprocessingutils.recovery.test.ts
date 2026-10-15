import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransactionAwareQueue } from './uploadprocessingutils';

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

describe('createTransactionAwareQueue recovery behavior', () => {
  beforeEach(() => vi.useRealTimers());

  it('onIdle waits for every running task, even when the first task finishes first', async () => {
    const queue = createTransactionAwareQueue(2);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>(resolve => (finishFirst = resolve));
    const second = new Promise<void>(resolve => (finishSecond = resolve));
    const completed: string[] = [];

    queue.add(async () => {
      await first;
      completed.push('first');
    });
    queue.add(async () => {
      await second;
      completed.push('second');
    });
    let idleResolved = false;
    const idle = queue.onIdle().then(() => {
      idleResolved = true;
    });

    finishFirst();
    await Promise.resolve();
    expect(idleResolved).toBe(false);
    expect(completed).toEqual(['first']);

    finishSecond();
    await idle;
    expect(completed).toEqual(['first', 'second']);
  });

  it('rejects onIdle with a task failure after all active work settles', async () => {
    const queue = createTransactionAwareQueue(2);
    const failure = new Error('setup failed');
    let finishSlow!: () => void;
    const slow = new Promise<void>(resolve => (finishSlow = resolve));
    queue.add(async () => {
      throw failure;
    });
    queue.add(async () => {
      await slow;
    });

    let settled = false;
    const idle = queue.onIdle().catch(error => {
      settled = true;
      throw error;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    finishSlow();
    await expect(idle).rejects.toBe(failure);
  });

  it('clears pending tasks on fatal failure and permits a clean later run', async () => {
    const queue = createTransactionAwareQueue(1);
    const failure = new Error('fatal');
    const started: string[] = [];
    queue.add(async () => {
      started.push('fatal');
      throw failure;
    });
    queue.add(async () => {
      started.push('must-not-run');
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    queue.clear();
    await expect(queue.onIdle()).rejects.toBe(failure);
    expect(started).toEqual(['fatal']);
    expect(queue.size).toBe(0);

    queue.add(async () => {
      started.push('later');
    });
    await queue.onIdle();
    expect(started).toEqual(['fatal', 'later']);
  });
});
