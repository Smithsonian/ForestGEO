import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mutate, SWRConfig } from 'swr';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import MapperFactory from '@/config/datamapper';
import { ROW_UPDATED_MESSAGE } from '@/components/datagrids/rowmutationmessages';
import { GRID_REFRESH_FAILED_MESSAGE } from '@/components/datagrids/isolateddatagridcommons';
import IsolatedFailedMeasurementsDataGrid from './isolatedfailedmeasurementsdatagrid';

// Issue #514: after a save that promotes one failed row, the Fix Failed Rows grid must
// show exactly the rows the server still lists. A row keyed by its page index (GenericMapper
// assigns id = index + 1 to a row without one) hands its id to a different row once the
// refetched set drops the promoted row. Only fetch is faked; the grid, SWR cache, mapper
// and invalidation fan-out are the real ones the modal runs with in the app.

const mocks = vi.hoisted(() => {
  // The commons grid reads this flag at module evaluation time; keeping every column
  // mounted makes the real MUI cells queryable under jsdom.
  const originalE2ETesting = process.env.NEXT_PUBLIC_E2E_TESTING;
  process.env.NEXT_PUBLIC_E2E_TESTING = 'true';
  return { triggerRefresh: vi.fn(), originalE2ETesting };
});

const PLOT_ID = 48;
const CENSUS_ID = 71;
const VALID_SPECIES_CODE = 'DEMO26';
const INVALID_SPECIES_CODE = 'TYPO26';
const VALID_QUADRAT = '0101';
const VALID_CODE = 'M';
const INVALID_SPECIES_REASON = 'SpCode invalid';
const EDIT_OPERATION_ID = 51401;
const SPECIES_COMBOBOX_INDEX = 2;
const SPECIES_SUGGESTION_WAIT_MS = 5000;
const SAVE_SETTLE_WAIT_MS = 5000;
const STATUS_OK = 200;
const STATUS_INTERNAL_SERVER_ERROR = 500;
const STATUS_NOT_FOUND = 404;

