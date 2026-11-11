import { describe, expect, it, vi } from 'vitest';
import { attachFailureContexts, recordSetupDiagnostic } from './repository';
import type { BackgroundJobRecord } from './types';

describe('recordSetupDiagnostic safe optional fields', () => {
  it('persists lifecycle counters while omitting invalid values', async () => {
    const query = vi.fn().mockResolvedValue([{}, undefined]);
    const pool = { query } as never;
    const details = {
      attemptID: 'attempt',
      fileID: 'file.csv',
      batchID: 'batch',
      schema: 'forestgeo_test',
      plotID: 1,
      censusID: 2,
      step: 'splitting',
      outcome: 'completed',
      assignedRows: 12,
      completedBatches: -1,
      rowCount: -2,
      detail: 'bounded'
    };
    await recordSetupDiagnostic(pool, 1, details);

    const persistedDetails = JSON.parse(query.mock.calls[0][1][3] as string) as Record<string, unknown>;
    expect(persistedDetails).toMatchObject({ assignedRows: 12, detail: 'bounded' });
    expect(persistedDetails).not.toHaveProperty('completedBatches');
    expect(persistedDetails).not.toHaveProperty('rowCount');
  });
});

describe('attachFailureContexts event lookup', () => {
  const buildJob = (jobID: number, status: string) => ({ jobID, status, lastError: null }) as unknown as BackgroundJobRecord;

  it('queries job events only for jobs that can carry failure context (finding 10)', async () => {
    const query = vi.fn().mockResolvedValue([[]]);
    const pool = { query } as never;
    const jobs = [buildJob(1, 'running'), buildJob(2, 'completed')];

    const unchanged = await attachFailureContexts(pool, jobs);
    console.log('[finding-10] queries for non-failing jobs:', query.mock.calls.length);
    expect(query).not.toHaveBeenCalled();
    expect(unchanged.map(job => job.failureContext ?? null)).toEqual([null, null]);

    await attachFailureContexts(pool, [...jobs, buildJob(3, 'failed')]);
    console.log('[finding-10] event query params:', query.mock.calls[0]?.[1]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([3]);
  });
});
