import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The row-edit flow drives beginEdit/UndoToast through an async chain
// (saveRowThroughGrid -> processRowUpdate -> flow.beginEdit) whose fetches and
// view refreshes are slower under CI load than waitFor's 1000ms default. This
// margin only lengthens the polling window and never affects a passing
// assertion. It is NOT what makes this file's row-edit tests reliable: the
// timeouts this once tried to paper over came from a trigger bound to a stale
// row set, which the grid-capture fixture avoids by always reading the latest props.
configure({ asyncUtilTimeout: 5000 });

import { ERRORS_EXPLORER_DEFAULT_HIDDEN_COLUMNS } from './errorsexplorercolumns';
import { formatErrorComparison, formatOptionalMeasurement, getUploadedCodesValue, hasCodesMismatch, joinCodesArray, parseCodesString } from './errorcodes';
import type { ApplyResult, EditPlan } from '@/config/editplan/types';
import type { UseEditPreviewFlowReturn } from '@/app/hooks/useEditPreviewFlow';
import type { UndoRevertOutcome } from '@/components/editplan/undotoast';
import type { InfiniteScrollPaginationProps } from '@/components/datagrids/customgridpagination';
import { VIEW_ERRORS_TEXT, type ErrorCensusTotals, type ErrorExplorerRow } from '@/config/errorsexplorer';
import { capturedGrids, enterEdit, requireGrid, requireRow, resetCapturedGrids, saveRowThroughGrid } from '@/tests/fixtures/errorsexplorer/grid-capture';
import { facetOf, facetsResponse, installMemoryStorage, jsonResponse, ROUTES } from '@/tests/fixtures/errorsexplorer/explorer-page';
import { UNCONFIRMED_OUTCOME_MESSAGE } from '@/lib/editplan/requestrevert';
import { EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE } from '@/components/datagrids/measurementscommonsutils';
import ailogger from '@/ailogger';

// Typed capture for the outcome UndoToast's onUndo callback resolves to,
// shared with the mocked UndoToast below via vi.hoisted so neither side
// needs an untyped window/globalThis escape hatch. Reset in beforeEach.
const undoOutcomeCapture = vi.hoisted(() => ({
  lastOutcome: undefined as UndoRevertOutcome | undefined
}));

describe('ErrorsExplorer — Codes column helpers', () => {
  describe('parseCodesString', () => {
    it('returns an empty array for undefined', () => {
      expect(parseCodesString(undefined)).toEqual([]);
    });

    it('returns an empty array for the empty string', () => {
      expect(parseCodesString('')).toEqual([]);
    });

    it('parses a single code', () => {
      expect(parseCodesString('D')).toEqual(['D']);
    });

    it('parses multiple semicolon-delimited codes', () => {
      expect(parseCodesString('D;M;A')).toEqual(['D', 'M', 'A']);
    });

    it('parses comma-delimited codes', () => {
      expect(parseCodesString('D,M,A')).toEqual(['D', 'M', 'A']);
    });

    it('trims whitespace around each code segment', () => {
      expect(parseCodesString(' D ; M ')).toEqual(['D', 'M']);
    });

    it('drops empty segments from doubled or trailing semicolons', () => {
      expect(parseCodesString('D;;M;')).toEqual(['D', 'M']);
    });
  });

  describe('joinCodesArray', () => {
    it('joins an array of codes with semicolons', () => {
      expect(joinCodesArray(['D', 'M', 'A'])).toBe('D;M;A');
    });

    it('returns a single code unchanged when only one is selected', () => {
      expect(joinCodesArray(['D'])).toBe('D');
    });

    it('returns the empty string when the array is empty (user cleared codes)', () => {
      expect(joinCodesArray([])).toBe('');
    });

    it('returns the empty string for non-array input (defensive branch)', () => {
      expect(joinCodesArray(null)).toBe('');
      expect(joinCodesArray(undefined)).toBe('');
    });

    it('normalizes whitespace, commas, and duplicate values into the stored semicolon form', () => {
      expect(joinCodesArray(parseCodesString(' D, M ; D '))).toBe('D;M');
    });
  });

  describe('parse/join round-trip', () => {
    it('joining then parsing recovers the original code set', () => {
      const original = ['D', 'M'];
      expect(parseCodesString(joinCodesArray(original))).toEqual(original);
    });

    it('parsing then joining preserves the canonical stored form', () => {
      expect(joinCodesArray(parseCodesString(' D ; M '))).toBe('D;M');
    });
  });

  describe('raw code display helpers', () => {
    it('prefers raw uploaded codes when materialized attributes are empty', () => {
      expect(getUploadedCodesValue({ attributes: '', rawCodes: 'MX,I' })).toBe('MX,I');
    });

    it('does not treat delimiter-only differences as a mismatch', () => {
      expect(hasCodesMismatch({ attributes: 'D;M', rawCodes: 'D,M' })).toBe(false);
    });

    it('flags rows where uploaded codes contain invalid or dropped values', () => {
      expect(hasCodesMismatch({ attributes: 'D', rawCodes: 'D,MX' })).toBe(true);
    });
  });

  describe('formatOptionalMeasurement', () => {
    it('renders null as an empty string rather than "0.00"', () => {
      expect(formatOptionalMeasurement(null)).toBe('');
    });

    it('formats a real measurement to two decimal places', () => {
      expect(formatOptionalMeasurement(12.5)).toBe('12.50');
    });

    it('renders zero as "0.00", not blank — zero is a real measured value', () => {
      expect(formatOptionalMeasurement(0)).toBe('0.00');
    });
  });
});

describe('formatErrorComparison', () => {
  it('keeps prior DBH visible when either HOM value is unavailable', () => {
    expect(formatErrorComparison({ priorCensusID: 4, priorDBH: 10.5, priorHOM: null, homChanged: false }, null)).toBe('Prior census 4: DBH 10.5, HOM —');
  });
});

// ---- ErrorsExplorer row-edit flow integration ---------------------------------------------

