import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecentChangesExplorer, { summarizeChange } from './recentchangesexplorer';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1 }),
  useSiteContext: () => ({ schemaName: 'forestgeo_testing' })
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data
  };
}

// JSDOM has no `innerText`; @mui/joy/Option falls back to
// `optionRef.current.innerText` to compute a Select's displayed label when
// an Option's children aren't a single string (ours render `{value} ({count})`,
// i.e. multiple text nodes). Scoped to one test via try/finally below —
// restores the original property descriptor (or removes the shim if jsdom
// had none) so it never leaks into other tests in this file.
function installInnerTextShim(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent;
    }
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', descriptor);
    } else {
      delete (HTMLElement.prototype as { innerText?: unknown }).innerText;
    }
  };
}

function makeEntry(changeID: number, tableName: string) {
  return {
    changeID,
    tableName,
    recordID: String(changeID),
    operation: 'UPDATE' as const,
    oldRowState: { MeasuredDBH: 10 },
    newRowState: { MeasuredDBH: 12 },
    changeTimestamp: '2026-04-10T12:00:00.000Z',
    changedBy: 'mason@si.edu'
  };
}

// Renders RecentChangesExplorer with a single bulk-revision-apply entry whose
// NewRowState is the summary fixture used by every bulk-revision summary test
// below, merged with per-test overrides (e.g. failedRowCount) so each test can
// stay focused on the field it's asserting without re-declaring the fetch mock.
async function renderBulkRevisionSummaryCard(newRowStateOverrides: Record<string, unknown> = {}) {
  const bulkSummaryEntry = {
    changeID: 10,
    tableName: 'bulk-revision-apply',
    recordID: 'hash-abc::edit-op-7',
    operation: 'UPDATE' as const,
    oldRowState: null,
    newRowState: {
      updatedCount: 4,
      skippedCount: 1,
      insertedCount: 2,
      deletedDuplicateCount: 0,
      summaryKind: BULK_REVISION_SUMMARY_KIND,
      ...newRowStateOverrides
    },
    changeTimestamp: '2026-04-10T12:00:00.000Z',
    changedBy: 'mason@si.edu'
  };

  global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/changes/explorer/facets') {
      return Promise.resolve(jsonResponse({ users: [], tables: [], operationCounts: { INSERT: 0, UPDATE: 1, DELETE: 0 } }));
    }
    if (url === '/api/changes/explorer/query') {
      return Promise.resolve(
        jsonResponse({
          items: [{ type: 'single', entry: bulkSummaryEntry }],
          totalItems: 1,
          summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
          hasMore: false
        })
      );
    }
    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  }) as any;

  render(<RecentChangesExplorer />);

  await waitFor(() => {
    expect(screen.getByText('Applied a bulk revision')).toBeInTheDocument();
  });
}

