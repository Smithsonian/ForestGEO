import { describe, expect, it } from 'vitest';
import { selectFailureContext } from './repository';
import { setupFailureSummary } from '@/lib/uploads/setup-failure';
import type { BackgroundJobEventRecord, BackgroundJobRecord } from './types';

const job = { jobID: 4, status: 'failed', lastError: 'safe fallback' } as BackgroundJobRecord;
const event = (eventID: number, eventType: string, details: Record<string, unknown> = {}): BackgroundJobEventRecord => ({
  eventID,
  jobID: 4,
  eventType,
  message: null,
  details,
  createdAt: new Date()
});

describe('selectFailureContext', () => {
  it('uses a terminal diagnostic from the exact failure attempt and file family', () => {
    const events = [
      event(5, 'failed', { attemptID: 'new', fileID: 'a.csv', batchID: 'batch-a' }),
      event(4, 'setup_diagnostic', {
        attemptID: 'new',
        terminal: true,
        outcome: 'failed',
        fileID: 'a.csv',
        batchID: 'batch-a',
        step: 'splitting',
        summary: 'Split setup timed out'
      }),
      event(3, 'setup_diagnostic', { attemptID: 'old', terminal: true, fileID: 'b.csv', batchID: 'batch-b', step: 'cleanup', summary: 'stale context' })
    ];
    expect(selectFailureContext(job, events)).toMatchObject({ summary: 'Split setup timed out', step: 'splitting', attemptID: 'new' });
  });

  it('suppresses an earlier failed transition after a new claim', () => {
    const events = [event(8, 'claimed', { workerID: 'next' }), event(7, 'failed', { attemptID: 'prior' })];
    expect(selectFailureContext(job, events)).toEqual({ summary: 'safe fallback' });
  });

  it('falls back without inventing a step for malformed or missing history', () => {
    expect(
      selectFailureContext(job, [
        event(9, 'failed', { attemptID: 'a' }),
        event(8, 'setup_diagnostic', { attemptID: 'a', terminal: true, step: 'sql-secret', summary: 17 })
      ])
    ).toEqual({ summary: 'safe fallback' });
    expect(selectFailureContext(job, [])).toEqual({ summary: 'safe fallback' });
  });

  it('surfaces step and attempt for a setup that failed and rolled back cleanly (finding 2)', () => {
    const ATTEMPT = 'worker-a';
    const retryingJob = { jobID: 4, status: 'waiting_retry', lastError: 'Deadlock found when trying to get lock' } as BackgroundJobRecord;
    const events = [
      event(6, 'waiting_retry', { attemptID: ATTEMPT, fileID: 'f.csv', batchID: 'b' }),
      event(5, 'setup_diagnostic', {
        attemptID: ATTEMPT,
        fileID: 'f.csv',
        batchID: 'b',
        step: 'cleanup',
        outcome: 'failed',
        terminal: true,
        code: 'ER_LOCK_DEADLOCK',
        summary: setupFailureSummary('ER_LOCK_DEADLOCK')
      })
    ];
    const context = selectFailureContext(retryingJob, events);
    console.log('[finding-2] context:', context);
    expect(context).toEqual({
      code: 'ER_LOCK_DEADLOCK',
      summary: setupFailureSummary('ER_LOCK_DEADLOCK'),
      step: 'cleanup',
      attemptID: ATTEMPT,
      fileID: 'f.csv',
      batchID: 'b'
    });
  });

  it('rejects an embedded context whose file or batch differs from the transition', () => {
    const embeddedFor = (fileID: string, batchID: string) =>
      selectFailureContext(job, [
        event(5, 'failed', {
          attemptID: 'a',
          fileID: 'a.csv',
          batchID: 'batch-a',
          failureContext: { attemptID: 'a', fileID, batchID, summary: 'embedded', step: 'cleanup' }
        })
      ]);
    expect(embeddedFor('a.csv', 'batch-a')).toMatchObject({ summary: 'embedded', step: 'cleanup' });
    expect(embeddedFor('other.csv', 'batch-a')).toEqual({ summary: 'safe fallback' });
    expect(embeddedFor('a.csv', 'other-batch')).toEqual({ summary: 'safe fallback' });
  });
});
