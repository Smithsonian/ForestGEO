import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JOB_POLL_INTERVAL_MS, selectVisibleJobs, summarizeJobs, type UploadJobSummary } from './uploadjobstatusbadge';
import UploadJobStatusBadge from './uploadjobstatusbadge';
import { registerSubmittedUploadJob, resetUploadJobCompletionTrackerForTests } from '@/components/uploadsystemhelpers/uploadjobcompletiontracker';
import ailogger from '@/ailogger';

const { mockInvalidateAfter, mockTriggerRefresh } = vi.hoisted(() => ({ mockInvalidateAfter: vi.fn(), mockTriggerRefresh: vi.fn() }));
vi.mock('@/lib/query/invalidateAfter', () => ({ invalidateAfter: mockInvalidateAfter }));
vi.mock('@/app/contexts/datavalidityprovider', () => ({ useDataValidityContext: () => ({ triggerRefresh: mockTriggerRefresh }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe('UploadJobStatusBadge rendered status', () => {
  it('shows a safe failure summary on the visible card and actionable details by keyboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jobs: [
                {
                  ...job('failed', new Date().toISOString(), 26),
                  percentComplete: 45,
                  totalFiles: 1,
                  processedRows: 412421,
                  failedRows: 6,
                  retryCount: 3,
                  maxRetries: 3,
                  sourceFormat: 'csv',
                  failureContext: {
                    code: 'SETUP_CALLBACK_TIMEOUT',
                    summary: 'The file uploaded, but preparing its measurements took too long.',
                    step: 'splitting'
                  },
                  lastError: 'setup failed'
                }
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    render(createElement(UploadJobStatusBadge, { schema: 'forest', plotID: 1, censusID: 1 }));
    expect(await screen.findByText('The file uploaded, but preparing its measurements took too long.')).toBeTruthy();
    expect(screen.getByText(/Rows staged 412421/)).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    const card = screen.getByRole('button', { name: 'Open upload job progress details' });
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Last step: Splitting')).toBeTruthy());
    expect(screen.getByText(/retry 3\/3/)).toBeTruthy();
  });
});

describe('UploadJobStatusBadge refreshes data when an upload job finishes (#525 item 6)', () => {
  const SCHEMA = 'forest';
  const PLOT_A = 1;
  const PLOT_B = 2;
  const CENSUS_ID = 7;
  const REGISTERED_COMPLETED_JOB_ID = 11;
  const RUNNING_THEN_COMPLETED_JOB_ID = 12;
  const FINISHED_WHILE_UNMOUNTED_JOB_ID = 13;
  const FINISHED_IN_OTHER_SCOPE_JOB_ID = 14;
  const RUNNING_THEN_TERMINAL_CASES = [
    ['failed', 15],
    ['cancelled', 18]
  ] as const;
  const PRE_EXISTING_TERMINAL_JOB_ID = 16;
  const REJECTED_INVALIDATION_JOB_ID = 17;
  const fetchMock = vi.fn();
  let jobsByPlot: Map<number, UploadJobSummary[]>;

  beforeEach(() => {
    // One module graph for the whole file; the tracker is emptied instead of re-imported.
    resetUploadJobCompletionTrackerForTests();
    jobsByPlot = new Map();
    fetchMock.mockReset();
    mockInvalidateAfter.mockReset();
    mockTriggerRefresh.mockReset();
    mockInvalidateAfter.mockResolvedValue(undefined);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const plotID = Number(new URL(String(input), 'http://localhost').searchParams.get('plotID'));
      return { ok: true, json: async () => ({ jobs: jobsByPlot.get(plotID) ?? [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function nowIso(): string {
    return new Date().toISOString();
  }

  function badgeFor(plotID: number) {
    return createElement(UploadJobStatusBadge, { schema: SCHEMA, plotID, censusID: CENSUS_ID });
  }

  function scopeFor(plotID: number) {
    return { siteSchema: SCHEMA, plotID, censusID: CENSUS_ID };
  }

  async function settlePoll() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function advanceToNextPoll() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    });
  }

  function logRefreshState(label: string) {
    console.log(
      `[#525 item 6] ${label}: polls=${fetchMock.mock.calls.length} invalidateAfter=${JSON.stringify(mockInvalidateAfter.mock.calls)} triggerRefresh=${mockTriggerRefresh.mock.calls.length}`
    );
  }

  // Judged before any refresh assertion, so "0 invalidateAfter calls" always means "after N real polls".
  function expectPolls(expectedPollCount: number, label: string) {
    logRefreshState(label);
    expect(fetchMock, `${label}: the badge must have polled ${expectedPollCount} time(s)`).toHaveBeenCalledTimes(expectedPollCount);
  }

  it('refreshes once for a registered job first seen completed, and not again on the next poll', async () => {
    registerSubmittedUploadJob(REGISTERED_COMPLETED_JOB_ID);
    jobsByPlot.set(PLOT_A, [job('completed', nowIso(), REGISTERED_COMPLETED_JOB_ID)]);
    render(badgeFor(PLOT_A));
    await settlePoll();
    expectPolls(1, 'first poll');
    expect(mockInvalidateAfter.mock.calls).toEqual([['upload-job', scopeFor(PLOT_A)]]);
    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);

    await advanceToNextPoll();
    expectPolls(2, 'second poll');
    expect(mockInvalidateAfter).toHaveBeenCalledTimes(1);
    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when a job goes from running to completed across polls', async () => {
    jobsByPlot.set(PLOT_A, [job('running', nowIso(), RUNNING_THEN_COMPLETED_JOB_ID)]);
    render(badgeFor(PLOT_A));
    await settlePoll();
    expectPolls(1, 'running poll');
    expect(mockInvalidateAfter).not.toHaveBeenCalled();

    jobsByPlot.set(PLOT_A, [job('completed', nowIso(), RUNNING_THEN_COMPLETED_JOB_ID)]);
    await advanceToNextPoll();
    expectPolls(2, 'running -> completed');
    expect(mockInvalidateAfter.mock.calls).toEqual([['upload-job', scopeFor(PLOT_A)]]);
    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes once on the first poll after a remount when the job finished while unmounted', async () => {
    jobsByPlot.set(PLOT_A, [job('running', nowIso(), FINISHED_WHILE_UNMOUNTED_JOB_ID)]);
    const firstMount = render(badgeFor(PLOT_A));
    await settlePoll();
    expectPolls(1, 'before unmount');
    firstMount.unmount();

    jobsByPlot.set(PLOT_A, [job('completed', nowIso(), FINISHED_WHILE_UNMOUNTED_JOB_ID)]);
    render(badgeFor(PLOT_A));
    await settlePoll();
    expectPolls(2, 'after remount');
    expect(mockInvalidateAfter.mock.calls).toEqual([['upload-job', scopeFor(PLOT_A)]]);
  });

  it('refreshes once, with scope A, for a job seen in A that finishes while B is selected', async () => {
    jobsByPlot.set(PLOT_A, [job('running', nowIso(), FINISHED_IN_OTHER_SCOPE_JOB_ID)]);
    const view = render(badgeFor(PLOT_A));
    await settlePoll();
    view.rerender(badgeFor(PLOT_B));
    await settlePoll();
    expectPolls(2, 'in scope B');
    expect(mockInvalidateAfter).not.toHaveBeenCalled();

    jobsByPlot.set(PLOT_A, [job('completed', nowIso(), FINISHED_IN_OTHER_SCOPE_JOB_ID)]);
    view.rerender(badgeFor(PLOT_A));
    await settlePoll();
    expectPolls(3, 'back in scope A');
    expect(mockInvalidateAfter.mock.calls).toEqual([['upload-job', scopeFor(PLOT_A)]]);
  });

  it.each(RUNNING_THEN_TERMINAL_CASES)('refreshes once when a running job ends %s (job %i)', async (terminalStatus, jobID) => {
    jobsByPlot.set(PLOT_A, [job('running', nowIso(), jobID)]);
    render(badgeFor(PLOT_A));
    await settlePoll();
    jobsByPlot.set(PLOT_A, [job(terminalStatus, nowIso(), jobID)]);
    await advanceToNextPoll();
    await advanceToNextPoll();
    expectPolls(3, `running -> ${terminalStatus}`);
    expect(mockInvalidateAfter).toHaveBeenCalledTimes(1);
    expect(mockInvalidateAfter.mock.calls[0]).toEqual(['upload-job', scopeFor(PLOT_A)]);
    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);
  });

  it('never refreshes for a terminal job that was neither registered nor seen active', async () => {
    jobsByPlot.set(PLOT_A, [job('completed', nowIso(), PRE_EXISTING_TERMINAL_JOB_ID)]);
    render(badgeFor(PLOT_A));
    await settlePoll();
    await advanceToNextPoll();
    expectPolls(2, 'pre-existing terminal job');
    expect(mockInvalidateAfter).not.toHaveBeenCalled();
    expect(mockTriggerRefresh).not.toHaveBeenCalled();
  });

  it('logs a rejected invalidation and keeps polling', async () => {
    const invalidationFailure = new Error('mutate rejected');
    mockInvalidateAfter.mockRejectedValueOnce(invalidationFailure);
    registerSubmittedUploadJob(REJECTED_INVALIDATION_JOB_ID);
    jobsByPlot.set(PLOT_A, [job('completed', nowIso(), REJECTED_INVALIDATION_JOB_ID)]);
    render(badgeFor(PLOT_A));
    await settlePoll();
    expectPolls(1, 'poll that triggers the rejected invalidation');

    await advanceToNextPoll();
    expectPolls(2, 'after a rejected invalidation');
    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ailogger.error)).toHaveBeenCalledWith(expect.stringContaining(String(REJECTED_INVALIDATION_JOB_ID)), invalidationFailure);
  });
});
