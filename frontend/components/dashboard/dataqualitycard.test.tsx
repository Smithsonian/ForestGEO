/**
 * @fileoverview Component tests for DataQualityCard
 *
 * Verifies that the card reflects the REAL postvalidationqueries.LastRunStatus
 * data instead of placeholder stats (UX finding F11): "Not Run" appears only
 * when no post-census statistics query has run, mixed statuses render the real
 * breakdown, and a failed fetch surfaces the error state rather than lying with
 * "Not Run".
 *
 * Issue #517: counts are labelled as post-census statistics QUERIES (not rows,
 * not validation-procedure pass/fail), "no definitions" / "not run" / "error"
 * are distinct, and every request/result obeys the schema/plot/census scope
 * (stale results ignored, in-flight requests aborted).
 *
 * @see /components/dashboard/dataqualitycard.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DataQualityCard from './dataqualitycard';
import { PostValidationQueriesRDS } from '@/lib/db/definitions/validations';

const TEST_SCHEMA = 'forestgeo_testing';
const TEST_PLOT_ID = 7;
const TEST_CENSUS_ID = 3;
const EXPECTED_FETCH_URL = `/api/fetchall/postvalidationqueries/${TEST_PLOT_ID}/${TEST_CENSUS_ID}?schema=${TEST_SCHEMA}`;
const CURRENT_RUN_CONTEXT = { lastRunPlotID: TEST_PLOT_ID, lastRunCensusID: TEST_CENSUS_ID };

const mockFetch = vi.fn();

function buildQuery(overrides: Partial<PostValidationQueriesRDS>): PostValidationQueriesRDS {
  return {
    id: 1,
    queryID: 1,
    queryName: 'Validation Query',
    isEnabled: true,
    lastRunStatus: undefined,
    ...overrides
  };
}

function mockQueriesResponse(queries: PostValidationQueriesRDS[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => queries
  });
}

function okResponse(queries: PostValidationQueriesRDS[]) {
  return { ok: true, json: async () => queries };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderCard() {
  return render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);
}

describe('DataQualityCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches postvalidationqueries for the active schema/plot/census', async () => {
    mockQueriesResponse([buildQuery({ queryID: 1 })]);

    renderCard();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(EXPECTED_FETCH_URL, expect.objectContaining({ method: 'GET' }));
    });
  });

  it('shows "Not Run" only when no query has a LastRunStatus', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, queryName: 'Stems without measurements', lastRunStatus: undefined }),
      buildQuery({ queryID: 2, queryName: 'Duplicate tags', lastRunStatus: undefined }),
      buildQuery({ queryID: 3, queryName: 'Orphaned quadrats', lastRunStatus: undefined })
    ]);

    renderCard();

    expect(await screen.findByText('Not Run')).toBeInTheDocument();
    expect(screen.getByText('Post-census statistics queries have not been run for this census')).toBeInTheDocument();
    expect(screen.getByText('3 not run yet')).toBeInTheDocument();
    expect(screen.getByText('3 statistics queries')).toBeInTheDocument();
  });

  it('shows the real status breakdown, not "Not Run", when queries have mixed LastRunStatus values', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, queryName: 'Passed query', lastRunStatus: 'success', lastRunAt: new Date('2026-07-01T10:00:00Z'), ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 2, queryName: 'Failed query', lastRunStatus: 'failure', lastRunAt: new Date('2026-07-01T11:00:00Z'), ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 3, queryName: 'Pending query', lastRunStatus: undefined })
    ]);

    renderCard();

    expect(await screen.findByText('1 ran successfully')).toBeInTheDocument();
    expect(screen.getByText('1 failed to run')).toBeInTheDocument();
    expect(screen.getByText('1 not run yet')).toBeInTheDocument();
    expect(screen.getByText('3 statistics queries')).toBeInTheDocument();
    expect(screen.getByText('Query Errors')).toBeInTheDocument();
    expect(screen.queryByText('Not Run')).not.toBeInTheDocument();
  });

  it('treats LastRunStatus from another plot/census as pending for the active census', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, queryName: 'Stale passed query', lastRunStatus: 'success', lastRunPlotID: TEST_PLOT_ID, lastRunCensusID: TEST_CENSUS_ID + 1 }),
      buildQuery({ queryID: 2, queryName: 'Current passed query', lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT })
    ]);

    renderCard();

    expect(await screen.findByText('1 ran successfully')).toBeInTheDocument();
    expect(screen.getByText('1 not run yet')).toBeInTheDocument();
    expect(screen.queryByText('All Queries Ran')).not.toBeInTheDocument();
  });

  it('does not degrade to "Attention Needed" when every query that ran succeeded and the rest are merely not run yet', async () => {
    // 3 of 10 queries ran (all succeeded), 7 never ran. Never-run queries are not
    // failures: the rate is over queries that RAN, so zero failures must never
    // render a warning badge.
    mockQueriesResponse([
      ...[1, 2, 3].map(queryID => buildQuery({ queryID, queryName: `Passed query ${queryID}`, lastRunStatus: 'success' as const, ...CURRENT_RUN_CONTEXT })),
      ...[4, 5, 6, 7, 8, 9, 10].map(queryID => buildQuery({ queryID, queryName: `Pending query ${queryID}`, lastRunStatus: undefined }))
    ]);

    renderCard();

    expect(await screen.findByText('3 ran successfully')).toBeInTheDocument();
    expect(screen.getByText('7 not run yet')).toBeInTheDocument();
    expect(screen.queryByText(/failed to run/)).not.toBeInTheDocument();
    expect(screen.getByText('Mostly Run')).toBeInTheDocument();
    expect(screen.queryByText('Attention Needed')).not.toBeInTheDocument();
  });

  it('does not show stale last-run timestamps in expanded query details', async () => {
    mockQueriesResponse([
      buildQuery({
        queryID: 1,
        queryName: 'Stale passed query',
        lastRunStatus: 'success',
        lastRunAt: new Date('2026-07-01T10:00:00Z'),
        lastRunPlotID: TEST_PLOT_ID,
        lastRunCensusID: TEST_CENSUS_ID + 1
      })
    ]);

    render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} defaultExpanded />);

    expect(await screen.findByText('Stale passed query')).toBeInTheDocument();
    expect(screen.queryByText(/ago$/i)).not.toBeInTheDocument();
  });

  it('shows "All Queries Ran" when every enabled query ran successfully', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 2, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 3, queryName: 'Disabled query', isEnabled: false, lastRunStatus: 'failure' })
    ]);

    renderCard();

    expect(await screen.findByText('All Queries Ran')).toBeInTheDocument();
    expect(screen.getByText('2 ran successfully')).toBeInTheDocument();
    // Disabled queries are excluded from the stats entirely
    expect(screen.getByText('2 statistics queries')).toBeInTheDocument();
    expect(screen.queryByText(/failed to run/)).not.toBeInTheDocument();
  });

  it('surfaces the fetch failure instead of showing "Not Run" when the API errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' })
    });

    renderCard();

    expect(await screen.findByText('Data Quality Check Failed')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch validation queries (HTTP 500)')).toBeInTheDocument();
    expect(screen.queryByText('Not Run')).not.toBeInTheDocument();
  });

  it('surfaces network failures instead of showing "Not Run"', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    renderCard();

    expect(await screen.findByText('Data Quality Check Failed')).toBeInTheDocument();
    expect(screen.getByText('Network unreachable')).toBeInTheDocument();
    expect(screen.queryByText('Not Run')).not.toBeInTheDocument();
  });

  it('does not fetch when preloaded stats are provided', async () => {
    render(
      <DataQualityCard
        schema={TEST_SCHEMA}
        plotID={TEST_PLOT_ID}
        censusID={TEST_CENSUS_ID}
        stats={{
          totalQueries: 2,
          passedQueries: 2,
          failedQueries: 0,
          pendingQueries: 0,
          queries: []
        }}
      />
    );

    expect(await screen.findByText('All Queries Ran')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch without a schema', () => {
    render(<DataQualityCard plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Select a site to see post-census statistics query status')).toBeInTheDocument();
  });

  describe('honest labelling and distinct states (#517)', () => {
    it('labels counts as post-census statistics queries, not rows or validation pass/fail', async () => {
      mockQueriesResponse([buildQuery({ queryID: 1, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT }), buildQuery({ queryID: 2, lastRunStatus: undefined })]);

      renderCard();

      expect(await screen.findByText('1 ran successfully')).toBeInTheDocument();
      expect(screen.getByText('1 not run yet')).toBeInTheDocument();
      expect(screen.getByText('2 statistics queries')).toBeInTheDocument();
      expect(screen.queryByText(/\bpending\b/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\btotal\b/)).not.toBeInTheDocument();
      expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
    });

    it('distinguishes "no query definitions" from "not run yet" and from a request error', async () => {
      mockQueriesResponse([buildQuery({ queryID: 1, isEnabled: false })]);

      renderCard();

      expect(await screen.findByText('No post-census statistics queries defined')).toBeInTheDocument();
      expect(screen.queryByText('Not Run')).not.toBeInTheDocument();
      expect(screen.queryByText('Data Quality Check Failed')).not.toBeInTheDocument();
    });

    it('treats a non-array 200 payload as an error, not as empty data', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'nope' }) });

      renderCard();

      expect(await screen.findByText('Data Quality Check Failed')).toBeInTheDocument();
      expect(screen.queryByText('No post-census statistics queries defined')).not.toBeInTheDocument();
    });

    it('shows a loading skeleton, not an empty message, while the request is in flight', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => undefined));

      renderCard();

      expect(screen.queryByText('Select a site to see post-census statistics query status')).not.toBeInTheDocument();
      expect(screen.queryByText('Not Run')).not.toBeInTheDocument();
      expect(screen.queryByText('No post-census statistics queries defined')).not.toBeInTheDocument();
    });

    it('retry after an error re-requests the same scope and recovers', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));
      mockQueriesResponse([buildQuery({ queryID: 1, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT })]);

      renderCard();
      await screen.findByText('Network unreachable');
      fireEvent.click(screen.getByLabelText('Retry'));

      expect(await screen.findByText('1 ran successfully')).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('scope guarding (#517)', () => {
    it('ignores an older response that resolves after a newer scope was requested', async () => {
      const first = deferred<ReturnType<typeof okResponse>>();
      const second = deferred<ReturnType<typeof okResponse>>();
      mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

      const { rerender } = render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);
      rerender(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID + 1} />);

      second.resolve(
        okResponse([
          buildQuery({ queryID: 1, queryName: 'New census', lastRunStatus: 'success', lastRunPlotID: TEST_PLOT_ID, lastRunCensusID: TEST_CENSUS_ID + 1 })
        ])
      );
      expect(await screen.findByText('1 ran successfully')).toBeInTheDocument();

      // The superseded request resolves late, with different content, and must be dropped.
      first.resolve(okResponse([buildQuery({ queryID: 1 }), buildQuery({ queryID: 2 }), buildQuery({ queryID: 3 })]));
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.getByText('1 ran successfully')).toBeInTheDocument();
      expect(screen.queryByText('3 statistics queries')).not.toBeInTheDocument();
    });

    it('does not show the previous scope results while the new scope loads', async () => {
      mockQueriesResponse([buildQuery({ queryID: 1, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT })]);
      const { rerender } = render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);
      await screen.findByText('1 ran successfully');

      mockFetch.mockReturnValueOnce(new Promise(() => undefined));
      rerender(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID + 1} />);

      expect(screen.queryByText('1 ran successfully')).not.toBeInTheDocument();
    });

    it('ignores a stale error from a superseded scope', async () => {
      const first = deferred<never>();
      mockFetch.mockReturnValueOnce(first.promise);
      const { rerender } = render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);

      mockQueriesResponse([buildQuery({ queryID: 1, lastRunStatus: undefined })]);
      rerender(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID + 1} />);
      await screen.findByText('1 not run yet');

      first.reject(new Error('late failure from the old scope'));
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByText('Data Quality Check Failed')).not.toBeInTheDocument();
      expect(screen.getByText('1 not run yet')).toBeInTheDocument();
    });

    it('aborts the in-flight request on scope change and on unmount', () => {
      const signals: AbortSignal[] = [];
      mockFetch.mockImplementation((_url: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return new Promise(() => undefined);
      });

      const { rerender, unmount } = render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);
      rerender(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID + 1} censusID={TEST_CENSUS_ID} />);

      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);

      unmount();
      expect(signals[1].aborted).toBe(true);
    });

    it('requests the new scope URL with the new plot and census together', () => {
      mockFetch.mockImplementation(() => new Promise(() => undefined));
      const { rerender } = render(<DataQualityCard schema={TEST_SCHEMA} plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);

      rerender(<DataQualityCard schema="forestgeo_other" plotID={9} censusID={12} />);

      expect(mockFetch).toHaveBeenLastCalledWith('/api/fetchall/postvalidationqueries/9/12?schema=forestgeo_other', expect.objectContaining({ method: 'GET' }));
    });
  });
});
