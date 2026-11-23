import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecentChangesExplorer, { summarizeChange } from './recentchangesexplorer';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';
import { CHANGE_DATE_ZONE_LABEL, CHANGE_EXPORT_ERROR_CODES, type ChangelogEntry } from '@/config/recentchangesexplorer';
import { HTTPResponses } from '@/config/macros';
import { decodeChangelogRow } from '@/config/changelogdecode';
import { CHANGE_EXPORT_FAILURE_MESSAGES } from '@/lib/changes/explorertransport';
import { CHANGE_QUICK_SEARCH_MAX_LENGTH, EARLIEST_FILTER_DATE_YEAR, LATEST_FILTER_DATE_YEAR } from '@/lib/changes/explorerrequest';

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

function totalChangesCount(): string {
  return screen.getByText('Total Changes').nextElementSibling?.textContent ?? '';
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

  it.each([
    { recordedSide: 'new', oldState: null, newState: { SpeciesCode: 'AB', Family: null } },
    { recordedSide: 'old', oldState: { SpeciesCode: 'AB', Family: null }, newState: null }
  ])('shows only the recorded fields of a one-sided UPDATE whose $recordedSide image holds a null field', async ({ oldState, newState }) => {
    const records = [{ primaryKey: '9', oldState, newState }];
    serveFeed([single(entryWith({ changeID: 41, oldRowState: oldState, newRowState: newState, records }))]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByText('SpeciesCode')).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument();
    expect(screen.queryByText('Family'), 'a field the image never held has no line').not.toBeInTheDocument();
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

const FROM_LABEL = `From (${CHANGE_DATE_ZONE_LABEL})`;
const TO_LABEL = `To (${CHANGE_DATE_ZONE_LABEL})`;
const FIVE_DIGIT_YEAR_DATE = '20261-11-06';
const UNFILTERABLE_DATE_MESSAGE = `Enter a date between ${EARLIEST_FILTER_DATE_YEAR}-01-01 and ${LATEST_FILTER_DATE_YEAR}-12-31.`;

describe('RecentChangesExplorer: date range (#592 §8.2, D9)', () => {
  beforeEach(() => {
    selection.plotID = FIRST_PLOT_ID;
  });

  it('labels the date inputs with the zone the server compares in', async () => {
    serveFeed([]);
    render(<RecentChangesExplorer />);

    expect(await screen.findByLabelText('From (UTC)')).toBeInTheDocument();
    expect(screen.getByLabelText('To (UTC)')).toBeInTheDocument();
  });

  it('sends both dates with the list query', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });

    await waitFor(() => expect(listRequests[listRequests.length - 1].filters).toMatchObject({ changedFrom: '2026-11-01', changedTo: '2026-11-05' }));
    expect(listRequests[listRequests.length - 1].page, 'a date change returns to the first page').toBe(0);
  });

  it('does not query while From is after To, and says why', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));

    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    await waitFor(() => expect(listRequests).toHaveLength(2));

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-06' } });
    expect(await screen.findByText('From must be on or before To.')).toBeInTheDocument();
    expect(listRequests, 'no request for an inverted range').toHaveLength(2);

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-04' } });
    await waitFor(() => expect(listRequests).toHaveLength(3));
    expect(screen.queryByText('From must be on or before To.')).not.toBeInTheDocument();
    expect(listRequests[2].filters).toMatchObject({ changedFrom: '2026-11-04', changedTo: '2026-11-05' });
  });

  it('marks both date inputs invalid and described by the message while the range is inverted', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));
    const fromInput = screen.getByLabelText(FROM_LABEL);
    const toInput = screen.getByLabelText(TO_LABEL);
    expect(fromInput).toHaveAttribute('aria-invalid', 'false');
    expect(toInput).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(toInput, { target: { value: '2026-11-05' } });
    fireEvent.change(fromInput, { target: { value: '2026-11-06' } });
    await screen.findByText('From must be on or before To.');

    expect(fromInput).toHaveAttribute('aria-invalid', 'true');
    expect(toInput).toHaveAttribute('aria-invalid', 'true');
    expect(fromInput).toHaveAccessibleDescription('From must be on or before To.');
    expect(toInput).toHaveAccessibleDescription('From must be on or before To.');

    fireEvent.change(fromInput, { target: { value: '2026-11-04' } });
    await waitFor(() => expect(fromInput).toHaveAttribute('aria-invalid', 'false'));
    expect(toInput).toHaveAttribute('aria-invalid', 'false');
    expect(fromInput).not.toHaveAttribute('aria-describedby');
  });

  it('refuses a typed year the request contract rejects, says so on that input, and sends one request once it is corrected', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));
    const toInput = screen.getByLabelText(TO_LABEL);

    fireEvent.change(toInput, { target: { value: FIVE_DIGIT_YEAR_DATE } });

    expect(await screen.findByText(UNFILTERABLE_DATE_MESSAGE)).toBeInTheDocument();
    expect(listRequests, `no list request for To = ${FIVE_DIGIT_YEAR_DATE}`).toHaveLength(1);
    expect(toInput).toHaveAttribute('aria-invalid', 'true');
    expect(toInput).toHaveAccessibleDescription(UNFILTERABLE_DATE_MESSAGE);
    expect(screen.getByLabelText(FROM_LABEL), 'only the offending input is flagged').toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert'), 'no "Query request failed: 400" alert').not.toBeInTheDocument();

    fireEvent.change(toInput, { target: { value: '2026-11-06' } });

    await waitFor(() => expect(listRequests).toHaveLength(2));
    expect(listRequests[1].filters).toMatchObject({ changedTo: '2026-11-06' });
    expect(screen.queryByText(UNFILTERABLE_DATE_MESSAGE)).not.toBeInTheDocument();
    expect(toInput).toHaveAttribute('aria-invalid', 'false');
  });

  it('flags a From the contract rejects on the From input and does not call it an inverted range', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));
    const fromInput = screen.getByLabelText(FROM_LABEL);
    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    await waitFor(() => expect(listRequests).toHaveLength(2));

    fireEvent.change(fromInput, { target: { value: FIVE_DIGIT_YEAR_DATE } });

    expect(await screen.findByText(UNFILTERABLE_DATE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('From must be on or before To.'), 'a five-digit year sorts before 2026 as a string').not.toBeInTheDocument();
    expect(listRequests).toHaveLength(2);
    expect(fromInput).toHaveAttribute('aria-invalid', 'true');
    expect(fromInput).toHaveAccessibleDescription(UNFILTERABLE_DATE_MESSAGE);
    expect(screen.getByLabelText(TO_LABEL)).toHaveAttribute('aria-invalid', 'false');
  });

  it('hints the accepted years on both date inputs', async () => {
    serveFeed([]);
    render(<RecentChangesExplorer />);

    for (const label of [FROM_LABEL, TO_LABEL]) {
      const input = await screen.findByLabelText(label);
      expect(input, `${label} min`).toHaveAttribute('min', `${EARLIEST_FILTER_DATE_YEAR}-01-01`);
      expect(input, `${label} max`).toHaveAttribute('max', `${LATEST_FILTER_DATE_YEAR}-12-31`);
    }
  });

  describe('when the scope moves while the dates keep the list from loading (#592 C3)', () => {
    const PLOT_ONE_TABLE = 'plot_one_table';
    const PLOT_ONE_TOTAL = 7;
    const INVERTED_FROM = '2026-11-06';
    const INVERTED_TO = '2026-11-05';
    const PLOT_ONE_QUERY_ERROR = `Query request failed: ${HTTPResponses.INTERNAL_SERVER_ERROR}`;

    function servePlotOneFeed(): { listRequests: ListRequestBody[] } {
      const listRequests: ListRequestBody[] = [];
      global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
        if (url === '/api/changes/explorer/query') {
          listRequests.push(JSON.parse(String(init?.body ?? '{}')));
          return Promise.resolve(
            jsonResponse({
              items: [{ type: 'single', entry: makeEntry(1, PLOT_ONE_TABLE) }],
              totalItems: PLOT_ONE_TOTAL,
              summary: { total: PLOT_ONE_TOTAL, updates: PLOT_ONE_TOTAL, inserts: 0, deletes: 0 },
              hasMore: true
            })
          );
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }) as any;
      return { listRequests };
    }

    async function loadPlotOneThenInvertRange() {
      const { listRequests } = servePlotOneFeed();
      const rendered = render(<RecentChangesExplorer />);
      await screen.findByText(PLOT_ONE_TABLE);
      expect(totalChangesCount()).toBe(String(PLOT_ONE_TOTAL));
      fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: INVERTED_TO } });
      await waitFor(() => expect(listRequests).toHaveLength(2));
      fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: INVERTED_FROM } });
      await screen.findByText('From must be on or before To.');
      return { ...rendered, listRequests };
    }

    it('clears the previous plot results when the plot changes under an inverted range, and sends no request', async () => {
      const { rerender, listRequests } = await loadPlotOneThenInvertRange();
      const requestsBeforeSwitch = listRequests.length;

      selection.plotID = SECOND_PLOT_ID;
      rerender(<RecentChangesExplorer />);

      await waitFor(() => expect(screen.queryByText(PLOT_ONE_TABLE), 'plot 1 card must not stay under plot 2').not.toBeInTheDocument());
      expect(totalChangesCount(), 'plot 1 total must not stay under plot 2').toBe('0');
      expect(screen.queryByRole('button', { name: 'Load more changes' }), 'Load more would page plot 2 under an inverted range').not.toBeInTheDocument();
      expect(listRequests, `list requests sent while the range is inverted: ${JSON.stringify(listRequests)}`).toHaveLength(requestsBeforeSwitch);
    });

    it('clears the previous plot results when the plot changes under an unfilterable date', async () => {
      const { listRequests } = servePlotOneFeed();
      const { rerender } = render(<RecentChangesExplorer />);
      await screen.findByText(PLOT_ONE_TABLE);
      fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: FIVE_DIGIT_YEAR_DATE } });
      await screen.findByText(UNFILTERABLE_DATE_MESSAGE);

      selection.plotID = SECOND_PLOT_ID;
      rerender(<RecentChangesExplorer />);

      await waitFor(() => expect(screen.queryByText(PLOT_ONE_TABLE)).not.toBeInTheDocument());
      expect(totalChangesCount()).toBe('0');
      expect(listRequests).toHaveLength(1);
    });

    it('clears the error of a plot whose list never loaded when the plot changes under an inverted range, and sends no request', async () => {
      const listRequests: ListRequestBody[] = [];
      global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
        if (url === '/api/changes/explorer/query') {
          listRequests.push(JSON.parse(String(init?.body ?? '{}')));
          return Promise.resolve({ ok: false, status: HTTPResponses.INTERNAL_SERVER_ERROR, json: async () => ({}) });
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }) as unknown as typeof fetch;
      const { rerender } = render(<RecentChangesExplorer />);
      await screen.findByText(PLOT_ONE_QUERY_ERROR);
      fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: INVERTED_TO } });
      await waitFor(() => expect(listRequests).toHaveLength(2));
      fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: INVERTED_FROM } });
      await screen.findByText('From must be on or before To.');
      const requestsBeforeSwitch = listRequests.length;

      selection.plotID = SECOND_PLOT_ID;
      rerender(<RecentChangesExplorer />);

      await waitFor(() => expect(screen.queryByText(PLOT_ONE_QUERY_ERROR), 'plot 1 error must not stay under plot 2').not.toBeInTheDocument());
      expect(listRequests, `list requests sent while the range is inverted: ${JSON.stringify(listRequests)}`).toHaveLength(requestsBeforeSwitch);
    });

    describe('a failed list query', () => {
      async function failPlotOneListThenInvertRange() {
        const listRequests: ListRequestBody[] = [];
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
          if (url === '/api/changes/explorer/query') {
            listRequests.push(JSON.parse(String(init?.body ?? '{}')));
            return Promise.resolve({ ok: false, status: HTTPResponses.INTERNAL_SERVER_ERROR, json: async () => ({}) });
          }
          return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
        }) as unknown as typeof fetch;
        const rendered = render(<RecentChangesExplorer />);
        await screen.findByText(PLOT_ONE_QUERY_ERROR);
        fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: INVERTED_TO } });
        await waitFor(() => expect(listRequests).toHaveLength(2));
        await screen.findByText(PLOT_ONE_QUERY_ERROR);
        fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: INVERTED_FROM } });
        await screen.findByText('From must be on or before To.');
        return { ...rendered, listRequests };
      }

      it('keeps its alert when the dates are inverted on the same plot, and does not claim there are no changes', async () => {
        const { listRequests } = await failPlotOneListThenInvertRange();

        expect(
          screen.getByText(PLOT_ONE_QUERY_ERROR),
          'the failure of this plot is still the truth until the plot changes or a query succeeds'
        ).toBeInTheDocument();
        expect(screen.queryByText('No changes found'), 'a failed query is not an empty result').not.toBeInTheDocument();
        expect(listRequests, 'an inverted range sends nothing').toHaveLength(2);
      });

      it('clears its alert once the plot changes', async () => {
        const { rerender } = await failPlotOneListThenInvertRange();

        selection.plotID = SECOND_PLOT_ID;
        rerender(<RecentChangesExplorer />);

        await waitFor(() => expect(screen.queryByText(PLOT_ONE_QUERY_ERROR), 'plot 1 error must not stay under plot 2').not.toBeInTheDocument());
      });

      it('shows no empty-state message while the alert is on screen', async () => {
        const listRequests: ListRequestBody[] = [];
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
          if (url === '/api/changes/explorer/query') {
            listRequests.push(JSON.parse(String(init?.body ?? '{}')));
            return Promise.resolve({ ok: false, status: HTTPResponses.INTERNAL_SERVER_ERROR, json: async () => ({}) });
          }
          return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
        }) as unknown as typeof fetch;
        render(<RecentChangesExplorer />);

        await screen.findByText(PLOT_ONE_QUERY_ERROR);

        expect(screen.queryByText('No changes found')).not.toBeInTheDocument();
      });
    });

    it('keeps the list on screen when the range is inverted on the same plot', async () => {
      await loadPlotOneThenInvertRange();

      expect(screen.getByText(PLOT_ONE_TABLE), 'editing dates on the same plot keeps the list').toBeInTheDocument();
      expect(totalChangesCount()).toBe(String(PLOT_ONE_TOTAL));
      expect(screen.getByRole('button', { name: 'Load more changes' })).toBeInTheDocument();
    });
  });

  it('drops the in-flight response and clears loading when the range becomes inverted', async () => {
    const inFlightResponses: Deferred<ReturnType<typeof jsonResponse>>[] = [];
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
      if (url === '/api/changes/explorer/query') {
        const response = deferred<ReturnType<typeof jsonResponse>>();
        inFlightResponses.push(response);
        init?.signal?.addEventListener('abort', () => response.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        return response.promise;
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as unknown as typeof fetch;
    const lateResponse = {
      items: [{ type: 'single' as const, entry: makeEntry(9, 'late_table') }],
      totalItems: 1,
      summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
      hasMore: false
    };
    const { container } = render(<RecentChangesExplorer />);
    await waitFor(() => expect(inFlightResponses).toHaveLength(1));
    const totalBeforeLateResponse = totalChangesCount();

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-06' } });
    await waitFor(() => expect(inFlightResponses).toHaveLength(2));
    expect(container.querySelectorAll('.MuiSkeleton-root').length, 'the valid range is loading').toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    await screen.findByText('From must be on or before To.');
    await act(async () => {
      inFlightResponses[1].resolve(jsonResponse(lateResponse));
      await Promise.resolve();
    });

    expect(inFlightResponses, 'no request for the inverted range').toHaveLength(2);
    expect(screen.queryByText('late_table'), 'the response sent before the range was inverted must not render').not.toBeInTheDocument();
    expect(totalChangesCount(), 'the late response must not update Total Changes either').toBe(totalBeforeLateResponse);
    expect(container.querySelectorAll('.MuiSkeleton-root'), 'loading clears once the request is aborted').toHaveLength(0);
  });

  it('ignores a response that arrives after the range became inverted even when the request was never rejected', async () => {
    const inFlightResponses: Deferred<ReturnType<typeof jsonResponse>>[] = [];
    const abortedRequestIndexes: number[] = [];
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
      if (url === '/api/changes/explorer/query') {
        const response = deferred<ReturnType<typeof jsonResponse>>();
        const requestIndex = inFlightResponses.push(response) - 1;
        init?.signal?.addEventListener('abort', () => abortedRequestIndexes.push(requestIndex));
        return response.promise;
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as unknown as typeof fetch;
    const lateResponse = {
      items: [{ type: 'single' as const, entry: makeEntry(9, 'late_table') }],
      totalItems: 1,
      summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
      hasMore: false
    };
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(inFlightResponses).toHaveLength(1));
    const totalBeforeLateResponse = totalChangesCount();
    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-06' } });
    await waitFor(() => expect(inFlightResponses).toHaveLength(2));

    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    await screen.findByText('From must be on or before To.');
    expect(abortedRequestIndexes, 'the request sent for the valid range is aborted when the range turns invalid').toContain(1);
    await act(async () => {
      inFlightResponses[1].resolve(jsonResponse(lateResponse));
      await Promise.resolve();
    });

    expect(screen.queryByText('late_table'), 'a response to an aborted request must not render, whether or not the transport rejected').not.toBeInTheDocument();
    expect(totalChangesCount(), 'the late response must not update Total Changes either').toBe(totalBeforeLateResponse);
  });

  it('keeps both dates and resets the other filters when a preset is clicked', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'TREE-7' } });
    await waitFor(() => expect(listRequests[listRequests.length - 1].filters.quickSearch).toBe('TREE-7'));

    // "Deletions" also labels a summary card, so the chip is found inside the filter panel. Enter activates a preset chip.
    const filterPanel = screen.getByLabelText('Quick Search').closest('.MuiSheet-root') as HTMLElement;
    const deletionsChip = within(filterPanel).getByText('Deletions').closest('[role="button"]') as HTMLElement;
    fireEvent.keyDown(deletionsChip, { key: 'Enter' });

    await waitFor(() => expect(listRequests[listRequests.length - 1].filters.operation).toBe('DELETE'));
    expect(listRequests[listRequests.length - 1].filters).toEqual({
      operation: 'DELETE',
      changedBy: '',
      tableName: '',
      quickSearch: '',
      changedFrom: '2026-11-01',
      changedTo: '2026-11-05',
      presetId: 'deletions'
    });
  });

  it('leaves the highlighted preset alone when only a date changes', async () => {
    const listRequests = serveFeed([]);
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));
    const allChangesChip = screen.getByText('All Changes').closest('.MuiChip-root') as HTMLElement;
    expect(allChangesChip.className).toContain('MuiChip-variantSolid');

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(listRequests).toHaveLength(2));

    expect(allChangesChip.className, 'a preset says nothing about dates').toContain('MuiChip-variantSolid');
  });
});

