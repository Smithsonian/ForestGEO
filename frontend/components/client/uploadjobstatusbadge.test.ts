import { describe, expect, it } from 'vitest';
import { selectVisibleJobs, type UploadJobSummary } from './uploadjobstatusbadge';

const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function job(status: string, updatedAt: string): UploadJobSummary {
  return {
    jobID: 1,
    status,
    phase: status,
    percentComplete: 0,
    totalFiles: 1,
    processedRows: 0,
    failedRows: 0,
    lastError: null,
    updatedAt
  };
}

describe('selectVisibleJobs', () => {
  it('keeps active jobs regardless of age and recent terminal outcomes', () => {
    const visible = selectVisibleJobs(
      [
        job('running', '2020-01-01T00:00:00.000Z'),
        job('failed', '2026-07-28T11:00:00.000Z'),
        job('completed', '2026-07-28T10:00:00.000Z'),
        job('cancelled', '2026-07-26T10:00:00.000Z'),
        job('unknown', '2026-07-28T11:00:00.000Z')
      ],
      NOW
    );

    expect(visible.map(entry => entry.status)).toEqual(['running', 'failed', 'completed']);
  });
});