const TEST_SCHEMA = 'forestgeo_testing_mason';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 6;
const TEST_SECOND_CENSUS_ID = 7;
const TEST_CORE_MEASUREMENT_ID = 101;
const TEST_EDIT_OPERATION_ID = 555;
const TEST_PLAN_HASH_INITIAL = 'a'.repeat(64);
const TEST_PLAN_HASH_REFRESH = 'b'.repeat(64);
const GROUP_GRID = 'example error rows';
const FLAT_GRID = VIEW_ERRORS_TEXT.flatGridLabel;
const INFINITE_CHUNK_SIZE = 100;

const GRID_ROW: Record<string, unknown> = {
  id: TEST_CORE_MEASUREMENT_ID,
  coreMeasurementID: TEST_CORE_MEASUREMENT_ID,
  plotID: TEST_PLOT_ID,
  censusID: TEST_CENSUS_ID,
  quadratID: 7,
  treeID: 20,
  stemGUID: 300,
  speciesID: 5,
  speciesName: 'Acer rubrum',
  subspeciesName: null,
  speciesCode: 'ACRU',
  treeTag: 'T-1',
  stemTag: 'S-1',
  quadratName: '0101',
  stemLocalX: 1.23,
  stemLocalY: 4.56,
  stemPlotX: 101.23,
  stemPlotY: 204.56,
  measurementDate: '2026-01-01',
  measuredDBH: 10,
  measuredHOM: 1.3,
  isValidated: false,
  description: 'desc',
  attributes: 'L',
  userDefinedFields: null,
  rawCodes: 'L',
  primaryErrorMessage: 'example error',
  errorMessages: ['example error'],
  errorSources: ['validation'],
  errorFields: ['MeasuredDBH'],
  errorCodes: ['VLD-1'],
  errorCount: 1,
  totalErrorCount: 1,
  dbhChangePercent: null,
  hasContradiction: false,
  contradictionTypes: [],
  contradictionType: null,
  contradictionGroupKey: null,
  relatedMeasurementIDs: [],
  isFailedRow: false
};

function makePlan(overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    dataType: 'measurementssummary',
    targetID: TEST_CORE_MEASUREMENT_ID,
    fieldChanges: overrides.fieldChanges ?? [{ field: 'MeasuredDBH', from: 10, to: 12 }],
    effects: overrides.effects ?? [],
    maxSeverity: overrides.maxSeverity ?? 'warn',
    planHash: overrides.planHash ?? TEST_PLAN_HASH_INITIAL,
    generatedAt: '2026-04-20T12:00:00Z'
  };
}

// requestEditRevert (frontend/lib/editplan/requestrevert.ts) only treats a 2xx
// /api/edits/revert body as a successful revert when it satisfies isValidApplyResult
// (a real editOperationID, updatedIDs, applyErrors, validationPending). A bare
// `{ ok: true }` body is not a valid ApplyResult and now resolves to
// 'unconfirmed', so every fixture claiming a successful revert must use this.
function makeApplyResultBody(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
    applyErrors: [],
    editOperationID: TEST_EDIT_OPERATION_ID,
    validationPending: false,
    ...overrides
  };
}

const mockFetch = vi.fn();
const mockBeginEdit = vi.fn();
const mockConfirmDialog = vi.fn();
const mockCancelDialog = vi.fn();
const mockCancelPendingOperation = vi.fn(() => 'none');

let currentDialogState: UseEditPreviewFlowReturn['dialogState'] = { open: false, plan: null, busy: false, wasRefreshed: false };
let lastEditFlowArgs: Record<string, unknown> | null = null;
let queryRows: Array<Record<string, unknown>> = [GRID_ROW];

const censusScope = vi.hoisted(() => ({ census: { dateRanges: [] as Array<{ censusID: number }> } }));
const paginationCapture = vi.hoisted(() => ({ latest: null as InfiniteScrollPaginationProps | null }));

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: TEST_SCHEMA }),
  usePlotContext: () => ({ plotID: TEST_PLOT_ID }),
  useOrgCensusContext: () => censusScope.census,
  useOrgCensusListContext: () => []
}));

let mockSessionUserStatus: string = 'global';
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { userStatus: mockSessionUserStatus } } })
}));

vi.mock('@/components/client/clientmacros', () => ({
  loadSelectableOptions: vi.fn(async () => undefined)
}));

vi.mock('@/components/errors/contradictioncomparisonpanel', () => ({
  default: () => <div data-testid="contradiction-panel" />
}));

// The page imports the real column builder, which needs the real operator helpers; only the cell item and the api ref are stand-ins.
vi.mock('@mui/x-data-grid', async importOriginal => {
  const { GridActionsCellItemStub } = await import('@/tests/fixtures/errorsexplorer/grid-capture');
  const gridApiRef = { current: { hideFilterPanel: () => undefined, scrollToIndexes: () => undefined } };
  return {
    ...(await importOriginal<typeof import('@mui/x-data-grid')>()),
    GridActionsCellItem: GridActionsCellItemStub,
    useGridApiRef: () => gridApiRef
  };
});

// The grid renders the pagination slot with the infinite-scroll descriptor the page gives it; this records it.
vi.mock('@/components/datagrids/customgridpagination', () => ({
  default: (props: { infiniteScroll?: InfiniteScrollPaginationProps }) => {
    paginationCapture.latest = props.infiniteScroll ?? null;
    return null;
  }
}));

vi.mock('@/components/datagrids/infinitegridscrollbridge', () => ({
  default: () => null
}));

