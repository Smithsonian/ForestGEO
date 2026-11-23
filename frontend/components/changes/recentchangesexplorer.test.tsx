import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecentChangesExplorer, { summarizeChange } from './recentchangesexplorer';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';
import type { ChangelogEntry } from '@/config/recentchangesexplorer';
import { decodeChangelogRow } from '@/config/changelogdecode';

const FIRST_PLOT_ID = 1;
const SECOND_PLOT_ID = 2;
const PLOT_CHANGE_ID_BLOCK = 100;
const UNRENDERED_PRIMARY_KEY = 'pk-should-not-render';
const UNRENDERED_PRIMARY_KEY_PATTERN = new RegExp(UNRENDERED_PRIMARY_KEY);

const selection = vi.hoisted(() => ({ plotID: 1, schemaName: 'forestgeo_testing' }));

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: selection.plotID }),
  useSiteContext: () => ({ schemaName: selection.schemaName })
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

function makeEntry(changeID: number, tableName: string): ChangelogEntry {
  return {
    changeID,
    tableName,
    recordID: String(changeID),
    operation: 'UPDATE',
    oldRowState: { MeasuredDBH: 10 },
    newRowState: { MeasuredDBH: 12 },
    records: [{ primaryKey: String(changeID), oldState: { MeasuredDBH: 10 }, newState: { MeasuredDBH: 12 } }],
    changeTimestamp: '2026-04-10T12:00:00.000Z',
    changedBy: 'mason@si.edu'
  };
}

// Renders RecentChangesExplorer with a single bulk-revision-apply entry whose
// NewRowState is the summary fixture used by every bulk-revision summary test
// below, merged with per-test overrides (e.g. failedRowCount) so each test can
// stay focused on the field it's asserting without re-declaring the fetch mock.
async function renderBulkRevisionSummaryCard(newRowStateOverrides: Record<string, unknown> = {}) {
  const summaryState = {
    updatedCount: 4,
    skippedCount: 1,
    insertedCount: 2,
    deletedDuplicateCount: 0,
    summaryKind: BULK_REVISION_SUMMARY_KIND,
    ...newRowStateOverrides
  };
  const bulkSummaryEntry: ChangelogEntry = {
    changeID: 10,
    tableName: 'bulk-revision-apply',
    recordID: 'hash-abc::edit-op-7',
    operation: 'UPDATE',
    oldRowState: null,
    newRowState: summaryState,
    records: [{ primaryKey: 'hash-abc', oldState: null, newState: summaryState }],
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
    selection.plotID = FIRST_PLOT_ID;
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

  it('requests page 1, not page 2, on the first "Load more" after switching plots (#592 D13)', async () => {
    const EXPECTED_LIST_REQUESTS = 4;
    const queryRequests: Array<{ plotID: number; page: number }> = [];
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/changes/explorer/facets') {
        return Promise.resolve(jsonResponse({ users: [], tables: [], operationCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 } }));
      }
      if (url === '/api/changes/explorer/query') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        queryRequests.push({ plotID: body.plotID, page: body.page });
        const changeID = body.plotID * PLOT_CHANGE_ID_BLOCK + body.page;
        return Promise.resolve(
          jsonResponse({
            items: [{ type: 'single', entry: makeEntry(changeID, `plot${body.plotID}_page${body.page}`) }],
            totalItems: 3,
            summary: { total: 3, updates: 3, inserts: 0, deletes: 0 },
            hasMore: true
          })
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as any;

    const user = userEvent.setup();
    const { rerender } = render(<RecentChangesExplorer />);
    await screen.findByText('plot1_page0');

    await user.click(screen.getByRole('button', { name: 'Load more changes' }));
    await screen.findByText('plot1_page1');

    selection.plotID = SECOND_PLOT_ID;
    rerender(<RecentChangesExplorer />);
    await screen.findByText('plot2_page0');

    await user.click(screen.getByRole('button', { name: 'Load more changes' }));
    await waitFor(() => expect(queryRequests).toHaveLength(EXPECTED_LIST_REQUESTS));

    expect(queryRequests, `every list request in order: ${JSON.stringify(queryRequests)}`).toEqual([
      { plotID: FIRST_PLOT_ID, page: 0 },
      { plotID: FIRST_PLOT_ID, page: 1 },
      { plotID: SECOND_PLOT_ID, page: 0 },
      { plotID: SECOND_PLOT_ID, page: 1 }
    ]);
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

const NO_FACETS = { users: [], tables: [], operationCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 } };

interface ListRequestBody {
  plotID: number;
  page: number;
  filters: { operation: string; changedBy: string; tableName: string; quickSearch: string; changedFrom: string; changedTo: string; presetId?: string };
}

/** Serves `items` to every list request and records each request body. */
function serveFeed(items: unknown[]): ListRequestBody[] {
  const listRequests: ListRequestBody[] = [];
  global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
    if (url === '/api/changes/explorer/query') {
      listRequests.push(JSON.parse(String(init?.body ?? '{}')));
      return Promise.resolve(
        jsonResponse({ items, totalItems: items.length, summary: { total: items.length, updates: 0, inserts: 0, deletes: 0 }, hasMore: false })
      );
    }
    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  }) as any;
  return listRequests;
}

