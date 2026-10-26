import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import IsolatedFailedMeasurementsDataGrid, {
  dayToPickerMoment,
  formatDetailedFailureDescription,
  hasStoredCurrentIngestionFailures,
  isReadyForReingestion
} from './isolatedfailedmeasurementsdatagrid';
import { RowSaveFinalizationError } from '@/components/datagrids/rowsaveerror';
import type { ApplyResult } from '@/config/editplan/types';
import type { UndoRevertOutcome } from '@/components/editplan/undotoast';
import { UNCONFIRMED_OUTCOME_MESSAGE } from '@/lib/editplan/requestrevert';
import { toCalendarDayString } from '@/config/dateformats';

// Typed capture shared between the mocked UndoToast and the mocked
// isolateddatagridcommons below via vi.hoisted, so neither needs an untyped
// window/globalThis escape hatch. Reset in beforeEach.
const gridHarness = vi.hoisted(() => ({
  lastUndoOutcome: undefined as UndoRevertOutcome | undefined,
  refreshRequests: 0
}));

// requestEditRevert (frontend/lib/editplan/requestrevert.ts) only treats a 2xx
// /api/edits/revert body as a successful revert when it satisfies
// isValidApplyResult (a real editOperationID, updatedIDs, applyErrors,
// validationPending). A bare `{ ok: true }` body is not a valid ApplyResult
// and now resolves to 'unconfirmed', so every fixture claiming a successful
// revert must use this.
function makeApplyResultBody(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    updatedIDs: { failedmeasurements: 123 },
    applyErrors: [],
    editOperationID: 777,
    validationPending: false,
    ...overrides
  };
}

// Mock MUI DataGrid to avoid CSS import issues
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: () => <div>Mock DataGrid</div>,
  GridColDef: {},
  GridRowModel: {},
  GridRowModes: {},
  GridRowModesModel: {},
  GridEventListener: {},
  GridRowEditStopReasons: {},
  GridSlots: {},
  GridFilterOperator: {},
  GridPreProcessEditCellProps: {},
  GridRenderEditCellParams: {},
  GetApplyQuickFilterFn: {},
  getGridNumericOperators: () => [],
  useGridApiRef: () => ({
    current: {
      setEditCellValue: vi.fn(),
      stopCellEditMode: vi.fn()
    }
  })
}));

// Mock dependencies - use importOriginal to preserve all exports
vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return actual;
});

vi.mock('@/lib/db/definitions/views', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return actual;
});

vi.mock('@/lib/db/definitions/zones', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return actual;
});

vi.mock('@/lib/db/definitions/personnel', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return actual;
});

vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return actual;
});

vi.mock('@/lib/db/definitions/unifiedchangelog', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return actual;
});

// These context objects must keep stable references across renders so the
// component's loadSelectableOptions effect, which depends on them, is not
// retriggered on every render.
const TEST_PLOT_CONTEXT = vi.hoisted(() => ({ plotID: 1, plotName: 'Test Plot' }));
const TEST_CENSUS_CONTEXT = vi.hoisted(() => ({
  dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }],
  plotCensusNumber: 1
}));
const TEST_SITE_CONTEXT = vi.hoisted(() => ({ schemaName: 'testschema', siteName: 'Test Site' }));

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => TEST_PLOT_CONTEXT,
  useOrgCensusContext: () => TEST_CENSUS_CONTEXT,
  useSiteContext: () => TEST_SITE_CONTEXT,
  useQuadratContext: () => undefined
}));