vi.mock('@/components/editplan/previewdialog', () => ({
  default: ({
    plan,
    onConfirm,
    onCancel,
    busy,
    wasRefreshed
  }: {
    plan: EditPlan;
    onConfirm: () => void;
    onCancel: () => void;
    busy: boolean;
    wasRefreshed?: boolean;
  }) => (
    <div data-testid="preview-dialog" data-plan-hash={plan.planHash} data-busy={String(busy)} data-refreshed={String(Boolean(wasRefreshed))}>
      <button type="button" data-testid="preview-confirm" onClick={onConfirm}>
        Apply
      </button>
      <button type="button" data-testid="preview-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}));

// onUndo's real signature is (confirmedPlanHash?: string) => Promise<UndoRevertOutcome>
// (see components/editplan/undotoast.tsx). This mock preserves the original
// no-argument "Undo" button for the pre-existing tests below, and adds a
// "Confirm" button that supplies a confirmedPlanHash for the #427 confirmed-retry
// tests. Both buttons stash the resolved outcome on undoOutcomeCapture so tests
// can assert exactly what the call site returned to the toast, which a toast
// that merely fires onUndo() cannot otherwise reveal.
vi.mock('@/components/editplan/undotoast', () => ({
  default: ({
    editOperationID,
    onUndo,
    onDismiss
  }: {
    editOperationID: number;
    onUndo: (confirmedPlanHash?: string) => Promise<UndoRevertOutcome>;
    onDismiss: () => void;
  }) => (
    <div data-testid={`undo-toast-${editOperationID}`}>
      <button
        type="button"
        data-testid="undo-toast-undo"
        onClick={() => {
          void onUndo().then(outcome => {
            undoOutcomeCapture.lastOutcome = outcome;
          });
        }}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="undo-toast-confirm"
        onClick={() => {
          void onUndo(TEST_PLAN_HASH_REFRESH).then(outcome => {
            undoOutcomeCapture.lastOutcome = outcome;
          });
        }}
      >
        Confirm
      </button>
      <button type="button" data-testid="undo-toast-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}));

// The real module keeps EditOperationCancelledError, which the row-edit hook tests with instanceof.
vi.mock('@/app/hooks/useEditPreviewFlow', async importOriginal => ({
  ...(await importOriginal<typeof import('@/app/hooks/useEditPreviewFlow')>()),
  useEditPreviewFlow: (args: Record<string, unknown>): UseEditPreviewFlowReturn => {
    lastEditFlowArgs = args;
    return {
      beginEdit: mockBeginEdit as unknown as UseEditPreviewFlowReturn['beginEdit'],
      confirmDialog: mockConfirmDialog as unknown as UseEditPreviewFlowReturn['confirmDialog'],
      cancelDialog: mockCancelDialog as unknown as UseEditPreviewFlowReturn['cancelDialog'],
      cancelPendingOperation: mockCancelPendingOperation as unknown as UseEditPreviewFlowReturn['cancelPendingOperation'],
      dialogState: currentDialogState
    };
  }
}));

vi.mock('@/config/styleddatagrid', async () => (await import('@/tests/fixtures/errorsexplorer/grid-capture')).styledDataGridCaptureModule());

type FetchResponder = (url: string, init?: RequestInit) => Response | undefined;

interface ExplorerFetchOptions {
  rows?: Array<Record<string, unknown>>;
  totals?: Partial<ErrorCensusTotals>;
  respond?: FetchResponder;
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input.toString();
}

// Answers like the real routes for a census whose only error type is the first served row's.
function explorerFetch({ rows, totals, respond }: ExplorerFetchOptions = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const override = respond?.(url, init);
    if (override) return override;
    const servedRows = rows ?? queryRows;
    if (ROUTES.query.test(url)) return jsonResponse({ rows: servedRows, totalRows: servedRows.length });
    if (ROUTES.facets.test(url)) {
      const facets = servedRows.length > 0 ? [facetOf(servedRows[0] as unknown as ErrorExplorerRow, servedRows.length)] : [];
      return jsonResponse(facetsResponse(facets, totals));
    }
    if (ROUTES.details.test(url)) return jsonResponse({ row: servedRows[0] ?? null, allErrors: [], relatedRows: [] });
    if (ROUTES.revert.test(url)) return jsonResponse(makeApplyResultBody());
    return jsonResponse({});
  };
}

function serveExplorerFetch(options: ExplorerFetchOptions = {}) {
  mockFetch.mockImplementation(explorerFetch(options));
}

function callsTo(pattern: RegExp): number {
  return mockFetch.mock.calls.filter(([input]) => pattern.test(urlOf(input))).length;
}

function queryCallsWithPageSize(pageSize: number): number {
  return mockFetch.mock.calls.filter(([input, init]) => ROUTES.query.test(urlOf(input)) && init?.body && JSON.parse(String(init.body)).pageSize === pageSize)
    .length;
}

function requireRevertBody(): Record<string, unknown> {
  const revertCall = mockFetch.mock.calls.find(([input]) => ROUTES.revert.test(urlOf(input)));
  if (!revertCall) throw new Error(`No /api/edits/revert request. Requests: ${JSON.stringify(mockFetch.mock.calls.map(([input]) => urlOf(input)))}`);
  return JSON.parse(String(revertCall[1]?.body));
}

async function mountExplorer() {
  const mod = await import('./errorsexplorer');
  const ErrorsExplorer = mod.default;
  return render(<ErrorsExplorer />);
}

async function waitForGridRow(gridLabel: string, rowID = TEST_CORE_MEASUREMENT_ID) {
  await waitFor(() => {
    expect(requireGrid(gridLabel).rows.some(row => Number(row.id) === rowID)).toBe(true);
  });
}

// A saved row's reads run after MUI finishes the edit; the grid is unlocked once they have all settled.
async function waitForEditLockReleased(gridLabel: string) {
  await waitFor(() => expect(requireGrid(gridLabel).disableColumnSorting).toBe(false));
}

async function switchToNoGrouping() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: VIEW_ERRORS_TEXT.groupRowsLabel }));
  await user.click(await screen.findByRole('option', { name: VIEW_ERRORS_TEXT.noGrouping }));
  await waitFor(() => requireGrid(FLAT_GRID));
}

function toggleInfiniteScroll(next: boolean) {
  const descriptor = paginationCapture.latest;
  if (!descriptor) throw new Error('The flat grid has not rendered its pagination slot with an infinite-scroll descriptor.');
  act(() => descriptor.onToggle(next));
}

interface MuiEditableColumn {
  field: string;
  editable?: boolean;
  valueGetter?: (value: unknown, row: Record<string, unknown>, column: unknown) => unknown;
  valueSetter?: (value: unknown, row: Record<string, unknown>, column: unknown) => Record<string, unknown>;
}

// What MUI does with the edit cells: seed each editable column through valueGetter, apply the user's changes, run valueSetter.
async function saveRowThroughMuiEditing(gridLabel: string, rowID: number, changes: Record<string, unknown>) {
  enterEdit(gridLabel, rowID);
  const grid = requireGrid(gridLabel);
  const oldRow = requireRow(gridLabel, rowID);
  const editableColumns = (grid.columns as MuiEditableColumn[]).filter(column => column.editable);
  const editValues = Object.fromEntries(
    editableColumns.map(column => [column.field, column.valueGetter ? column.valueGetter(oldRow[column.field], oldRow, column) : oldRow[column.field]])
  );
  Object.assign(editValues, changes);
  const newRow = editableColumns.reduce<Record<string, unknown>>((row, column) => {
    const value = editValues[column.field];
    return column.valueSetter ? column.valueSetter(value, row, column) : { ...row, [column.field]: value };
  }, oldRow);
  if (!grid.processRowUpdate) throw new Error(`"${gridLabel}" has no processRowUpdate`);
  await act(async () => {
    await grid.processRowUpdate?.(newRow, oldRow);
    requireGrid(gridLabel).onRowModesModelChange?.({});
  });
}

describe('ErrorsExplorer — row edit via shared preview flow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetCapturedGrids();
    currentDialogState = { open: false, plan: null, busy: false, wasRefreshed: false };
    lastEditFlowArgs = null;
    mockSessionUserStatus = 'global';
    queryRows = [GRID_ROW];
    censusScope.census = { dateRanges: [{ censusID: TEST_CENSUS_ID }] };
    paginationCapture.latest = null;
    mockCancelPendingOperation.mockReturnValue('none');

    const { loadSelectableOptions } = await import('@/components/client/clientmacros');
    vi.mocked(loadSelectableOptions).mockImplementation(async () => undefined);

    installMemoryStorage();
    serveExplorerFetch();
    vi.stubGlobal('fetch', mockFetch);
    undoOutcomeCapture.lastOutcome = undefined;
  });

  afterEach(() => {
    resetCapturedGrids();
  });

  it('creates the edit flow with the page census and saves a second-census row with that row’s census (P2-3)', async () => {
    const SECOND_CENSUS_ROW = { ...GRID_ROW, censusID: TEST_SECOND_CENSUS_ID };
    queryRows = [SECOND_CENSUS_ROW];
    censusScope.census = { dateRanges: [{ censusID: TEST_CENSUS_ID }, { censusID: TEST_SECOND_CENSUS_ID }] };
    await mountExplorer();
    await waitFor(() => expect(lastEditFlowArgs).not.toBeNull());
    expect(lastEditFlowArgs).toMatchObject({ schema: TEST_SCHEMA, plotID: TEST_PLOT_ID, censusID: TEST_CENSUS_ID, dataType: 'measurementssummary' });
    await waitForGridRow(GROUP_GRID);
    mockBeginEdit.mockResolvedValueOnce(makeApplyResultBody());
    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });
    console.log('[view-errors repoint census]', JSON.stringify(mockBeginEdit.mock.calls[0]));
    expect(mockBeginEdit.mock.calls[0][2]).toMatchObject({ dataType: 'measurementssummary', censusID: TEST_SECOND_CENSUS_ID });
  });

  it('links ingestion failures to the failed-measurement recovery modal', async () => {
    const FAILED_ROW = { ...GRID_ROW, errorSources: ['ingestion'], isFailedRow: true };
    serveExplorerFetch({ rows: [FAILED_ROW], totals: { failedMeasurements: 1, validation: 0, ingestion: 1 } });

    const { unmount } = await mountExplorer();

    const recoveryLink = await screen.findByRole('link', { name: 'Fix 1 failed uploads' });
    console.log(`[view-errors repoint recovery link] ${recoveryLink.textContent} -> ${recoveryLink.getAttribute('href')}`);
    expect(recoveryLink).toHaveAttribute('href', '/measurementshub/summary?openFailed=1');

    unmount();
    mockSessionUserStatus = 'pending';
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    expect(screen.queryByRole('link', { name: /fix \d+ failed uploads/i })).not.toBeInTheDocument();
  });

  it('does not call the legacy PATCH endpoint when a row is saved', async () => {
    mockBeginEdit.mockResolvedValue({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });

    const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);

    const urlsCalled = mockFetch.mock.calls.map(([input]) => urlOf(input));
    expect(urlsCalled.some(url => url.includes('/api/fixeddata/measurementssummary/'))).toBe(false);
  });

  it('delegates row saves to flow.beginEdit with only editable fields in canonical form', async () => {
    mockBeginEdit.mockResolvedValue({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    // Edit two editable fields AND a non-editable internal identifier; only editable fields should flow through.
    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12, attributes: 'L;M', treeID: 999999 });

    await waitFor(() => expect(mockBeginEdit).toHaveBeenCalledTimes(1));
    const [targetID, diff] = mockBeginEdit.mock.calls[0];
    expect(targetID).toBe(TEST_CORE_MEASUREMENT_ID);
    expect(diff).toEqual({ MeasuredDBH: 12, Attributes: 'L;M' });
    expect(Object.keys(diff)).not.toContain('TreeID');
    expect(Object.keys(diff)).not.toContain('CoreMeasurementID');
  });

  it('does not copy uploaded codes into Attributes when another field is edited', async () => {
    mockBeginEdit.mockResolvedValue({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    queryRows = [{ ...GRID_ROW, attributes: 'L', rawCodes: 'L;INVALID' }];

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    expect(requireRow(GROUP_GRID, TEST_CORE_MEASUREMENT_ID).rawCodes).toBe('L;INVALID');

    await saveRowThroughMuiEditing(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });

    await waitFor(() => expect(mockBeginEdit).toHaveBeenCalledTimes(1));
    const [, diff] = mockBeginEdit.mock.calls[0];
    expect(diff).toEqual({ MeasuredDBH: 12 });
    expect(diff).not.toHaveProperty('Attributes');
  });

  // Regression: hard-failed rows (cm.StemGUID IS NULL) must route to the
  // failedmeasurements edit surface — not measurementssummary, whose analyzer
  // filters cm.StemGUID IS NOT NULL and would 404.
  it('routes failed rows to the failedmeasurements dataType with canonical SpCode/Tag/Codes field names', async () => {
    mockBeginEdit.mockResolvedValue({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    const FAILED_ROW = { ...GRID_ROW, errorSources: ['ingestion'], isFailedRow: true };
    queryRows = [FAILED_ROW];

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    expect(requireRow(GROUP_GRID, TEST_CORE_MEASUREMENT_ID).isFailedRow).toBe(true);

    // Edit speciesCode + measuredDBH + attributes on a failed row. Canonical
    // names on the failedmeasurements surface are SpCode, DBH, Codes (not
    // SpeciesCode, MeasuredDBH, Attributes).
    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { speciesCode: 'NEWSP', measuredDBH: 14, attributes: 'L;DEAD' });

    await waitFor(() => expect(mockBeginEdit).toHaveBeenCalledTimes(1));
    const [, diff, options] = mockBeginEdit.mock.calls[0];
    expect(diff).toEqual({ SpCode: 'NEWSP', DBH: 14, Codes: 'L;DEAD' });
    expect(options).toEqual({ dataType: 'failedmeasurements', censusID: TEST_CENSUS_ID });
  });

  it('shows the UndoToast after a successful edit', async () => {
    mockBeginEdit.mockResolvedValueOnce({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });

    await waitFor(() => expect(mockBeginEdit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId(`undo-toast-${TEST_EDIT_OPERATION_ID}`)).toBeInTheDocument());
  });

  // The undo affordance is only honest when there is an operation to revert.
  // A writer that reports no editOperationID (nothing was recorded as undoable)
  // must leave the toast off rather than offer an undo that cannot resolve.
  it('leaves the UndoToast off when the edit returned no operation ID', async () => {
    mockBeginEdit.mockResolvedValueOnce({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: null,
      validationPending: false
    });

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });

    await waitFor(() => expect(mockBeginEdit).toHaveBeenCalledTimes(1));
    // No toast under ANY operation ID: a toast rendered with a null/undefined ID
    // would offer an undo that /api/edits/revert cannot resolve.
    expect(screen.queryAllByTestId(/^undo-toast-/)).toHaveLength(0);
  });

  it('renders the PreviewDialog using the current dialogState and refreshes the fresh plan on 409 drift', async () => {
    // Simulate the flow needing confirmation: open the dialog with an initial plan.
    currentDialogState = { open: true, plan: makePlan({ planHash: TEST_PLAN_HASH_INITIAL }), busy: false, wasRefreshed: false };

    const { rerender } = await mountExplorer();
    await waitFor(() => expect(screen.getByTestId('preview-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('preview-dialog').getAttribute('data-plan-hash')).toBe(TEST_PLAN_HASH_INITIAL);
    expect(screen.getByTestId('preview-dialog').getAttribute('data-refreshed')).toBe('false');

    // A 409 conflict causes the hook to swap in a fresh plan (different planHash).
    currentDialogState = { open: true, plan: makePlan({ planHash: TEST_PLAN_HASH_REFRESH }), busy: false, wasRefreshed: true };
    const mod = await import('./errorsexplorer');
    const ErrorsExplorer = mod.default;
    rerender(<ErrorsExplorer />);

    await waitFor(() => expect(screen.getByTestId('preview-dialog').getAttribute('data-plan-hash')).toBe(TEST_PLAN_HASH_REFRESH));
    expect(screen.getByTestId('preview-dialog').getAttribute('data-refreshed')).toBe('true');
  });

  it('wires the PreviewDialog Apply button to the flow.confirmDialog callback', async () => {
    currentDialogState = { open: true, plan: makePlan(), busy: false, wasRefreshed: false };
    await mountExplorer();

    fireEvent.click(screen.getByTestId('preview-confirm'));
    expect(mockConfirmDialog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('preview-cancel'));
    expect(mockCancelDialog).toHaveBeenCalledTimes(1);
  });

  it('undo toast Undo button calls /api/edits/revert with the operation’s census and edit operation ID', async () => {
    queryRows = [{ ...GRID_ROW, censusID: TEST_SECOND_CENSUS_ID }];
    censusScope.census = { dateRanges: [{ censusID: TEST_CENSUS_ID }, { censusID: TEST_SECOND_CENSUS_ID }] };
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    mockBeginEdit.mockResolvedValueOnce(makeApplyResultBody());
    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });
    fireEvent.click(await screen.findByTestId('undo-toast-undo'));
    await waitFor(() => expect(callsTo(ROUTES.revert)).toBe(1));
    const revertBody = requireRevertBody();
    console.log('[view-errors repoint revert census]', JSON.stringify(revertBody));
    expect(revertBody).toMatchObject({
      schema: TEST_SCHEMA,
      plotID: TEST_PLOT_ID,
      censusID: TEST_SECOND_CENSUS_ID,
      editOperationID: TEST_EDIT_OPERATION_ID
    });
  });

  // Pending users should not see edit affordances. Server-side authorization
  // still backstops this; the gate is UX so users don't click Edit only to fail
  // at the server round-trip.
  it('hides the actions column and shows a read-only banner for pending users', async () => {
    mockSessionUserStatus = 'pending';

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    const banner = screen.getByTestId('errorsexplorer-readonly-banner');
    expect(banner).toHaveTextContent(`· ${VIEW_ERRORS_TEXT.readOnlySuffix}`);
    // The mocked grid renders action buttons via the actions column's getActions —
    // a read-only user is left with Details alone, so no Edit/Save/Cancel appears.
    const actionNames = screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-label'));
    console.log(`[view-errors repoint read-only] actions: ${JSON.stringify(actionNames)}, header: ${String(requireGrid(GROUP_GRID).columns[0].headerName)}`);
    expect(actionNames).toEqual([VIEW_ERRORS_TEXT.detailsAction]);
    expect(requireGrid(GROUP_GRID).columns[0]).toMatchObject({ field: 'actions', headerName: VIEW_ERRORS_TEXT.detailsColumn });
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('shows the actions column for global / db admin / lead technician / field crew', async () => {
    for (const status of ['global', 'db admin', 'lead technician', 'field crew']) {
      mockSessionUserStatus = status;
      const { unmount } = await mountExplorer();
      await waitForGridRow(GROUP_GRID);

      expect(screen.queryByTestId('errorsexplorer-readonly-banner')).not.toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();

      unmount();
    }
  });

  it('keeps species-code cells editable only for admin roles', async () => {
    const speciesCodeEditable = () =>
      (requireGrid(GROUP_GRID).columns.find(column => column.field === 'speciesCode') as MuiEditableColumn | undefined)?.editable;

    mockSessionUserStatus = 'field crew';
    const firstRender = await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    expect(speciesCodeEditable()).toBe(false);
    firstRender.unmount();

    mockSessionUserStatus = 'db admin';
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    expect(speciesCodeEditable()).toBe(true);
  });

  it('shows the plot-coordinate fields used by validation 19 as read-only columns', async () => {
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    const columns = requireGrid(GROUP_GRID).columns;
    expect(columns.find(column => column.field === 'stemPlotX')).toMatchObject({ headerName: 'Plot X', editable: false });
    expect(columns.find(column => column.field === 'stemPlotY')).toMatchObject({ headerName: 'Plot Y', editable: false });
  });

  it('skips the preview flow entirely when the diff is empty', async () => {
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, {});

    expect(mockBeginEdit).not.toHaveBeenCalled();
  });

  it('selecting infinite via the pagination slot issues a query with pageSize 100', async () => {
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    await switchToNoGrouping();
    await waitForGridRow(FLAT_GRID);

    toggleInfiniteScroll(true);

    await waitFor(() => {
      console.log(`[view-errors repoint infinite] queries with pageSize ${INFINITE_CHUNK_SIZE}: ${queryCallsWithPageSize(INFINITE_CHUNK_SIZE)}`);
      expect(queryCallsWithPageSize(INFINITE_CHUNK_SIZE)).toBeGreaterThan(0);
    });
  });

  it('refreshes the infinite row source after an edit', async () => {
    mockBeginEdit.mockResolvedValueOnce({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    await switchToNoGrouping();
    await waitForGridRow(FLAT_GRID);

    toggleInfiniteScroll(true);
    await waitFor(() => expect(queryCallsWithPageSize(INFINITE_CHUNK_SIZE)).toBeGreaterThan(0));
    await waitForGridRow(FLAT_GRID);

    mockFetch.mockClear();
    await saveRowThroughGrid(FLAT_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });

    await waitFor(() => {
      console.log(
        `[view-errors repoint infinite edit] queries with pageSize ${INFINITE_CHUNK_SIZE} after the edit: ${queryCallsWithPageSize(INFINITE_CHUNK_SIZE)}`
      );
      expect(queryCallsWithPageSize(INFINITE_CHUNK_SIZE)).toBeGreaterThan(0);
    });
  });

  it('refreshes the infinite row source after undo', async () => {
    mockBeginEdit.mockResolvedValueOnce({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    await switchToNoGrouping();
    await waitForGridRow(FLAT_GRID);

    toggleInfiniteScroll(true);
    await waitFor(() => expect(queryCallsWithPageSize(INFINITE_CHUNK_SIZE)).toBeGreaterThan(0));
    await waitForGridRow(FLAT_GRID);

    await saveRowThroughGrid(FLAT_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });
    await waitFor(() => expect(screen.getByTestId(`undo-toast-${TEST_EDIT_OPERATION_ID}`)).toBeInTheDocument());
    await waitForEditLockReleased(FLAT_GRID);

    mockFetch.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId('undo-toast-undo'));
    });

    await waitFor(() => {
      console.log(
        `[view-errors repoint infinite undo] queries with pageSize ${INFINITE_CHUNK_SIZE} after the undo: ${queryCallsWithPageSize(INFINITE_CHUNK_SIZE)}`
      );
      expect(queryCallsWithPageSize(INFINITE_CHUNK_SIZE)).toBeGreaterThan(0);
    });
  });

  // #427 client wiring: the onUndo callback passed to UndoToast must route
  // through requestEditRevert (frontend/lib/editplan/requestrevert.ts) so a
  // 409 plan-drift response surfaces as a confirmation request instead of a
  // generic failure. requestEditRevert itself is not mocked here — the
  // existing mockFetch above already controls every /api/edits/revert
  // response for this file, so driving those responses through the real
  // HTTP-status/body contract (409 + freshPlan, vs. a plain error body)
  // exercises requestEditRevert's actual parsing instead of assuming it.
  it('puts Codes right after Actions for an editor, and first for a user who cannot edit (#525 item 7)', async () => {
    mockSessionUserStatus = 'field crew';
    const editorView = await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    const editorFields = requireGrid(GROUP_GRID).columns.map(column => column.field);
    editorView.unmount();

    mockSessionUserStatus = 'pending';
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    const readOnlyColumns = requireGrid(GROUP_GRID).columns;
    const readOnlyFields = readOnlyColumns.map(column => column.field);

    console.log(`[#525 item 7] editor columns: ${editorFields.join(', ')} | read-only columns: ${readOnlyFields.join(', ')}`);
    expect(editorFields.slice(0, 3)).toEqual(['actions', 'errors', 'attributes']);
    expect(readOnlyFields.slice(0, 3)).toEqual(['actions', 'errors', 'attributes']);
    expect(readOnlyColumns[0]).toMatchObject({ field: 'actions', headerName: VIEW_ERRORS_TEXT.detailsColumn });
  });

  it('starts with the plot-coordinate and prior-census columns hidden through the controlled column visibility model (#525 item 7)', async () => {
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);
    const groupVisibility = requireGrid(GROUP_GRID).columnVisibilityModel;
    console.log(`[#525 item 7] group columnVisibilityModel: ${JSON.stringify(groupVisibility)}`);
    expect(groupVisibility).toMatchObject(ERRORS_EXPLORER_DEFAULT_HIDDEN_COLUMNS);

    await switchToNoGrouping();
    const flatVisibility = requireGrid(FLAT_GRID).columnVisibilityModel;
    console.log(`[#525 item 7] flat columnVisibilityModel: ${JSON.stringify(flatVisibility)}`);
    expect(flatVisibility).toEqual(ERRORS_EXPLORER_DEFAULT_HIDDEN_COLUMNS);
  });

  it('keeps a column the user turned on after the list empties and refills while the page stays open (#525 item 7)', async () => {
    const NO_MATCH_QUICK_SEARCH = 'no-such-measurement';
    const SHOWN_COLUMN = 'priorDBH';
    const matchesNothing = (init?: RequestInit) => JSON.parse(String(init?.body)).filters.quickSearch === NO_MATCH_QUICK_SEARCH;
    mockFetch.mockImplementation(
      explorerFetch({
        respond: (url, init) => {
          if (!(ROUTES.query.test(url) || ROUTES.facets.test(url)) || !matchesNothing(init)) return undefined;
          return ROUTES.query.test(url) ? jsonResponse({ rows: [], totalRows: 0 }) : jsonResponse(facetsResponse([]));
        }
      })
    );
    await mountExplorer();
    await waitForGridRow(GROUP_GRID);

    act(() => {
      requireGrid(GROUP_GRID).onColumnVisibilityModelChange?.({ ...requireGrid(GROUP_GRID).columnVisibilityModel, [SHOWN_COLUMN]: true });
    });
    await waitFor(() => expect(requireGrid(GROUP_GRID).columnVisibilityModel?.[SHOWN_COLUMN]).toBe(true));
    const modelBeforeEmpty = requireGrid(GROUP_GRID).columnVisibilityModel;

    fireEvent.change(screen.getByLabelText(VIEW_ERRORS_TEXT.searchLabel), { target: { value: NO_MATCH_QUICK_SEARCH } });
    await waitFor(() => expect(screen.getByTestId('errors-explorer-empty')).toBeInTheDocument());
    expect(screen.getByTestId('errors-explorer-empty')).toHaveTextContent(VIEW_ERRORS_TEXT.emptyFiltered);
    expect(capturedGrids.size).toBe(0);

    fireEvent.change(screen.getByLabelText(VIEW_ERRORS_TEXT.searchLabel), { target: { value: '' } });
    await waitForGridRow(GROUP_GRID);

    console.log(`[#525 item 7] columnVisibilityModel after empty and refill: ${JSON.stringify(requireGrid(GROUP_GRID).columnVisibilityModel)}`);
    expect(requireGrid(GROUP_GRID).columnVisibilityModel).toEqual(modelBeforeEmpty);
    expect(requireGrid(GROUP_GRID).columnVisibilityModel?.[SHOWN_COLUMN]).toBe(true);
  });

  describe('undo revert outcome handling (#427)', () => {
    async function mountExplorerWithUndoToast() {
      mockBeginEdit.mockResolvedValueOnce({
        updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
        applyErrors: [],
        editOperationID: TEST_EDIT_OPERATION_ID,
        validationPending: false
      });

      await mountExplorer();
      await waitForGridRow(GROUP_GRID);

      await saveRowThroughGrid(GROUP_GRID, TEST_CORE_MEASUREMENT_ID, { measuredDBH: 12 });
      await waitFor(() => expect(screen.getByTestId(`undo-toast-${TEST_EDIT_OPERATION_ID}`)).toBeInTheDocument());
      await waitForEditLockReleased(GROUP_GRID);
    }

    function countExplorerQueryCalls(): number {
      return callsTo(ROUTES.query);
    }

    // The regression tests below spy on ailogger.error via vi.spyOn; restore it
    // so later tests in this file see the real (console-fallback) logger again.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not show success feedback or refresh when the server demands confirmation, and returns the fresh plan to the toast unchanged', async () => {
      await mountExplorerWithUndoToast();

      serveExplorerFetch({
        respond: url =>
          ROUTES.revert.test(url)
            ? jsonResponse(
                {
                  error: 'plan drift',
                  freshPlan: { ...makePlan({ planHash: TEST_PLAN_HASH_REFRESH }), fieldChanges: [{ field: 'MeasuredDBH', from: 11, to: 13 }] }
                },
                409
              )
            : undefined
      });

      const queryCallsBeforeUndo = countExplorerQueryCalls();

      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(undoOutcomeCapture.lastOutcome).toBeDefined());
      expect(undoOutcomeCapture.lastOutcome).toMatchObject({
        status: 'confirmation-required',
        freshPlan: expect.objectContaining({ planHash: TEST_PLAN_HASH_REFRESH })
      });

      // No refresh: fetchRows (the explorer/query endpoint) must not have run again.
      expect(countExplorerQueryCalls()).toBe(queryCallsBeforeUndo);
      // No error banner and no success text — the toast owns the preview, this call site owns nothing yet.
      expect(screen.queryByText(/Undo failed/i)).not.toBeInTheDocument();
    });

    it('surfaces the helper-provided failure message via the existing error banner without refreshing', async () => {
      await mountExplorerWithUndoToast();

      const SERVER_FAILURE_MESSAGE = 'Revert rejected: edit operation changed during revert';
      serveExplorerFetch({ respond: url => (ROUTES.revert.test(url) ? jsonResponse({ error: SERVER_FAILURE_MESSAGE }, 500) : undefined) });

      const queryCallsBeforeUndo = countExplorerQueryCalls();

      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(screen.getByText(`Undo failed: ${SERVER_FAILURE_MESSAGE}`)).toBeInTheDocument());
      expect(undoOutcomeCapture.lastOutcome).toEqual({ status: 'failed' });
      expect(countExplorerQueryCalls()).toBe(queryCallsBeforeUndo);
    });

    it('runs the full refresh chain exactly once on a successful revert (summary view, view-full-table, and rows)', async () => {
      await mountExplorerWithUndoToast();

      mockFetch.mockClear();
      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(undoOutcomeCapture.lastOutcome).toEqual({ status: 'reverted' }));

      console.log(
        `[view-errors repoint undo chain] summary ${callsTo(ROUTES.rebuildSummary)}, fullTable ${callsTo(ROUTES.rebuildFullTable)}, query ${callsTo(ROUTES.query)}, facets ${callsTo(ROUTES.facets)}`
      );
      expect(callsTo(ROUTES.rebuildSummary)).toBe(1);
      expect(callsTo(ROUTES.rebuildFullTable)).toBe(1);
      expect(callsTo(ROUTES.query)).toBe(1);
    });

    // The successful edit path (processRowUpdate) refreshes rows, facets, AND the
    // selected row's details. Before this fix the undo path refreshed only rows —
    // this proves undo now re-reads the same affected set as a normal edit.
    it('refreshes facets and the selected row details after undo, not just rows', async () => {
      await mountExplorerWithUndoToast();

      await userEvent.click(screen.getAllByRole('menuitem', { name: VIEW_ERRORS_TEXT.detailsAction })[0]);
      await waitFor(() => expect(callsTo(new RegExp(`/api/errors/explorer/details/${TEST_CORE_MEASUREMENT_ID}`))).toBeGreaterThan(0));

      mockFetch.mockClear();
      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(undoOutcomeCapture.lastOutcome).toEqual({ status: 'reverted' }));

      expect(callsTo(ROUTES.query)).toBeGreaterThan(0);
      expect(callsTo(ROUTES.facets)).toBeGreaterThan(0);
      expect(callsTo(new RegExp(`/api/errors/explorer/details/${TEST_CORE_MEASUREMENT_ID}`))).toBeGreaterThan(0);
    });

    // Consumer-boundary regression: a REAL failing fetch from the facets endpoint
    // (not refreshviews, which the pre-existing refresh-failed test above already
    // covers) must still surface the reverted-but-refresh-failed warning and must
    // still report the undo as completed.
    it('surfaces the reverted-but-refresh-failed message when the post-undo facets fetch fails, not just when refreshviews fails', async () => {
      await mountExplorerWithUndoToast();

      const FACETS_FAILURE_MESSAGE = 'facets endpoint exploded';
      const errorLogSpy = vi.spyOn(ailogger, 'error').mockImplementation(() => undefined);

      serveExplorerFetch({ respond: url => (ROUTES.facets.test(url) ? jsonResponse({ error: FACETS_FAILURE_MESSAGE }, 500) : undefined) });

      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(screen.getByText(EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE)).toBeInTheDocument());
      expect(undoOutcomeCapture.lastOutcome).toEqual({ status: 'reverted' });
      expect(screen.queryByText(/Undo failed/i)).not.toBeInTheDocument();

      expect(errorLogSpy).toHaveBeenCalledTimes(1);
      const [, loggedError] = errorLogSpy.mock.calls[0];
      expect(loggedError).toBeInstanceOf(Error);
      expect((loggedError as Error).message).toBe(FACETS_FAILURE_MESSAGE);
    });

    it('sends the same schema/plotID/censusID/editOperationID plus the supplied confirmedPlanHash on a confirmed retry', async () => {
      await mountExplorerWithUndoToast();

      mockFetch.mockClear();
      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-confirm'));
      });

      await waitFor(() => expect(callsTo(ROUTES.revert)).toBe(1));

      expect(requireRevertBody()).toEqual({
        schema: TEST_SCHEMA,
        plotID: TEST_PLOT_ID,
        censusID: TEST_CENSUS_ID,
        editOperationID: TEST_EDIT_OPERATION_ID,
        confirmedPlanHash: TEST_PLAN_HASH_REFRESH
      });
    });

    // By the time requestEditRevert resolves 'reverted', the server has already
    // committed the write. If the explorer's post-revert refresh chain then
    // throws, the undo must not be reported as failed (that would invite a
    // double-revert retry) and must not be reported as silently successful
    // either — the user needs to know the view may be stale.
    it('shows the reverted-but-refresh-failed message and logs the error when the post-revert refresh chain throws, while still reporting the revert as completed', async () => {
      await mountExplorerWithUndoToast();

      const REFRESH_FAILURE_MESSAGE = 'refreshviews measurementssummary exploded';
      const errorLogSpy = vi.spyOn(ailogger, 'error').mockImplementation(() => undefined);

      serveExplorerFetch({ respond: url => (ROUTES.rebuildSummary.test(url) ? jsonResponse({ error: REFRESH_FAILURE_MESSAGE }, 500) : undefined) });

      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(screen.getByText(EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE)).toBeInTheDocument());
      expect(undoOutcomeCapture.lastOutcome).toEqual({ status: 'reverted' });
      expect(screen.queryByText(/Undo failed/i)).not.toBeInTheDocument();

      expect(errorLogSpy).toHaveBeenCalledTimes(1);
      const [, loggedError] = errorLogSpy.mock.calls[0];
      expect(loggedError).toBeInstanceOf(Error);
      expect((loggedError as Error).message).toBe(REFRESH_FAILURE_MESSAGE);
    });

    // requestEditRevert resolves 'unconfirmed' when /api/edits/revert answers
    // 2xx with a body that is not a real ApplyResult: the write may or may not
    // have committed. The call site must say so verbatim, must not refresh
    // (there is nothing proven to refresh for), and must not use "Undo failed"
    // wording, which would wrongly tell the user nothing happened.
    it('surfaces the could-not-confirm message without refreshing or claiming success when the server returns a malformed 2xx body', async () => {
      await mountExplorerWithUndoToast();

      serveExplorerFetch({ respond: url => (ROUTES.revert.test(url) ? jsonResponse({ ok: true }) : undefined) });

      const queryCallsBeforeUndo = countExplorerQueryCalls();

      await act(async () => {
        fireEvent.click(screen.getByTestId('undo-toast-undo'));
      });

      await waitFor(() => expect(screen.getByText(UNCONFIRMED_OUTCOME_MESSAGE)).toBeInTheDocument());
      expect(undoOutcomeCapture.lastOutcome).toEqual({ status: 'unconfirmed' });
      expect(countExplorerQueryCalls()).toBe(queryCallsBeforeUndo);
      expect(screen.queryByText(/Undo failed/i)).not.toBeInTheDocument();
    });
  });
});