function entryWith(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return { ...makeEntry(500, 'trees'), ...overrides };
}

function single(entry: ChangelogEntry) {
  return { type: 'single' as const, entry };
}

describe('RecentChangesExplorer: change identity and attribution (#592 D7)', () => {
  beforeEach(() => {
    selection.plotID = FIRST_PLOT_ID;
  });

  it('shows #ChangeID on a card', async () => {
    serveFeed([single(makeEntry(4821, 'trees'))]);
    render(<RecentChangesExplorer />);
    expect(await screen.findByText('#4821')).toBeInTheDocument();
  });

  it('renders a change with no recorded user as "unknown" instead of crashing the page', async () => {
    serveFeed([single(entryWith({ changeID: 77, changedBy: null }))]);
    render(<RecentChangesExplorer />);
    expect(await screen.findByText(/^unknown ·/)).toBeInTheDocument();
  });
});

describe('RecentChangesExplorer: records inside cards (#592 §8.5)', () => {
  beforeEach(() => {
    selection.plotID = FIRST_PLOT_ID;
  });

  it('renders a one-record UPDATE exactly as before: one diff, no key label, no caption', async () => {
    const singleRecord = { primaryKey: UNRENDERED_PRIMARY_KEY, oldState: { MeasuredDBH: 10 }, newState: { MeasuredDBH: 12 } };
    serveFeed([single(entryWith({ tableName: 'coremeasurements', records: [singleRecord] }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText('MeasuredDBH')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('Details')).toHaveLength(1);
    expect(screen.queryByText(UNRENDERED_PRIMARY_KEY_PATTERN), 'a one-record change shows no primary-key label').not.toBeInTheDocument();
    expect(screen.queryByText(/were not recorded/)).not.toBeInTheDocument();
  });

  it.each([
    { operation: 'INSERT' as const, sign: '+', imageSide: 'newState' as const },
    { operation: 'DELETE' as const, sign: '-', imageSide: 'oldState' as const }
  ])('renders a one-record $operation as its single line with no key label', async ({ operation, sign, imageSide }) => {
    const image = { SpeciesCode: 'aaaaaa' };
    const record = { primaryKey: UNRENDERED_PRIMARY_KEY, oldState: null, newState: null, [imageSide]: image };
    serveFeed([single(entryWith({ tableName: 'species', operation, oldRowState: null, newRowState: null, records: [record] }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText(`${sign} SpeciesCode: aaaaaa`)).toBeInTheDocument();
    expect(screen.queryByText(UNRENDERED_PRIMARY_KEY_PATTERN), 'a one-record change shows no primary-key label').not.toBeInTheDocument();
  });

  it.each([
    { operation: 'INSERT' as const, sign: '+', imageSide: 'newState' as const },
    { operation: 'DELETE' as const, sign: '-', imageSide: 'oldState' as const }
  ])('labels each line of a two-record $operation with its primary key', async ({ operation, sign, imageSide }) => {
    const records = [
      { primaryKey: '2', oldState: null, newState: null, [imageSide]: { SpeciesCode: 'bbbbbb' } },
      { primaryKey: '3', oldState: null, newState: null, [imageSide]: { SpeciesCode: 'cccccc' } }
    ];
    serveFeed([single(entryWith({ tableName: 'species', operation, oldRowState: null, newRowState: null, records }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText(`${sign} 2 · SpeciesCode: bbbbbb`)).toBeInTheDocument();
    expect(screen.getByText(`${sign} 3 · SpeciesCode: cccccc`)).toBeInTheDocument();
  });

  it('renders one labelled block per record of a legacy multi-row change', async () => {
    const records = [
      { primaryKey: '4001', oldState: { TreeID: 4001, SpeciesID: 10 }, newState: { TreeID: 4001, SpeciesID: 20 } },
      { primaryKey: '4002', oldState: { TreeID: 4002, SpeciesID: 10 }, newState: { TreeID: 4002, SpeciesID: 30 } }
    ];
    serveFeed([single(entryWith({ recordID: '4001|4002', oldRowState: null, newRowState: null, records }))]);
    render(<RecentChangesExplorer />);

    await waitFor(() => expect(screen.getAllByText('Details')).toHaveLength(records.length));
    expect(screen.getByText('4001'), 'primary key of the first record').toBeInTheDocument();
    expect(screen.getByText('4002'), 'primary key of the second record').toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.queryByText('No visible changes')).not.toBeInTheDocument();
  });

  it('says the row images were not recorded when a change has no record', async () => {
    serveFeed([
      single(entryWith({ changeID: 11, operation: 'UPDATE', oldRowState: null, newRowState: null, records: [] })),
      single(entryWith({ changeID: 12, operation: 'INSERT', oldRowState: null, newRowState: null, records: [] })),
      single(entryWith({ changeID: 13, operation: 'DELETE', oldRowState: null, newRowState: null, records: [] }))
    ]);
    render(<RecentChangesExplorer />);

    await waitFor(() => expect(screen.getAllByText('Row images were not recorded for this change')).toHaveLength(3));
    for (const replacedText of ['No visible changes', '+ New row', '- Removed row']) {
      expect(screen.queryByText(replacedText), `"${replacedText}" must not stand in for missing images`).not.toBeInTheDocument();
    }
  });

  it('captions a one-sided UPDATE record with the side that is missing, and a two-sided one with nothing (D12)', async () => {
    serveFeed([
      single(
        entryWith({
          changeID: 21,
          oldRowState: null,
          newRowState: { SpeciesCode: 'abcdsp' },
          records: [{ primaryKey: '9', oldState: null, newState: { SpeciesCode: 'abcdsp' } }]
        })
      ),
      single(
        entryWith({
          changeID: 22,
          oldRowState: { TreeTag: 'T8' },
          newRowState: null,
          records: [{ primaryKey: '8', oldState: { TreeTag: 'T8' }, newState: null }]
        })
      ),
      single(makeEntry(23, 'coremeasurements'))
    ]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText('Prior values were not recorded')).toBeInTheDocument();
    expect(screen.getByText('New values were not recorded')).toBeInTheDocument();
    expect(screen.getAllByText(/values were not recorded$/), 'the two-sided record gets no caption').toHaveLength(2);
    expect(screen.getByText('abcdsp'), 'the one-sided record keeps its NULL → value line').toBeInTheDocument();
  });

  it('says no field values were recorded for a one-sided record with no visible field', async () => {
    const records = [{ primaryKey: '7003', oldState: null, newState: { UpdatedAt: '2026-03-10 14:00:00' } }];
    serveFeed([single(entryWith({ changeID: 31, oldRowState: null, newRowState: records[0].newState, records }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText('Prior values were not recorded')).toBeInTheDocument();
    expect(screen.getByText('No field values were recorded')).toBeInTheDocument();
    expect(screen.queryByText('No visible changes'), 'this record has a * row in the CSV, unlike a no-difference update').not.toBeInTheDocument();
  });

  it('renders both unpaired records of a legacy attributes UPDATE that flips IsActive as one-sided blocks (D14)', async () => {
    const decoded = decodeChangelogRow({
      tableName: 'attributes',
      recordID: 'A',
      oldRowState: [{ Code: 'A', IsActive: 1, Description: 'alive' }],
      newRowState: [{ Code: 'A', IsActive: 0, Description: 'alive' }]
    });
    expect(decoded.records, 'the key is (Code, IsActive), so a flip must not pair').toHaveLength(2);
    serveFeed([single(entryWith({ changeID: 51, tableName: 'attributes', recordID: 'A', oldRowState: null, newRowState: null, records: decoded.records }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText('Prior values were not recorded')).toBeInTheDocument();
    expect(screen.getByText('New values were not recorded')).toBeInTheDocument();
    expect(screen.getAllByText('Details'), 'each unpaired record shows its recorded values').toHaveLength(decoded.records.length);
    expect(screen.queryByText('No visible changes')).not.toBeInTheDocument();
    expect(screen.queryByText('No field values were recorded')).not.toBeInTheDocument();
  });

  it('shows a changed CensusID in the diff (D8)', async () => {
    const records = [{ primaryKey: '12', oldState: { QuadratID: 12, CensusID: 5 }, newState: { QuadratID: 12, CensusID: 6 } }];
    serveFeed([single(entryWith({ tableName: 'quadrats', oldRowState: records[0].oldState, newRowState: records[0].newState, records }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText('CensusID')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('lists one line per record in an expanded batch, each with its #ChangeID', async () => {
    const insertEntry = (changeID: number, records: ChangelogEntry['records']): ChangelogEntry =>
      entryWith({
        changeID,
        tableName: 'species',
        operation: 'INSERT',
        oldRowState: null,
        newRowState: records.length === 1 ? records[0].newState : null,
        records
      });
    const entries = [
      insertEntry(41, [{ primaryKey: '1', oldState: null, newState: { SpeciesCode: 'aaaaaa' } }]),
      insertEntry(42, [
        { primaryKey: '2', oldState: null, newState: { SpeciesCode: 'bbbbbb' } },
        { primaryKey: '3', oldState: null, newState: { SpeciesCode: 'cccccc' } }
      ]),
      insertEntry(43, [])
    ];
    serveFeed([{ type: 'batch', tableName: 'species', changedBy: 'mason@si.edu', timestamp: '2026-04-10T12:00:00.000Z', count: entries.length, entries }]);
    const user = userEvent.setup();
    render(<RecentChangesExplorer />);

    await user.click(await screen.findByRole('button', { name: 'Show uploaded records' }));

    expect(screen.getByText('#41 + SpeciesCode: aaaaaa')).toBeInTheDocument();
    expect(screen.getByText('#42 + SpeciesCode: bbbbbb')).toBeInTheDocument();
    expect(screen.getByText('#42 + SpeciesCode: cccccc')).toBeInTheDocument();
    expect(screen.getByText("#43 — row added, but the older change log didn't save its values")).toBeInTheDocument();
    expect(screen.queryByText('+ New row')).not.toBeInTheDocument();
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