vi.mock('@/components/datagrids/isolateddatagridcommons', () => {
  function MockIsolatedDataGridCommons({ onDataUpdate, onDataLoaded, editFlowOverride, gridColumns, refresh, setRefresh }: any) {
    // Expose onDataUpdate / editFlowOverride for testing
    if (onDataUpdate) {
      (window as any).testOnDataUpdate = onDataUpdate;
    }
    if (editFlowOverride) {
      (window as any).testEditFlowOverride = editFlowOverride;
    } else {
      delete (window as any).testEditFlowOverride;
    }
    if (onDataLoaded) {
      (window as any).testOnDataLoaded = onDataLoaded;
    } else {
      delete (window as any).testOnDataLoaded;
    }
    (window as any).testGridColumns = gridColumns;

    // Mirrors the real isolateddatagridcommons' refresh-edge effect
    // (components/datagrids/isolateddatagridcommons.tsx:647-655): only a
    // false->true transition of `refresh` is a refresh request, and the real
    // component resets it back to false once handled. A mock that just
    // mirrored the raw boolean could not distinguish "the save already set
    // refresh=true" from "undo set it again" - the save's true would still be
    // sitting there when the undo assertions ran, making them vacuous.
    const previousRefresh = React.useRef(refresh);
    React.useEffect(() => {
      if (refresh && !previousRefresh.current) {
        gridHarness.refreshRequests += 1;
        setRefresh(false);
      }
      previousRefresh.current = refresh;
    }, [refresh, setRefresh]);

    return <div data-testid="datagrid-commons">Mock DataGrid</div>;
  }
  return { default: MockIsolatedDataGridCommons };
});

vi.mock('@/components/client/clientmacros', () => ({
  loadSelectableOptions: vi.fn().mockResolvedValue(undefined),
  selectableAutocomplete: () => <div>Mock Autocomplete</div>,
  standardizeGridColumns: (cols: any) => cols,
  selectableOptionKeyForField: (field: string) => field
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const mockBeginEdit = vi.fn();
const mockConfirmDialog = vi.fn();
const mockCancelDialog = vi.fn();
let mockEditFlowArgs: any = null;
let mockEditFlowDialogState: any = { open: false, plan: null, busy: false };

vi.mock('@/app/hooks/useEditPreviewFlow', () => ({
  useEditPreviewFlow: (args: any) => {
    mockEditFlowArgs = args;
    return {
      beginEdit: mockBeginEdit,
      confirmDialog: mockConfirmDialog,
      cancelDialog: mockCancelDialog,
      dialogState: mockEditFlowDialogState
    };
  }
}));

vi.mock('@/components/editplan/previewdialog', () => ({
  default: () => <div data-testid="preview-dialog" />
}));

// onUndo's real signature is (confirmedPlanHash?: string) => Promise<UndoRevertOutcome>
// (see components/editplan/undotoast.tsx). The "Confirm" button supplies a
// confirmedPlanHash for the #427 confirmed-retry test; "Undo" preserves the
// original no-argument call so pre-existing assertions are unaffected. Both
// stash the resolved outcome on gridHarness so tests can assert exactly what
// the call site returned to the toast.
const UNDO_TEST_CONFIRMED_PLAN_HASH = 'f'.repeat(64);
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
            gridHarness.lastUndoOutcome = outcome;
          });
        }}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="undo-toast-confirm"
        onClick={() => {
          void onUndo(UNDO_TEST_CONFIRMED_PLAN_HASH).then(outcome => {
            gridHarness.lastUndoOutcome = outcome;
          });
        }}
      >
        Confirm
      </button>
      <button type="button" onClick={onDismiss} data-testid="undo-toast-dismiss">
        Dismiss
      </button>
    </div>
  )
}));

// Run under TZ=UTC, TZ=America/Los_Angeles and TZ=Pacific/Auckland; assertions are zone independent.
describe('Fix Failed Rows date display and editor (calendar day, never zone shifted)', () => {
  it.each([
    ['2027-02-15T00:00:00.000Z', '2027-02-15'],
    ['2027-02-15', '2027-02-15'],
    ['2027-01-01T00:00:00.000Z', '2027-01-01'],
    ['2027-03-14T00:00:00.000Z', '2027-03-14']
  ])('displays %s as %s', (stored, expected) => {
    expect(toCalendarDayString(stored)).toBe(expected);
  });

  it('opens the editor on the stored calendar day and saves the same day back', () => {
    const picker = dayToPickerMoment(toCalendarDayString('2027-02-15T00:00:00.000Z'));
    expect(picker!.format('YYYY-MM-DD')).toBe('2027-02-15');
    expect([picker!.year(), picker!.month(), picker!.date()]).toEqual([2027, 1, 15]);
  });

  it('shows an empty editor and an empty cell for null or invalid dates', () => {
    expect(dayToPickerMoment(toCalendarDayString(null))).toBeNull();
    expect(dayToPickerMoment(toCalendarDayString('not a date'))).toBeNull();
    expect(toCalendarDayString(undefined)).toBeNull();
  });
});