const ENDPOINTS = {
  editPreview: '/api/edits/preview',
  editApply: '/api/edits/apply',
  reingestSingleFailure: '/api/reingestsinglefailure/',
  failedMeasurementsPage: '/api/fixeddata/failedmeasurements/',
  failedMeasurementsFilteredPage: '/api/fixeddatafilter/failedmeasurements/',
  attributes: '/api/fetchall/attributes/',
  trees: '/api/fetchall/trees/',
  stems: '/api/fetchall/stems/',
  quadrats: '/api/fetchall/quadrats/',
  species: '/api/fetchall/species/'
} as const;

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 48, plotName: 'Rehersal' }),
  useOrgCensusContext: () => ({ plotCensusNumber: 3, dateRanges: [{ censusID: 71, startDate: '2020-01-01', endDate: '2020-12-31' }] }),
  useSiteContext: () => ({ schemaName: 'forestgeo_testing', siteName: 'Test Site' }),
  useQuadratContext: () => undefined
}));
vi.mock('@/app/contexts/datavalidityprovider', () => ({ useDataValidityContext: () => ({ triggerRefresh: mocks.triggerRefresh }) }));
vi.mock('@/config/datamapper', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => importOriginal());
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
// Layout-only decorations; the DataGrid itself is the real MUI grid.
vi.mock('@/components/client/datagridelements', () => ({ EditToolbar: () => null }));
vi.mock('@/components/datagrids/customgridpagination', () => ({
  default: () => null,
  DEFAULT_PAGE_SIZE_OPTIONS: [50],
  getPersistedGridPageSize: () => 50
}));
vi.mock('@/components/datagrids/infinitegridscrollbridge', () => ({ default: () => null }));
vi.mock('@/components/loading', () => ({ LoadingBar: () => null, ContentSkeleton: () => <div data-testid="grid-skeleton" /> }));
vi.mock('@/components/errorboundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

// A failed row as the fixeddata route reads it from the database, before mapping.
type StoredFailedRow = Record<string, unknown>;

function storedFailedRow(coreMeasurementID: number, tag: string): StoredFailedRow {
  return {
    FailedMeasurementID: coreMeasurementID,
    PlotID: PLOT_ID,
    CensusID: CENSUS_ID,
    Tag: tag,
    StemTag: '1',
    SpCode: INVALID_SPECIES_CODE,
    Quadrat: VALID_QUADRAT,
    X: 8.5,
    Y: 12.75,
    DBH: 12.34,
    HOM: 1.3,
    Date: '2020-06-15',
    Codes: VALID_CODE,
    Description: `Invalid species code: "${INVALID_SPECIES_CODE}"`,
    OriginalFailureReasons: INVALID_SPECIES_REASON,
    CurrentFailureReasons: INVALID_SPECIES_REASON,
    FailureReasons: INVALID_SPECIES_REASON,
    LastValidatedAt: null
  };
}

const STORED_FAILED_ROWS = [storedFailedRow(91026, 'AGT1013-126'), storedFailedRow(91027, 'AGT1013-127'), storedFailedRow(91028, 'AGT1013-128')];
const ALL_TAGS = STORED_FAILED_ROWS.map(row => String(row.Tag));
const CORE_MEASUREMENT_ID_BY_TAG = new Map(STORED_FAILED_ROWS.map(row => [String(row.Tag), String(row.FailedMeasurementID)]));

function jsonResponse(body: unknown, status = STATUS_OK): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// What app/api/fixeddata answers for the failedmeasurements page: the stored rows mapped
// by the same mapper the route uses, then serialized over the wire.
function failedMeasurementsPage(storedRows: StoredFailedRow[]): Response {
  const output = MapperFactory.getMapper<StoredFailedRow, StoredFailedRow>('failedmeasurements').mapData(storedRows);
  return jsonResponse({ output, totalCount: storedRows.length, finishedQuery: 'SELECT failed rows' });
}

function previewPlan(targetID: number) {
  return {
    dataType: 'failedmeasurements',
    targetID,
    fieldChanges: [{ field: 'spCode', from: INVALID_SPECIES_CODE, to: VALID_SPECIES_CODE }],
    effects: [],
    maxSeverity: 'warn',
    canApply: true,
    planHash: 'plan-hash-514',
    generatedAt: '2026-11-25T00:00:00.000Z'
  };
}

// A server with three failed rows. Reingesting a corrected row promotes it, so every
// later page read lists only the rows that are still failed.
function installFailedRowsServer({ failPageReadsAfterReingest = false }: { failPageReadsAfterReingest?: boolean } = {}) {
  const promotedIDs = new Set<number>();
  let previewTargetID: number | null = null;
  const pageReads: string[][] = [];

  vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(ENDPOINTS.editPreview)) {
      previewTargetID = Number(JSON.parse(String(init?.body)).targetID);
      return jsonResponse(previewPlan(previewTargetID));
    }
    if (url.includes(ENDPOINTS.editApply)) {
      return jsonResponse({
        updatedIDs: { failedmeasurements: previewTargetID },
        applyErrors: [],
        editOperationID: EDIT_OPERATION_ID,
        validationPending: false
      });
    }
    if (url.includes(ENDPOINTS.reingestSingleFailure)) {
      promotedIDs.add(Number(url.split('/').pop()));
      return jsonResponse({ message: 'reingested' });
    }
    if (url.includes(ENDPOINTS.attributes)) return jsonResponse([{ Code: VALID_CODE }]);
    if (url.includes(ENDPOINTS.trees)) return jsonResponse(ALL_TAGS.map(tag => ({ TreeTag: tag })));
    if (url.includes(ENDPOINTS.stems)) return jsonResponse([{ StemTag: '1' }]);
    if (url.includes(ENDPOINTS.quadrats)) return jsonResponse([{ QuadratName: VALID_QUADRAT }]);
    if (url.includes(ENDPOINTS.species)) return jsonResponse([{ SpeciesCode: VALID_SPECIES_CODE }]);
    if (url.includes(ENDPOINTS.failedMeasurementsPage) || url.includes(ENDPOINTS.failedMeasurementsFilteredPage)) {
      if (failPageReadsAfterReingest && promotedIDs.size > 0) {
        pageReads.push([`HTTP ${STATUS_INTERNAL_SERVER_ERROR}`]);
        return jsonResponse({ error: 'Failed to retrieve data' }, STATUS_INTERNAL_SERVER_ERROR);
      }
      const stillFailed = STORED_FAILED_ROWS.filter(row => !promotedIDs.has(Number(row.FailedMeasurementID)));
      pageReads.push(stillFailed.map(row => String(row.Tag)));
      return failedMeasurementsPage(stillFailed);
    }
    return jsonResponse({ message: `Unexpected network request: ${method} ${url}` }, STATUS_NOT_FOUND);
  });

  return { promotedIDs, pageReads };
}

