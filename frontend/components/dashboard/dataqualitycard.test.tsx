/**
 * @fileoverview Component tests for DataQualityCard
 *
 * Verifies that the card reflects the REAL postvalidationqueries.LastRunStatus
 * data instead of placeholder stats (UX finding F11): "Not Run" appears only
 * when no validation query has run, mixed statuses render the real breakdown,
 * and a failed fetch surfaces the error state rather than lying with "Not Run".
 *
 * @see /components/dashboard/dataqualitycard.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
      expect(mockFetch).toHaveBeenCalledWith(EXPECTED_FETCH_URL, { method: 'GET' });
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
    expect(screen.getByText('Validations have not been executed')).toBeInTheDocument();
    expect(screen.getByText('3 pending')).toBeInTheDocument();
    expect(screen.getByText('3 total')).toBeInTheDocument();
  });

  it('shows the real status breakdown, not "Not Run", when queries have mixed LastRunStatus values', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, queryName: 'Passed query', lastRunStatus: 'success', lastRunAt: new Date('2026-07-01T10:00:00Z'), ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 2, queryName: 'Failed query', lastRunStatus: 'failure', lastRunAt: new Date('2026-07-01T11:00:00Z'), ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 3, queryName: 'Pending query', lastRunStatus: undefined })
    ]);

    renderCard();

    expect(await screen.findByText('1 passed')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.getByText('3 total')).toBeInTheDocument();
    expect(screen.getByText('Issues Found')).toBeInTheDocument();
    expect(screen.queryByText('Not Run')).not.toBeInTheDocument();
  });

  it('treats LastRunStatus from another plot/census as pending for the active census', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, queryName: 'Stale passed query', lastRunStatus: 'success', lastRunPlotID: TEST_PLOT_ID, lastRunCensusID: TEST_CENSUS_ID + 1 }),
      buildQuery({ queryID: 2, queryName: 'Current passed query', lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT })
    ]);

    renderCard();

    expect(await screen.findByText('1 passed')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.queryByText('Excellent')).not.toBeInTheDocument();
  });

  it('does not degrade to "Attention Needed" when every query that ran passed and the rest are merely pending', async () => {
    // 3 of 10 queries ran (all passed), 7 never ran. Pending queries are not
    // failures: the pass rate is over queries that RAN, so zero failures must
    // never render a warning badge.
    mockQueriesResponse([
      ...[1, 2, 3].map(queryID => buildQuery({ queryID, queryName: `Passed query ${queryID}`, lastRunStatus: 'success' as const, ...CURRENT_RUN_CONTEXT })),
      ...[4, 5, 6, 7, 8, 9, 10].map(queryID => buildQuery({ queryID, queryName: `Pending query ${queryID}`, lastRunStatus: undefined }))
    ]);

    renderCard();

    expect(await screen.findByText('3 passed')).toBeInTheDocument();
    expect(screen.getByText('7 pending')).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
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

  it('shows "Excellent" when every enabled query passed', async () => {
    mockQueriesResponse([
      buildQuery({ queryID: 1, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 2, lastRunStatus: 'success', ...CURRENT_RUN_CONTEXT }),
      buildQuery({ queryID: 3, queryName: 'Disabled query', isEnabled: false, lastRunStatus: 'failure' })
    ]);

    renderCard();

    expect(await screen.findByText('Excellent')).toBeInTheDocument();
    expect(screen.getByText('2 passed')).toBeInTheDocument();
    // Disabled queries are excluded from the stats entirely
    expect(screen.getByText('2 total')).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
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

    expect(await screen.findByText('Excellent')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch without a schema', () => {
    render(<DataQualityCard plotID={TEST_PLOT_ID} censusID={TEST_CENSUS_ID} />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText('No validation data available')).toBeInTheDocument();
  });
});