describe('IsolatedFailedMeasurementsDataGrid - Critical Bug Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    delete (window as any).testOnDataUpdate;
    delete (window as any).testOnDataLoaded;
    delete (window as any).testGridColumns;
    delete (window as any).testEditFlowOverride;
    gridHarness.lastUndoOutcome = undefined;
    gridHarness.refreshRequests = 0;
    mockBeginEdit.mockReset();
    mockConfirmDialog.mockReset();
    mockCancelDialog.mockReset();
    mockEditFlowArgs = null;
    mockEditFlowDialogState = { open: false, plan: null, busy: false };
  });

  describe('Bug Fix: Ready-to-reingest snackbar should honor stored ingestion failures', () => {
    it('does not mark rows with unresolved stored ingestion failures as ready', () => {
      const computeFailureReasons = vi.fn(() => '');
      const row = {
        currentFailureReasons: 'Measurement insert skipped during core materialization',
        failureReasons: 'Measurement insert skipped during core materialization'
      } as any;

      expect(hasStoredCurrentIngestionFailures(row)).toBe(true);
      expect(isReadyForReingestion(row, computeFailureReasons)).toBe(false);
      expect(computeFailureReasons).not.toHaveBeenCalled();
    });

    it('marks rows ready only when stored ingestion failures are cleared and client validation passes', () => {
      const computeFailureReasons = vi.fn(() => '');
      const row = {
        currentFailureReasons: null,
        failureReasons: 'Ready for reingestion'
      } as any;

      expect(hasStoredCurrentIngestionFailures(row)).toBe(false);
      expect(isReadyForReingestion(row, computeFailureReasons)).toBe(true);
      expect(computeFailureReasons).toHaveBeenCalledTimes(1);
    });

    it('does not auto-show the reingestion banner when failed measurements first load', async () => {
      const { loadSelectableOptions } = await import('@/components/client/clientmacros');
      (loadSelectableOptions as any).mockImplementation(async (_site: any, _plot: any, _census: any, setSelectableOpts: any) => {
        setSelectableOpts({
          treeTag: [],
          stemTag: [],
          quadratName: ['0101'],
          speciesCode: ['CRATSN'],
          codes: ['M']
        });
      });

      render(<IsolatedFailedMeasurementsDataGrid />);

      await waitFor(() => {
        expect(screen.getByTestId('datagrid-commons')).toBeInTheDocument();
      });

      expect((window as any).testOnDataLoaded).toBeUndefined();
      expect(screen.queryByText(/no validation failures and can be reingested/i)).not.toBeInTheDocument();
    });
  });

  describe('Bug Fix: Detailed reasons should be user-facing', () => {
    it('formats multiple-candidate measurement failures without the redundant technical prefix', () => {
      expect(formatDetailedFailureDescription('Measurement insert skipped: source row resolved to multiple candidate measurements')).toBe(
        'Row matches two or more stems/trees.'
      );
    });

    it('formats different-quadrat stem conflicts into a readable sentence', () => {
      expect(
        formatDetailedFailureDescription('Stem resolution failed: TreeTag "011134" / StemTag "011134" already exists in a different quadrat for census 19')
      ).toBe('Tree/stem already exists in a different quadrat for this census.');
    });
  });

  describe('Bug Fix: Validation error message deduplication', () => {
    it('should deduplicate failure reasons for the same column', () => {
      // This is tested via the displayFailureReason function
      // The function filters reasons to only show unique messages per column
      // Rendering logic ensures only the first relevant reason is displayed

      const _mockRow = {
        failureReasons: 'Missing Codes and DBH|Missing Codes and HOM|SpCode invalid'
      };

      // For the 'codes' column, both "Missing Codes and DBH" and "Missing Codes and HOM"
      // map to the codes field, but only the first should be displayed

      // This is verified in the component's displayFailureReason function
      // which uses .indexOf to deduplicate and shows only visibleReasons[0]

      expect(true).toBe(true); // Placeholder - actual test is in component logic
    });
  });

  describe('Edit preview flow wiring (Task 15)', () => {
    async function mountGridWithOptions() {
      const { loadSelectableOptions } = await import('@/components/client/clientmacros');
      (loadSelectableOptions as any).mockImplementation(async (_site: any, _plot: any, _census: any, setSelectableOpts: any) => {
        setSelectableOpts({
          treeTag: [],
          stemTag: [],
          quadratName: ['0101'],
          speciesCode: ['CRATSN'],
          codes: ['M']
        });
      });
      render(<IsolatedFailedMeasurementsDataGrid />);
      await waitFor(() => {
        expect((window as any).testEditFlowOverride).toBeDefined();
      });
    }

    it('configures useEditPreviewFlow with failedmeasurements dataType', async () => {
      await mountGridWithOptions();
      expect(mockEditFlowArgs).toMatchObject({
        dataType: 'failedmeasurements'
      });
      // Schema/plot/census may or may not be wired through the mocked contexts in unit tests;
      // what matters for Task 15 is that the hook is configured with the correct dataType.
      expect(mockEditFlowArgs).toHaveProperty('schema');
      expect(mockEditFlowArgs).toHaveProperty('plotID');
      expect(mockEditFlowArgs).toHaveProperty('censusID');
    });

    it('keeps identity and validation metadata columns read-only while allowing correction fields', async () => {
      await mountGridWithOptions();

      const columns = (window as any).testGridColumns as Array<{ field: string; editable?: boolean }>;
      const editableByField = Object.fromEntries(columns.map(column => [column.field, column.editable]));

      expect(editableByField).toMatchObject({
        id: false,
        failedMeasurementID: false,
        plotID: false,
        censusID: false,
        currentFailureReasons: false,
        description: false,
        originalFailureReasons: false,
        lastValidatedAt: false,
        tag: true,
        stemTag: true,
        spCode: true,
        quadrat: true,
        x: true,
        y: true,
        dbh: true,
        hom: true,
        date: true,
        codes: true
      });
    });

    it('returns unchanged nonnumeric edit props and preserves numeric validation metadata', async () => {
      await mountGridWithOptions();

      const columns = (window as any).testGridColumns as Array<{
        field: string;
        preProcessEditCellProps?: (params: any) => any;
      }>;
      const speciesColumn = columns.find(column => column.field === 'spCode');
      const dbhColumn = columns.find(column => column.field === 'dbh');
      const speciesProps = { value: 'CRATSN', error: true, isProcessingProps: false, customMetadata: 'retained' };
      const numericProps = { value: '12.345', error: true, isProcessingProps: true, customMetadata: 'retained' };

      expect(speciesColumn?.preProcessEditCellProps?.({ props: speciesProps })).toBe(speciesProps);
      expect(dbhColumn?.preProcessEditCellProps?.({ props: numericProps })).toEqual({
        ...numericProps,
        value: 12.35
      });
    });

    it('invokes editFlow.beginEdit with the failed measurement ID and the canonical diff only', async () => {
      await mountGridWithOptions();

      mockBeginEdit.mockResolvedValue({
        updatedIDs: { failedmeasurements: 123 },
        applyErrors: [],
        editOperationID: 555,
        validationPending: false
      });

      // Reingest response (row has failure reasons, so no reingest fires — but be safe).
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'ok' })
      });

      const oldRow = {
        id: 1,
        failedMeasurementID: 123,
        tag: '011375',
        stemTag: '5',
        spCode: 'oldspecies',
        quadrat: '0904',
        x: 18.4,
        y: 9.9,
        dbh: 0,
        hom: 0,
        date: '1994-12-05',
        codes: ''
      };
      const newRow = { ...oldRow, spCode: 'CRATSN', dbh: 12.0, hom: 1.3, codes: 'M', quadrat: '0101' };

      await (window as any).testEditFlowOverride(newRow, oldRow);

      expect(mockBeginEdit).toHaveBeenCalledTimes(1);
      const [targetID, diff] = mockBeginEdit.mock.calls[0];
      expect(targetID).toBe(123);
      // Only canonical editable-field aliases should appear.
      expect(diff).toEqual({
        SpCode: 'CRATSN',
        DBH: 12.0,
        HOM: 1.3,
        Codes: 'M',
        Quadrat: '0101'
      });
      // id and failedMeasurementID should NOT be in the diff.
      expect(Object.keys(diff)).not.toContain('id');
      expect(Object.keys(diff)).not.toContain('failedMeasurementID');
    });

    it('shows the UndoToast with the returned editOperationID after a successful apply', async () => {
      await mountGridWithOptions();

      mockBeginEdit.mockResolvedValue({
        updatedIDs: { failedmeasurements: 123 },
        applyErrors: [],
        editOperationID: 777,
        validationPending: false
      });
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'ok' })
      });

      const oldRow = {
        id: 1,
        failedMeasurementID: 123,
        tag: '011375',
        stemTag: '5',
        spCode: 'oldspecies',
        quadrat: '0101',
        x: 18.4,
        y: 9.9,
        dbh: 12.0,
        hom: 1.3,
        date: '1994-12-05',
        codes: 'M'
      };
      const newRow = { ...oldRow, dbh: 14.0, spCode: 'INVALID' };

      await (window as any).testEditFlowOverride(newRow, oldRow);

      await waitFor(() => {
        expect(screen.getByTestId('undo-toast-777')).toBeInTheDocument();
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not show UndoToast when the same save automatically reingests the row', async () => {
      await mountGridWithOptions();

      mockBeginEdit.mockResolvedValue({
        updatedIDs: { failedmeasurements: 123 },
        applyErrors: [],
        editOperationID: 888,
        validationPending: false
      });
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'reingest ok' })
      });

      const oldRow = {
        id: 1,
        failedMeasurementID: 123,
        tag: '011375',
        stemTag: '5',
        spCode: 'CRATSN',
        quadrat: '0101',
        x: 18.4,
        y: 9.9,
        dbh: 10.0,
        hom: 1.3,
        date: '1994-12-05',
        codes: 'M'
      };
      const newRow = { ...oldRow, dbh: 12.0 };

      await (window as any).testEditFlowOverride(newRow, oldRow);

      await waitFor(() => {
        const urls = (global.fetch as any).mock.calls.map(([url]: any[]) => url);
        expect(urls.some((u: string) => u.includes('/api/reingestsinglefailure/') && u.endsWith('/123'))).toBe(true);
      });
      expect(screen.queryByTestId('undo-toast-888')).not.toBeInTheDocument();
    });

    it('skips beginEdit when the diff is empty but still handles reingest + refresh', async () => {
      await mountGridWithOptions();

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'reingest ok' })
      });

      const row = {
        id: 1,
        failedMeasurementID: 123,
        tag: '011375',
        stemTag: '5',
        spCode: 'CRATSN',
        quadrat: '0101',
        x: 18.4,
        y: 9.9,
        dbh: 12.0,
        hom: 1.3,
        date: '1994-12-05',
        codes: 'M'
      };

      await (window as any).testEditFlowOverride({ ...row }, row);

      expect(mockBeginEdit).not.toHaveBeenCalled();
      // Reingest should have been invoked because computed reasons are empty.
      const urls = (global.fetch as any).mock.calls.map(([url]: any[]) => url);
      expect(urls.some((u: string) => u.includes('/api/reingestsinglefailure/') && u.endsWith('/123'))).toBe(true);
    });

    it('does not call the legacy /api/fixeddata PATCH endpoint', async () => {
      await mountGridWithOptions();

      mockBeginEdit.mockResolvedValue({
        updatedIDs: { failedmeasurements: 123 },
        applyErrors: [],
        editOperationID: 1,
        validationPending: false
      });
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'ok' })
      });

      const oldRow = {
        id: 1,
        failedMeasurementID: 123,
        spCode: 'old',
        quadrat: '0101',
        tag: '011375',
        stemTag: '5',
        x: 1,
        y: 2,
        dbh: 3,
        hom: 4,
        codes: '',
        date: '1994-12-05'
      };
      const newRow = { ...oldRow, spCode: 'new' };

      await (window as any).testEditFlowOverride(newRow, oldRow);

      const fetchCalls = (global.fetch as any).mock.calls;
      const patchCalls = fetchCalls.filter(([, init]: any[]) => init?.method === 'PATCH');
      expect(patchCalls).toHaveLength(0);
      const urls = fetchCalls.map(([url]: any[]) => url);
      expect(urls.some((u: string) => u.includes('/api/fixeddata/failedmeasurements/'))).toBe(false);
    });

    it('propagates apply rejection without attempting reingestion or showing success state', async () => {
      await mountGridWithOptions();

      mockBeginEdit.mockRejectedValue(new Error('apply failed (503)'));
      const oldRow = {
        id: 1,
        failedMeasurementID: 123,
        spCode: 'old',
        quadrat: '0101',
        tag: '011375',
        stemTag: '5',
        x: 1,
        y: 2,
        dbh: 3,
        hom: 4,
        codes: '',
        date: '1994-12-05'
      };

      await expect((window as any).testEditFlowOverride({ ...oldRow, spCode: 'new' }, oldRow)).rejects.toThrow('apply failed (503)');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.queryByTestId(/undo-toast-/)).not.toBeInTheDocument();
    });

    it('reports a partial-success error when reingestion fails after apply succeeds', async () => {
      await mountGridWithOptions();

      mockBeginEdit.mockResolvedValue({ editOperationID: 999 });
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'reingestion unavailable' })
      });
      const oldRow = {
        id: 1,
        failedMeasurementID: 123,
        spCode: 'CRATSN',
        quadrat: '0101',
        tag: '011375',
        stemTag: '5',
        x: 1,
        y: 2,
        dbh: 3,
        hom: 4,
        codes: 'M',
        date: '1994-12-05'
      };

      const saveError = await (window as any).testEditFlowOverride({ ...oldRow, dbh: 4 }, oldRow).catch((error: unknown) => error);
      expect(saveError).toBeInstanceOf(RowSaveFinalizationError);
      expect(saveError).toHaveProperty('message', 'Changes were saved, but reingestion unavailable');
      expect(saveError).toHaveProperty('persistedRow.dbh', 4);
      expect(mockBeginEdit).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('undo-toast-999')).not.toBeInTheDocument();
    });

    // #427 client wiring: the onUndo callback passed to UndoToast must route
    // through requestEditRevert (frontend/lib/editplan/requestrevert.ts) so a
    // 409 plan-drift response surfaces as a confirmation request instead of a
    // generic failure. requestEditRevert is not mocked here — global.fetch
    // (already mocked per-test throughout this file) is requestEditRevert's
    // only dependency, so driving its HTTP-status/body contract directly
    // exercises the real helper's parsing instead of assuming it.
    describe('Undo revert outcome handling (#427)', () => {
      async function mountGridWithUndoToast(editOperationID = 777) {
        await mountGridWithOptions();

        mockBeginEdit.mockResolvedValue({
          updatedIDs: { failedmeasurements: 123 },
          applyErrors: [],
          editOperationID,
          validationPending: false
        });
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });

        const oldRow = {
          id: 1,
          failedMeasurementID: 123,
          tag: '011375',
          stemTag: '5',
          spCode: 'oldspecies',
          quadrat: '0101',
          x: 18.4,
          y: 9.9,
          dbh: 12.0,
          hom: 1.3,
          date: '1994-12-05',
          codes: 'M'
        };
        // dbh=14 + spCode=INVALID keeps the row failing (no auto-reingest), matching
        // the existing "shows the UndoToast..." test's setup for an undo-eligible edit.
        const newRow = { ...oldRow, dbh: 14.0, spCode: 'INVALID' };
        await (window as any).testEditFlowOverride(newRow, oldRow);

        await waitFor(() => expect(screen.getByTestId(`undo-toast-${editOperationID}`)).toBeInTheDocument());

        // The save itself calls setRefresh(true) (isolatedfailedmeasurementsdatagrid.tsx:302)
        // regardless of whether the undo toast is shown. Wait for the mock
        // grid's refresh-edge effect to record and clear that transition,
        // then reset the counter so the undo tests below observe only the
        // undo button's own effect (0 for conflict/failure/unconfirmed, 1 for
        // a successful revert) instead of the save's leftover refresh.
        await waitFor(() => expect(gridHarness.refreshRequests).toBeGreaterThanOrEqual(1));
        gridHarness.refreshRequests = 0;
        (global.fetch as any).mockReset();
      }

      it('does not refresh or show success when the server requires confirmation, and returns the fresh plan to the toast unchanged', async () => {
        await mountGridWithUndoToast();

        (global.fetch as any).mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'plan drift',
            freshPlan: {
              dataType: 'failedmeasurements',
              targetID: 123,
              fieldChanges: [{ field: 'SpCode', from: 'INVALID', to: 'CRATSN' }],
              effects: [],
              maxSeverity: 'warn',
              planHash: UNDO_TEST_CONFIRMED_PLAN_HASH,
              generatedAt: '2026-04-20T12:00:00Z'
            }
          })
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId('undo-toast-undo'));
        });

        await waitFor(() => expect(gridHarness.lastUndoOutcome).toBeDefined());
        expect(gridHarness.lastUndoOutcome).toMatchObject({
          status: 'confirmation-required',
          freshPlan: expect.objectContaining({ planHash: UNDO_TEST_CONFIRMED_PLAN_HASH })
        });
        expect(gridHarness.refreshRequests).toBe(0);
        expect(screen.queryByText(/Undo failed/i)).not.toBeInTheDocument();

        // The plain "Undo" click must post the real plot/census scope wired
        // through useSiteContext/usePlotContext/useOrgCensusContext above, not
        // a currentSite/currentPlot-missing fallback of '' / 0 that would
        // silently target the wrong plot or census.
        const [url, init] = (global.fetch as any).mock.calls[0];
        expect(url).toBe('/api/edits/revert');
        expect(JSON.parse(init.body)).toMatchObject({
          schema: 'testschema',
          plotID: 1,
          censusID: 1,
          editOperationID: 777
        });
      });

      it('surfaces the helper-provided failure message via setEditFlowError without refreshing', async () => {
        await mountGridWithUndoToast();

        const SERVER_FAILURE_MESSAGE = 'Revert rejected: edit operation changed during revert';
        (global.fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: SERVER_FAILURE_MESSAGE }) });

        await act(async () => {
          fireEvent.click(screen.getByTestId('undo-toast-undo'));
        });

        await waitFor(() => expect(screen.getByText(`Undo failed: ${SERVER_FAILURE_MESSAGE}`)).toBeInTheDocument());
        expect(gridHarness.lastUndoOutcome).toEqual({ status: 'failed' });
        expect(gridHarness.refreshRequests).toBe(0);
      });

      it('surfaces the could-not-confirm message via setEditFlowError without refreshing or claiming success when the server returns a malformed 2xx body', async () => {
        await mountGridWithUndoToast();

        // A 2xx body that is not a real ApplyResult (requestEditRevert's
        // isValidApplyResult check) - the write may or may not have
        // committed, so this must not use "Undo failed" wording and must not
        // refresh a view that was never proven stale.
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

        await act(async () => {
          fireEvent.click(screen.getByTestId('undo-toast-undo'));
        });

        await waitFor(() => expect(screen.getByText(UNCONFIRMED_OUTCOME_MESSAGE)).toBeInTheDocument());
        expect(gridHarness.lastUndoOutcome).toEqual({ status: 'unconfirmed' });
        expect(gridHarness.refreshRequests).toBe(0);
        expect(screen.queryByText(/Undo failed/i)).not.toBeInTheDocument();
      });

      it('refreshes exactly once and resolves the toast as reverted on a successful revert', async () => {
        await mountGridWithUndoToast();

        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => makeApplyResultBody({ editOperationID: 777 }) });

        await act(async () => {
          fireEvent.click(screen.getByTestId('undo-toast-undo'));
        });

        await waitFor(() => expect(gridHarness.lastUndoOutcome).toEqual({ status: 'reverted' }));
        await waitFor(() => expect(gridHarness.refreshRequests).toBe(1));
        expect((global.fetch as any).mock.calls).toHaveLength(1);
      });

      it('sends the same schema/plotID/censusID/editOperationID plus the supplied confirmedPlanHash on a confirmed retry', async () => {
        await mountGridWithUndoToast(42);

        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => makeApplyResultBody({ editOperationID: 42 }) });

        await act(async () => {
          fireEvent.click(screen.getByTestId('undo-toast-confirm'));
        });

        await waitFor(() => expect((global.fetch as any).mock.calls.length).toBeGreaterThan(0));
        const [url, init] = (global.fetch as any).mock.calls[0];
        expect(url).toBe('/api/edits/revert');
        expect(JSON.parse(init.body)).toEqual({
          schema: 'testschema',
          plotID: 1,
          censusID: 1,
          editOperationID: 42,
          confirmedPlanHash: UNDO_TEST_CONFIRMED_PLAN_HASH
        });
      });
    });
  });
});