function renderFixFailedRowsGrid() {
  // No SWR provider of its own: the app's grid shares SWR's default cache with
  // invalidateAfter's global mutate, and that shared cache is part of what is under test.
  render(
    <SWRConfig value={{ revalidateOnFocus: false, dedupingInterval: 0 }}>
      <LocalizationProvider dateAdapter={AdapterMoment}>
        <div style={{ width: 4200, height: 720 }}>
          <IsolatedFailedMeasurementsDataGrid />
        </div>
      </LocalizationProvider>
    </SWRConfig>
  );
}

function rowForTag(tag: string): HTMLElement {
  return screen.getByRole('row', { name: new RegExp(tag) });
}

interface RenderedFailedRow {
  rowID: string | null;
  tag: string;
  spCode: string;
  currentFailureReasons: string;
}

function renderedFailedRows(): RenderedFailedRow[] {
  return Array.from(document.querySelectorAll('[role="row"][data-id]'), row => ({
    rowID: row.getAttribute('data-id'),
    tag: row.querySelector('[data-field="tag"]')?.textContent ?? '',
    spCode: row.querySelector('[data-field="spCode"]')?.textContent ?? '',
    currentFailureReasons: row.querySelector('[data-field="currentFailureReasons"]')?.textContent ?? ''
  }));
}

async function correctSpeciesAndSave(user: ReturnType<typeof userEvent.setup>, tag: string) {
  const row = rowForTag(tag);
  await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
  await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(SPECIES_COMBOBOX_INDEX));
  const speciesInput = within(row).getAllByRole('combobox')[SPECIES_COMBOBOX_INDEX] as HTMLInputElement;
  await user.click(speciesInput);
  await user.clear(speciesInput);
  await user.type(speciesInput, VALID_SPECIES_CODE);
  await waitFor(() => expect(screen.getByRole('option', { name: VALID_SPECIES_CODE })).toBeInTheDocument(), { timeout: SPECIES_SUGGESTION_WAIT_MS });
  await user.click(screen.getByRole('option', { name: VALID_SPECIES_CODE }));
  await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
  await user.click(await screen.findByRole('button', { name: 'Save Changes' }));
  await user.click(await screen.findByTestId('edit-preview-apply'));
}

const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalBoundingRectDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof TestResizeObserver }).ResizeObserver = TestResizeObserver;
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  HTMLElement.prototype.getBoundingClientRect = function () {
    const width = Number.parseFloat(this.style.width) || 5000;
    const height = Number.parseFloat(this.style.height) || 600;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };
});