describe('RecentChangesExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores stale query responses after filters change', async () => {
    const staleQuery = deferred<ReturnType<typeof jsonResponse>>();
    const freshResponse = {
      items: [{ type: 'single' as const, entry: makeEntry(2, 'fresh_table') }],
      totalItems: 1,
      summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
      hasMore: false
    };
    const staleResponse = {
      items: [{ type: 'single' as const, entry: makeEntry(1, 'stale_table') }],
      totalItems: 1,
      summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
      hasMore: false
    };

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/changes/explorer/facets') {
        return Promise.resolve(
          jsonResponse({
            users: [],
            tables: [],
            operationCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 }
          })
        );
      }

      if (url === '/api/changes/explorer/query') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.filters?.quickSearch === 'fresh') {
          return Promise.resolve(jsonResponse(freshResponse));
        }
        return staleQuery.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as any;

    render(<RecentChangesExplorer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'fresh' } });

    await waitFor(() => {
      expect(screen.getByText('fresh_table')).toBeInTheDocument();
    });
    expect(screen.queryByText('stale_table')).not.toBeInTheDocument();

    await act(async () => {
      staleQuery.resolve(jsonResponse(staleResponse));
      await Promise.resolve();
    });

    expect(screen.getByText('fresh_table')).toBeInTheDocument();
    expect(screen.queryByText('stale_table')).not.toBeInTheDocument();
  });

  it('renders a bulk-revision-apply summary card from the real counts, with no fabricated field diff', async () => {
    // This fixture has no failedRowCount field at all, representing a bulk-revision
    // summary recorded before that field existed.
    await renderBulkRevisionSummaryCard();

    // The real counts from NewRowState must be the ones rendered, and because
    // failedRowCount is absent on this older summary, no ", N failed" suffix
    // (or any mention of "failed") should be appended.
    expect(screen.getByText('Bulk revision applied: 4 updated, 1 skipped, 2 inserted, 0 duplicate(s) removed')).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    // ...and the generic UPDATE diff view (which would compute a diff against
    // the summary object and fabricate per-field "added" changes because
    // OldRowState is null) must never render for this entry.
    expect(screen.queryByText('No visible changes')).not.toBeInTheDocument();
    expect(screen.queryByText('summaryKind')).not.toBeInTheDocument();
    expect(screen.queryByText('updatedCount')).not.toBeInTheDocument();
  });

  it('appends ", N failed" to the bulk-revision summary when failedRowCount is a populated positive number', async () => {
    await renderBulkRevisionSummaryCard({ failedRowCount: 3 });

    expect(screen.getByText('Bulk revision applied: 4 updated, 1 skipped, 2 inserted, 0 duplicate(s) removed, 3 failed')).toBeInTheDocument();
  });

  it('renders an explicit failedRowCount of 0 as ", 0 failed" instead of omitting it', async () => {
    // failedRowCount: 0 is a real, meaningful value (zero rejected rows) and
    // must be distinguished from the field being absent, so the component
    // must not treat 0 the same as "missing" and skip rendering it.
    await renderBulkRevisionSummaryCard({ failedRowCount: 0 });

    expect(screen.getByText('Bulk revision applied: 4 updated, 1 skipped, 2 inserted, 0 duplicate(s) removed, 0 failed')).toBeInTheDocument();
  });

  it("renders the summary cards from the query response's real counts, not a derived/recomputed total", async () => {
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/changes/explorer/facets') {
        return Promise.resolve(jsonResponse({ users: [], tables: [], operationCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 } }));
      }
      if (url === '/api/changes/explorer/query') {
        return Promise.resolve(
          jsonResponse({
            items: [{ type: 'single', entry: makeEntry(1, 'coremeasurements') }],
            totalItems: 9,
            // total deliberately != updates+inserts+deletes, so a passing
            // assertion proves the UI renders these fields verbatim rather
            // than recomputing total from the other three.
            summary: { total: 9, updates: 5, inserts: 3, deletes: 2 },
            hasMore: false
          })
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as any;

    render(<RecentChangesExplorer />);

    await waitFor(() => {
      expect(screen.getByText('coremeasurements')).toBeInTheDocument();
    });

    // "Uploads"/"Deletions" also label preset chips, so scope each query to
    // its own summary card (shares a parent with its label) instead of the
    // whole document.
    const summaryStack = screen.getByText('Total Changes').parentElement!.parentElement!;
    const totalCard = screen.getByText('Total Changes').parentElement!;
    const updatesCard = within(summaryStack).getByText('Updates').parentElement!;
    const uploadsCard = within(summaryStack).getByText('Uploads').parentElement!;
    const deletionsCard = within(summaryStack).getByText('Deletions').parentElement!;
    expect(within(totalCard).getByText('9')).toBeInTheDocument();
    expect(within(updatesCard).getByText('5')).toBeInTheDocument();
    expect(within(uploadsCard).getByText('3')).toBeInTheDocument();
    expect(within(deletionsCard).getByText('2')).toBeInTheDocument();
  });

  it("populates the Changed By and Table filters from the facets response's real values and counts, and applies a selection as a query filter", async () => {
    const restoreInnerText = installInnerTextShim();
    try {
      const user = userEvent.setup();
      const queryFilterBodies: Array<{ filters?: { changedBy?: string } }> = [];

      global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/changes/explorer/facets') {
          return Promise.resolve(
            jsonResponse({
              users: [
                { value: 'mason@si.edu', count: 3 },
                { value: 'legacy@forestgeo.test', count: 1 }
              ],
              tables: [
                { value: 'coremeasurements', count: 2 },
                { value: 'bulk-revision-apply', count: 1 }
              ],
              operationCounts: { INSERT: 0, UPDATE: 3, DELETE: 0 }
            })
          );
        }
        if (url === '/api/changes/explorer/query') {
          queryFilterBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return Promise.resolve(jsonResponse({ items: [], totalItems: 0, summary: { total: 0, updates: 0, inserts: 0, deletes: 0 }, hasMore: false }));
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }) as any;

      render(<RecentChangesExplorer />);

      const changedByCombobox = await screen.findByRole('combobox', { name: /^changed by$/i });
      await user.click(changedByCombobox);
      const changedByListbox = await screen.findByRole('listbox');
      expect(within(changedByListbox).getByRole('option', { name: 'mason@si.edu (3)' })).toBeInTheDocument();
      expect(within(changedByListbox).getByRole('option', { name: 'legacy@forestgeo.test (1)' })).toBeInTheDocument();

      await waitFor(() => expect(queryFilterBodies.length).toBeGreaterThanOrEqual(1));
      const callsBeforeSelection = queryFilterBodies.length;

      await user.click(within(changedByListbox).getByRole('option', { name: 'mason@si.edu (3)' }));

      await waitFor(() => expect(queryFilterBodies.length).toBeGreaterThan(callsBeforeSelection));
      expect(queryFilterBodies[queryFilterBodies.length - 1].filters?.changedBy).toBe('mason@si.edu');
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: /^changed by$/i })).toHaveTextContent('mason@si.edu (3)');
      });

      const tableCombobox = screen.getByRole('combobox', { name: /^table$/i });
      await user.click(tableCombobox);
      const tableListbox = await screen.findByRole('listbox');
      expect(within(tableListbox).getByRole('option', { name: 'coremeasurements (2)' })).toBeInTheDocument();
      expect(within(tableListbox).getByRole('option', { name: 'bulk-revision-apply (1)' })).toBeInTheDocument();
    } finally {
      restoreInnerText();
    }
  });
});

describe('summarizeChange', () => {
  it('labels a bulk-revision-apply entry as "Applied a bulk revision" regardless of operation', () => {
    expect(
      summarizeChange({
        operation: 'UPDATE',
        tableName: 'bulk-revision-apply',
        oldRowState: null,
        newRowState: { summaryKind: BULK_REVISION_SUMMARY_KIND, updatedCount: 1 },
        recordID: 'hash-abc::edit-op-7'
      })
    ).toBe('Applied a bulk revision');
  });

  it('labels a real measurement UPDATE distinctly from a bulk summary UPDATE', () => {
    expect(
      summarizeChange({
        operation: 'UPDATE',
        tableName: 'coremeasurements',
        oldRowState: { MeasuredDBH: 10 },
        newRowState: { MeasuredDBH: 12 },
        recordID: '1::edit-op-7'
      })
    ).toBe('Updated a measurement record');
  });
});
