import { describe, expect, it } from 'vitest';
import { selectVisibleJobs, summarizeJobs, type UploadJobSummary } from './uploadjobstatusbadge';

const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function job(status: string, updatedAt: string, jobID = 1): UploadJobSummary {
  return {
    jobID,
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

describe('summarizeJobs', () => {
  // The API orders by UpdatedAt DESC and terminal jobs stay visible for a day,
  // so a job that finished five minutes ago sorts ahead of one still sitting in
  // 'queued' with its creation timestamp. Reading jobs[0] made the badge
  // announce a completed job while live work was invisible behind it.
  it('leads with live work even when a finished job sorted ahead of it', () => {
    const jobs = [job('completed', '2026-07-28T11:55:00.000Z', 41), job('queued', '2026-07-28T11:30:00.000Z', 42)];

    expect(summarizeJobs(jobs).primaryJob.jobID).toBe(42);
  });

  it('speaks for the most recently updated job when several are in flight', () => {
    const jobs = [job('running', '2026-07-28T11:59:00.000Z', 43), job('queued', '2026-07-28T11:30:00.000Z', 44)];

    expect(summarizeJobs(jobs).primaryJob.jobID).toBe(43);
  });

  it('does not report failure while another job is still in flight', () => {
    const jobs = [job('failed', '2026-07-28T11:55:00.000Z', 41), job('running', '2026-07-28T11:30:00.000Z', 42)];

    const summary = summarizeJobs(jobs);
    expect(summary.hasFailure).toBe(false);
    expect(summary.primaryJob.jobID).toBe(42);
  });

  it('reports failure once nothing is in flight', () => {
    const jobs = [job('completed', '2026-07-28T11:55:00.000Z', 41), job('failed', '2026-07-28T11:30:00.000Z', 42)];

    const summary = summarizeJobs(jobs);
    expect(summary.hasFailure).toBe(true);
    expect(summary.primaryJob.jobID).toBe(41);
  });
});