afterAll(() => {
  const restoreDescriptor = (target: object, property: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else delete (target as Record<string, unknown>)[property];
  };
  restoreDescriptor(globalThis, 'ResizeObserver', originalResizeObserverDescriptor);
  restoreDescriptor(HTMLElement.prototype, 'getBoundingClientRect', originalBoundingRectDescriptor);
  restoreDescriptor(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
  if (mocks.originalE2ETesting === undefined) delete process.env.NEXT_PUBLIC_E2E_TESTING;
  else process.env.NEXT_PUBLIC_E2E_TESTING = mocks.originalE2ETesting;
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  // Each test starts from a server with three failed rows; drop the shared cache's copy.
  await mutate(() => true, undefined, { revalidate: false });
});

describe('Fix Failed Rows after a save promotes a row (#514)', () => {
  it.each([
    { promotedTag: 'AGT1013-126', position: 'first' },
    { promotedTag: 'AGT1013-127', position: 'middle' }
  ])('shows only the still-failed rows once the $position row ($promotedTag) is corrected and promoted', async ({ promotedTag }) => {
    const server = installFailedRowsServer();
    renderFixFailedRowsGrid();
    const user = userEvent.setup();
    await waitFor(() => expect(renderedFailedRows().map(row => row.tag)).toEqual(ALL_TAGS));
    console.log('[#514 fix failed rows] before save', JSON.stringify(renderedFailedRows()));

    await correctSpeciesAndSave(user, promotedTag);
    await waitFor(() => expect(screen.getByText(ROW_UPDATED_MESSAGE)).toBeInTheDocument(), { timeout: SAVE_SETTLE_WAIT_MS });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

    const stillFailedTags = ALL_TAGS.filter(tag => tag !== promotedTag);
    const renderedAfterSave = renderedFailedRows();
    console.log(
      '[#514 fix failed rows] after save',
      JSON.stringify({ promotedIDs: Array.from(server.promotedIDs), pageReads: server.pageReads, rendered: renderedAfterSave })
    );
    expect(server.pageReads.at(-1), 'the server no longer lists the promoted row').toEqual(stillFailedTags);
    expect(
      renderedAfterSave.map(row => row.tag),
      'the grid lists exactly the rows the server still lists'
    ).toEqual(stillFailedTags);
    for (const row of renderedAfterSave) {
      expect(row.spCode, `${row.tag} still shows its uncorrected species`).toContain(INVALID_SPECIES_CODE);
      expect(row.spCode, `${row.tag} is not showing the promoted row's corrected species`).not.toContain(VALID_SPECIES_CODE);
      expect(row.currentFailureReasons, `${row.tag} still shows its failure reason`).toBe(INVALID_SPECIES_REASON);
    }
    expect(
      renderedAfterSave.map(row => row.rowID),
      'each row is keyed by its CoreMeasurementID, not by its position on the page'
    ).toEqual(stillFailedTags.map(tag => CORE_MEASUREMENT_ID_BY_TAG.get(tag)));
  });

  it('keeps the saved row and reports the failed refresh, instead of restoring the stale cached page, when the reread after the save fails', async () => {
    const promotedTag = ALL_TAGS[0];
    const server = installFailedRowsServer({ failPageReadsAfterReingest: true });
    renderFixFailedRowsGrid();
    const user = userEvent.setup();
    await waitFor(() => expect(renderedFailedRows().map(row => row.tag)).toEqual(ALL_TAGS));

    await correctSpeciesAndSave(user, promotedTag);
    const refreshFailedNotice = `Changes were saved, but ${GRID_REFRESH_FAILED_MESSAGE.toLowerCase()}`;
    await waitFor(() => expect(screen.getByText(new RegExp(refreshFailedNotice))).toBeInTheDocument(), { timeout: SAVE_SETTLE_WAIT_MS });

    const renderedAfterSave = renderedFailedRows();
    console.log('[#514 fix failed rows] reread failed', JSON.stringify({ pageReads: server.pageReads, rendered: renderedAfterSave }));
    expect(screen.queryByText(ROW_UPDATED_MESSAGE), 'a save whose reread failed is not reported as a clean success').not.toBeInTheDocument();
    const savedRow = renderedAfterSave.find(row => row.rowID === CORE_MEASUREMENT_ID_BY_TAG.get(promotedTag));
    expect(savedRow, `the saved row ${promotedTag} is still listed`).toBeDefined();
    expect(savedRow?.spCode, 'the saved row shows the species it was saved with, not the cached pre-save value').toContain(VALID_SPECIES_CODE);
  });
});