describe('RecentChangesExplorer: Quick Search length (#592 C4)', () => {
  it('stops accepting text at the length the request contract allows', async () => {
    const listRequests = serveFeed([]);
    const user = userEvent.setup();
    render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests).toHaveLength(1));
    const quickSearch = screen.getByLabelText('Quick Search') as HTMLInputElement;

    await user.click(quickSearch);
    await user.paste('x'.repeat(CHANGE_QUICK_SEARCH_MAX_LENGTH + 1));

    expect(quickSearch.value, 'pasting one character too many keeps the first 500').toHaveLength(CHANGE_QUICK_SEARCH_MAX_LENGTH);
    await waitFor(() => expect(listRequests[listRequests.length - 1].filters.quickSearch).toHaveLength(CHANGE_QUICK_SEARCH_MAX_LENGTH));
  });
});

describe('RecentChangesExplorer: Export CSV (#592 §8.1)', () => {
  const OBJECT_URL = 'blob:recent-changes-test';
  const EXPORT_URL = '/api/changes/explorer/export';
  const SERVER_FILENAME = 'changelog-forestgeo_testing-plot1-2026-11-22.csv';
  const EXPORT_BUTTON_NAME = 'Export CSV';
  const EXPORTING_INDICATOR_LABEL = 'Exporting change log';
  const SERVER_TEXT_THAT_MUST_NOT_BE_SHOWN = 'server text that must not be shown';
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let downloadedFilenames: string[];
  let downloadedHrefs: string[];

  // jsdom's URL has neither method, so they are assigned for the test and put back after it.
  beforeEach(() => {
    selection.plotID = FIRST_PLOT_ID;
    downloadedFilenames = [];
    downloadedHrefs = [];
    URL.createObjectURL = vi.fn(() => OBJECT_URL);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilenames.push(this.download);
      downloadedHrefs.push(this.href);
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  function csvResponse(): Response {
    return new Response('LogID\r\n1', { status: HTTPResponses.OK, headers: { 'Content-Disposition': `attachment; filename="${SERVER_FILENAME}"` } });
  }

  /** Serves an empty feed and answers every export request with `answerExport`, recording the export bodies and signals. */
  function serveExport(answerExport: () => Promise<Response>) {
    const exportBodies: Array<Record<string, unknown>> = [];
    const exportSignals: Array<AbortSignal | null | undefined> = [];
    const listRequests: ListRequestBody[] = [];
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/changes/explorer/facets') return Promise.resolve(jsonResponse(NO_FACETS));
      if (url === '/api/changes/explorer/query') {
        listRequests.push(JSON.parse(String(init?.body ?? '{}')));
        return Promise.resolve(jsonResponse({ items: [], totalItems: 0, summary: { total: 0, updates: 0, inserts: 0, deletes: 0 }, hasMore: false }));
      }
      if (url === EXPORT_URL) {
        exportBodies.push(JSON.parse(String(init?.body ?? '{}')));
        exportSignals.push(init?.signal);
        return answerExport();
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as typeof fetch;
    return { exportBodies, exportSignals, listRequests };
  }

  async function renderAndWaitForFeed(listRequests: ListRequestBody[]) {
    const view = render(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests.length).toBeGreaterThanOrEqual(1));
    return view;
  }

  it('posts the current filters, dates included, shows a loading state, and downloads under the server’s filename', async () => {
    const pendingExport = deferred<Response>();
    const { exportBodies, listRequests } = serveExport(() => pendingExport.promise);
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);

    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'TREE-7' } });
    const exportButton = screen.getByRole('button', { name: EXPORT_BUTTON_NAME });
    await user.click(exportButton);

    await waitFor(() => expect(exportBodies).toHaveLength(1));
    expect(exportBodies[0]).toMatchObject({
      schema: 'forestgeo_testing',
      plotID: FIRST_PLOT_ID,
      filters: { operation: 'all', changedBy: '', tableName: '', quickSearch: 'TREE-7', changedFrom: '2026-11-01', changedTo: '2026-11-05' }
    });
    expect(exportButton, 'the button is busy while the export runs').toBeDisabled();
    expect(downloadedFilenames, 'nothing downloads before the response arrives').toEqual([]);

    await act(async () => {
      pendingExport.resolve(csvResponse());
      await Promise.resolve();
    });

    await waitFor(() => expect(downloadedFilenames).toEqual([SERVER_FILENAME]));
    expect(downloadedHrefs, 'the one clicked link points at exactly the blob built from the response').toEqual([OBJECT_URL]);
    await waitFor(() => expect(exportButton, 'the loading state clears').toBeEnabled());
    expect(URL.revokeObjectURL, 'the object URL is released').toHaveBeenCalledWith(OBJECT_URL);
    expect(screen.queryByTestId('recent-changes-export-alert')).not.toBeInTheDocument();
  });

  it.each([
    {
      label: CHANGE_EXPORT_ERROR_CODES.tooLarge,
      response: () =>
        Response.json({ error: SERVER_TEXT_THAT_MUST_NOT_BE_SHOWN, code: CHANGE_EXPORT_ERROR_CODES.tooLarge }, { status: HTTPResponses.PAYLOAD_TOO_LARGE }),
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge
    },
    {
      label: 'a 403 with no code',
      response: () => Response.json({ error: SERVER_TEXT_THAT_MUST_NOT_BE_SHOWN }, { status: HTTPResponses.FORBIDDEN }),
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.forbidden
    },
    {
      label: 'a 503 with no code',
      response: () => Response.json({ error: SERVER_TEXT_THAT_MUST_NOT_BE_SHOWN }, { status: HTTPResponses.SERVICE_UNAVAILABLE }),
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.unavailable
    },
    {
      label: 'a 500 that is not JSON',
      response: () => new Response('<html>Bad Gateway</html>', { status: HTTPResponses.INTERNAL_SERVER_ERROR }),
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.generic
    }
  ])('shows its own alert for $label and no server text', async ({ response, expected }) => {
    const { listRequests } = serveExport(async () => response());
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);

    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));

    const alert = await screen.findByTestId('recent-changes-export-alert');
    expect(alert).toHaveTextContent(expected);
    expect(alert).not.toHaveTextContent(SERVER_TEXT_THAT_MUST_NOT_BE_SHOWN);
    expect(downloadedFilenames, 'a failed export downloads nothing').toEqual([]);
    expect(screen.getByRole('button', { name: EXPORT_BUTTON_NAME })).toBeEnabled();
  });

  it('keeps the export alert when the list refreshes', async () => {
    const { listRequests } = serveExport(async () => Response.json({ code: CHANGE_EXPORT_ERROR_CODES.tooLarge }, { status: HTTPResponses.PAYLOAD_TOO_LARGE }));
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);
    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await screen.findByTestId('recent-changes-export-alert');
    const listRequestsBefore = listRequests.length;

    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'narrower' } });
    await waitFor(() => expect(listRequests.length).toBeGreaterThan(listRequestsBefore));

    expect(screen.getByTestId('recent-changes-export-alert'), 'a list refresh clears the list error only').toHaveTextContent(
      CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge
    );
  });

  it('shows the generic alert when the request itself fails, with no HTTP status to read', async () => {
    const { listRequests } = serveExport(() => Promise.reject(new TypeError('Failed to fetch')));
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);

    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));

    const alert = await screen.findByTestId('recent-changes-export-alert');
    expect(alert).toHaveTextContent(CHANGE_EXPORT_FAILURE_MESSAGES.generic);
    expect(alert, 'the browser’s own error text is not shown either').not.toHaveTextContent('Failed to fetch');
    expect(downloadedFilenames).toEqual([]);
    expect(screen.getByRole('button', { name: EXPORT_BUTTON_NAME })).toBeEnabled();
  });

  it('clears the previous export alert as soon as a new export starts', async () => {
    const pendingSecondExport = deferred<Response>();
    let exportRequestCount = 0;
    const { exportBodies, listRequests } = serveExport(async () => {
      exportRequestCount += 1;
      if (exportRequestCount === 1) return Response.json({ code: CHANGE_EXPORT_ERROR_CODES.tooLarge }, { status: HTTPResponses.PAYLOAD_TOO_LARGE });
      return pendingSecondExport.promise;
    });
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);
    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await screen.findByTestId('recent-changes-export-alert');

    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await waitFor(() => expect(exportBodies).toHaveLength(2));

    expect(screen.queryByTestId('recent-changes-export-alert'), 'the old failure is gone while the new export is still running').not.toBeInTheDocument();
    await act(async () => {
      pendingSecondExport.resolve(csvResponse());
      await Promise.resolve();
    });
    await waitFor(() => expect(downloadedFilenames).toEqual([SERVER_FILENAME]));
    expect(screen.queryByTestId('recent-changes-export-alert')).not.toBeInTheDocument();
  });

  it('clears the export alert when the plot changes', async () => {
    const { listRequests } = serveExport(async () => Response.json({ code: CHANGE_EXPORT_ERROR_CODES.tooLarge }, { status: HTTPResponses.PAYLOAD_TOO_LARGE }));
    const user = userEvent.setup();
    const { rerender } = await renderAndWaitForFeed(listRequests);
    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await screen.findByTestId('recent-changes-export-alert');

    selection.plotID = SECOND_PLOT_ID;
    rerender(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests[listRequests.length - 1].plotID).toBe(SECOND_PLOT_ID));

    expect(screen.queryByTestId('recent-changes-export-alert'), 'plot 1’s failure must not stay on plot 2').not.toBeInTheDocument();
  });

  it('downloads nothing when the response arrives after the plot changed', async () => {
    const pendingExport = deferred<Response>();
    const { exportBodies, exportSignals, listRequests } = serveExport(() => pendingExport.promise);
    const user = userEvent.setup();
    const { rerender } = await renderAndWaitForFeed(listRequests);

    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await waitFor(() => expect(exportBodies).toHaveLength(1));

    selection.plotID = SECOND_PLOT_ID;
    rerender(<RecentChangesExplorer />);
    await waitFor(() => expect(listRequests[listRequests.length - 1].plotID).toBe(SECOND_PLOT_ID));
    expect(exportSignals[0]?.aborted, 'the export request is aborted when the plot changes').toBe(true);

    await act(async () => {
      pendingExport.resolve(csvResponse());
      await Promise.resolve();
    });

    expect(downloadedFilenames, 'plot 1’s CSV must not download on plot 2').toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }), 'the new plot starts with an idle button').toBeEnabled();
  });

  it('still downloads the original file, with the filters from the click, when Quick Search changes during the export', async () => {
    const pendingExport = deferred<Response>();
    const { exportBodies, exportSignals, listRequests } = serveExport(() => pendingExport.promise);
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);
    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'TREE-7' } });
    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await waitFor(() => expect(exportBodies).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'TREE-8' } });
    await waitFor(() => expect(listRequests[listRequests.length - 1].filters.quickSearch).toBe('TREE-8'));
    expect(exportSignals[0]?.aborted, 'a filter change does not cancel an export').toBe(false);
    await act(async () => {
      pendingExport.resolve(csvResponse());
      await Promise.resolve();
    });

    await waitFor(() => expect(downloadedFilenames).toEqual([SERVER_FILENAME]));
    expect(exportBodies, 'only the click-time request was sent').toHaveLength(1);
    expect(exportBodies[0]).toMatchObject({ filters: { quickSearch: 'TREE-7' } });
  });

  it('aborts the export and downloads nothing when only the site changes and the plot stays the same', async () => {
    const OTHER_SCHEMA_NAME = 'forestgeo_other';
    const originalSchemaName = selection.schemaName;
    const pendingExport = deferred<Response>();
    const { exportBodies, exportSignals, listRequests } = serveExport(() => pendingExport.promise);
    const user = userEvent.setup();
    const { rerender } = await renderAndWaitForFeed(listRequests);
    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await waitFor(() => expect(exportBodies).toHaveLength(1));

    try {
      selection.schemaName = OTHER_SCHEMA_NAME;
      rerender(<RecentChangesExplorer />);
      await waitFor(() => expect(listRequests[listRequests.length - 1]).toMatchObject({ schema: OTHER_SCHEMA_NAME, plotID: FIRST_PLOT_ID }));
      expect(exportSignals[0]?.aborted, 'the export request is aborted when the site changes').toBe(true);

      await act(async () => {
        pendingExport.resolve(csvResponse());
        await Promise.resolve();
      });

      expect(downloadedFilenames, 'the old site’s CSV must not download under the new site').toEqual([]);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    } finally {
      selection.schemaName = originalSchemaName;
    }
  });

  it('aborts the export and downloads nothing when the explorer unmounts', async () => {
    const pendingExport = deferred<Response>();
    const { exportBodies, exportSignals, listRequests } = serveExport(() => pendingExport.promise);
    const user = userEvent.setup();
    const { unmount } = await renderAndWaitForFeed(listRequests);
    await user.click(screen.getByRole('button', { name: EXPORT_BUTTON_NAME }));
    await waitFor(() => expect(exportBodies).toHaveLength(1));

    unmount();
    expect(exportSignals[0]?.aborted, 'leaving the page aborts the export request').toBe(true);

    await act(async () => {
      pendingExport.resolve(csvResponse());
      await Promise.resolve();
    });

    expect(downloadedFilenames, 'an unmounted explorer must not download').toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('announces the export while it runs: aria-busy true and a labelled progress indicator, both gone afterwards', async () => {
    const pendingExport = deferred<Response>();
    const { exportBodies, listRequests } = serveExport(() => pendingExport.promise);
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);
    const exportButton = screen.getByRole('button', { name: EXPORT_BUTTON_NAME });
    expect(exportButton, 'idle before the export starts').toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    await user.click(exportButton);
    await waitFor(() => expect(exportBodies).toHaveLength(1));

    expect(exportButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar', { name: EXPORTING_INDICATOR_LABEL })).toBeInTheDocument();

    await act(async () => {
      pendingExport.resolve(csvResponse());
      await Promise.resolve();
    });

    await waitFor(() => expect(exportButton).toHaveAttribute('aria-busy', 'false'));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('lets a second export supersede the first: the first request is aborted and only one file downloads', async () => {
    const pendingResponses: Array<Deferred<Response>> = [];
    const { exportBodies, exportSignals, listRequests } = serveExport(() => {
      const pending = deferred<Response>();
      pendingResponses.push(pending);
      return pending.promise;
    });
    await renderAndWaitForFeed(listRequests);
    const exportButton = screen.getByRole('button', { name: EXPORT_BUTTON_NAME });

    act(() => {
      exportButton.click();
      exportButton.click();
    });
    await waitFor(() => expect(exportBodies, 'both clicks reached the transport').toHaveLength(2));

    expect(exportSignals[0]?.aborted, 'the first request is superseded').toBe(true);
    expect(exportSignals[1]?.aborted, 'the second request stays live').toBe(false);

    await act(async () => {
      pendingResponses[1].resolve(csvResponse());
      pendingResponses[0].resolve(csvResponse());
      await Promise.resolve();
    });

    await waitFor(() => expect(downloadedFilenames).toEqual([SERVER_FILENAME]));
    expect(URL.createObjectURL, 'the superseded response is never turned into a file').toHaveBeenCalledTimes(1);
    await waitFor(() => expect(exportButton).toBeEnabled());
  });

  it('does not export while From is after To', async () => {
    const { exportBodies, listRequests } = serveExport(async () => csvResponse());
    await renderAndWaitForFeed(listRequests);

    fireEvent.change(screen.getByLabelText(TO_LABEL), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText(FROM_LABEL), { target: { value: '2026-11-06' } });

    expect(await screen.findByText('From must be on or before To.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EXPORT_BUTTON_NAME })).toBeDisabled();
    expect(exportBodies).toEqual([]);
  });

  it.each([
    { label: 'From', controlLabel: FROM_LABEL },
    { label: 'To', controlLabel: TO_LABEL }
  ])('does not export while $label holds a date the request contract rejects, and exports once it is corrected', async ({ controlLabel }) => {
    const { exportBodies, listRequests } = serveExport(async () => csvResponse());
    const user = userEvent.setup();
    await renderAndWaitForFeed(listRequests);
    const dateInput = screen.getByLabelText(controlLabel);

    fireEvent.change(dateInput, { target: { value: FIVE_DIGIT_YEAR_DATE } });

    expect(await screen.findByText(UNFILTERABLE_DATE_MESSAGE)).toBeInTheDocument();
    const exportButton = screen.getByRole('button', { name: EXPORT_BUTTON_NAME });
    expect(exportButton, `Export stays off while ${controlLabel} is ${FIVE_DIGIT_YEAR_DATE}`).toBeDisabled();
    fireEvent.click(exportButton);
    expect(exportBodies, 'a disabled button posts nothing').toEqual([]);

    fireEvent.change(dateInput, { target: { value: '2026-11-06' } });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);
    await waitFor(() => expect(exportBodies).toHaveLength(1));
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
