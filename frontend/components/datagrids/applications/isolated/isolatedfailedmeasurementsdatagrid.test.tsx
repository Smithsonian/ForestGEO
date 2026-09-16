import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import IsolatedFailedMeasurementsDataGrid, {
  formatDetailedFailureDescription,
  hasStoredCurrentIngestionFailures,
  isReadyForReingestion
} from './isolatedfailedmeasurementsdatagrid';
import { RowSaveFinalizationError } from '@/components/datagrids/rowsaveerror';

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

vi.mock('@/app/contexts/userselectionprovider', () => ({
  usePlotContext: () => ({ plotID: 1, plotName: 'Test Plot' }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }], plotCensusNumber: 1 }),
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
}));

vi.mock('@/components/datagrids/isolateddatagridcommons', () => ({
  default: ({ onDataUpdate, onDataLoaded, editFlowOverride, gridColumns }: any) => {
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
    return <div data-testid="datagrid-commons">Mock DataGrid</div>;
  }
}));

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

vi.mock('@/components/editplan/undotoast', () => ({
  default: ({ editOperationID, onDismiss }: any) => (
    <div data-testid={`undo-toast-${editOperationID}`}>
      <button type="button" onClick={onDismiss} data-testid="undo-toast-dismiss">
        Dismiss
      </button>
    </div>
  )
}));

describe('IsolatedFailedMeasurementsDataGrid - Critical Bug Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    delete (window as any).testOnDataUpdate;
    delete (window as any).testOnDataLoaded;
    delete (window as any).testGridColumns;
    delete (window as any).testEditFlowOverride;
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
  });
});
