import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getUploadedCodesValue, hasCodesMismatch, joinCodesArray, parseCodesString } from './errorsexplorer';
import type { EditPlan } from '@/config/editplan/types';
import type { UseEditPreviewFlowReturn } from '@/hooks/useEditPreviewFlow';

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
});

// ---- ErrorsExplorer row-edit flow integration ---------------------------------------------

const TEST_SCHEMA = 'forestgeo_testing_mason';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 6;
const TEST_CORE_MEASUREMENT_ID = 101;
const TEST_EDIT_OPERATION_ID = 555;
const TEST_PLAN_HASH_INITIAL = 'a'.repeat(64);
const TEST_PLAN_HASH_REFRESH = 'b'.repeat(64);

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
  hasContradiction: false,
  contradictionTypes: [],
  contradictionType: null,
  contradictionGroupKey: null,
  relatedMeasurementIDs: []
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

const mockFetch = vi.fn();
const mockBeginEdit = vi.fn();
const mockConfirmDialog = vi.fn();
const mockCancelDialog = vi.fn();

let currentDialogState: UseEditPreviewFlowReturn['dialogState'] = { open: false, plan: null, busy: false };
let lastEditFlowArgs: Record<string, unknown> | null = null;

function setDialogState(nextState: UseEditPreviewFlowReturn['dialogState']) {
  currentDialogState = nextState;
}

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: TEST_SCHEMA }),
  usePlotContext: () => ({ plotID: TEST_PLOT_ID }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: TEST_CENSUS_ID }] })
}));

vi.mock('@/components/client/clientmacros', () => ({
  loadSelectableOptions: vi.fn(async () => undefined)
}));

vi.mock('@/components/errors/contradictioncomparisonpanel', () => ({
  default: () => <div data-testid="contradiction-panel" />
}));

vi.mock('@mui/x-data-grid', () => ({
  GridActionsCellItem: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  GridRowEditStopReasons: { rowFocusOut: 'rowFocusOut' },
  GridRowModes: { Edit: 'edit', View: 'view' }
}));

vi.mock('@/components/editplan/previewdialog', () => ({
  default: ({ plan, onConfirm, onCancel, busy }: { plan: EditPlan; onConfirm: () => void; onCancel: () => void; busy: boolean }) => (
    <div data-testid="preview-dialog" data-plan-hash={plan.planHash} data-busy={String(busy)}>
      <button type="button" data-testid="preview-confirm" onClick={onConfirm}>
        Apply
      </button>
      <button type="button" data-testid="preview-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}));

vi.mock('@/components/editplan/undotoast', () => ({
  default: ({ editOperationID, onUndo, onDismiss }: { editOperationID: number; onUndo: () => Promise<void>; onDismiss: () => void }) => (
    <div data-testid={`undo-toast-${editOperationID}`}>
      <button type="button" data-testid="undo-toast-undo" onClick={() => void onUndo()}>
        Undo
      </button>
      <button type="button" data-testid="undo-toast-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}));

vi.mock('@/hooks/useEditPreviewFlow', () => ({
  useEditPreviewFlow: (args: Record<string, unknown>): UseEditPreviewFlowReturn => {
    lastEditFlowArgs = args;
    return {
      beginEdit: mockBeginEdit as unknown as UseEditPreviewFlowReturn['beginEdit'],
      confirmDialog: mockConfirmDialog as unknown as UseEditPreviewFlowReturn['confirmDialog'],
      cancelDialog: mockCancelDialog as unknown as UseEditPreviewFlowReturn['cancelDialog'],
      dialogState: currentDialogState
    };
  }
}));

vi.mock('@/config/styleddatagrid', async () => {
  const ReactModule = await import('react');

  function StyledDataGridMock(props: any) {
    const rows = (props.rows || []) as Array<Record<string, unknown>>;
    const columns = props.columns || [];

    // Expose a test hook that fires processRowUpdate with a modified row.
    ReactModule.useEffect(() => {
      (globalThis as any).__triggerRowUpdate = async (rowID: number, newRow: Record<string, unknown>) => {
        const oldRow = rows.find(row => Number(row.id) === Number(rowID));
        if (!oldRow || !props.processRowUpdate) return undefined;
        return props.processRowUpdate(newRow, oldRow);
      };
    }, [rows, props.processRowUpdate]);

    return (
      <div data-testid="styled-grid">
        <div data-testid="row-state">{JSON.stringify(rows)}</div>
        {rows.map(row => {
          const actionColumn = columns.find((col: any) => typeof col.getActions === 'function');
          if (!actionColumn) return null;
          return (
            <div key={String(row.id)}>
              {actionColumn.getActions({ id: row.id, row }).map((action: React.ReactNode, idx: number) => (
                <React.Fragment key={idx}>{action}</React.Fragment>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return { StyledDataGrid: StyledDataGridMock };
});

async function mountExplorer() {
  const mod = await import('./errorsexplorer');
  const ErrorsExplorer = mod.default;
  return render(<ErrorsExplorer />);
}

describe('ErrorsExplorer — row edit via shared preview flow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    currentDialogState = { open: false, plan: null, busy: false };
    lastEditFlowArgs = null;

    const { loadSelectableOptions } = await import('@/components/client/clientmacros');
    (loadSelectableOptions as any).mockImplementation(async () => undefined);

    const localStorageStore = new Map<string, string>();
    const localStorageStub: Storage = {
      get length() {
        return localStorageStore.size;
      },
      clear: () => localStorageStore.clear(),
      getItem: (key: string) => (localStorageStore.has(key) ? (localStorageStore.get(key) as string) : null),
      key: (index: number) => Array.from(localStorageStore.keys())[index] ?? null,
      removeItem: (key: string) => {
        localStorageStore.delete(key);
      },
      setItem: (key: string, value: string) => {
        localStorageStore.set(key, String(value));
      }
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageStub, configurable: true });

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/errors/explorer/query')) {
        return {
          ok: true,
          json: async () => ({
            rows: [GRID_ROW],
            totalRows: 1,
            summary: { total: 1, validation: 1, ingestion: 0, contradictions: 0, duplicateTagStem: 0, sameBatchConflict: 0 }
          })
        } as Response;
      }
      if (url.includes('/api/errors/explorer/facets')) {
        return {
          ok: true,
          json: async () => ({
            messages: [],
            fields: [],
            sourceCounts: { validation: 1, ingestion: 0 },
            contradictionCounts: { duplicateTagStem: 0, sameBatchConflict: 0 }
          })
        } as Response;
      }
      if (url.includes('/api/refreshviews/')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes('/api/edits/revert')) {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    delete (globalThis as any).__triggerRowUpdate;
  });

  it('configures the edit flow with the current scope and surface identifier', async () => {
    await mountExplorer();
    await waitFor(() => expect(lastEditFlowArgs).not.toBeNull());
    expect(lastEditFlowArgs).toMatchObject({
      schema: TEST_SCHEMA,
      plotID: TEST_PLOT_ID,
      censusID: TEST_CENSUS_ID,
      dataType: 'measurementssummary',
      surface: 'errorsexplorer'
    });
  });

  it('does not call the legacy PATCH endpoint when a row is saved', async () => {
    mockBeginEdit.mockResolvedValue({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"coreMeasurementID":101'));

    const editedRow = { ...GRID_ROW, measuredDBH: 12 };
    await act(async () => {
      await (globalThis as any).__triggerRowUpdate(TEST_CORE_MEASUREMENT_ID, editedRow);
    });

    const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);

    const urlsCalled = mockFetch.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.toString()));
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
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"coreMeasurementID":101'));

    // Edit two editable fields AND a non-editable internal identifier; only editable fields should flow through.
    const editedRow = {
      ...GRID_ROW,
      measuredDBH: 12,
      attributes: 'L;M',
      treeID: 999999
    };
    await act(async () => {
      await (globalThis as any).__triggerRowUpdate(TEST_CORE_MEASUREMENT_ID, editedRow);
    });

    expect(mockBeginEdit).toHaveBeenCalledTimes(1);
    const [targetID, diff] = mockBeginEdit.mock.calls[0];
    expect(targetID).toBe(TEST_CORE_MEASUREMENT_ID);
    expect(diff).toEqual({ MeasuredDBH: 12, Attributes: 'L;M' });
    expect(Object.keys(diff)).not.toContain('TreeID');
    expect(Object.keys(diff)).not.toContain('CoreMeasurementID');
  });

  it('shows the UndoToast after a successful edit and no-ops if the edit returned no operation ID', async () => {
    mockBeginEdit.mockResolvedValueOnce({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"coreMeasurementID":101'));

    await act(async () => {
      await (globalThis as any).__triggerRowUpdate(TEST_CORE_MEASUREMENT_ID, { ...GRID_ROW, measuredDBH: 12 });
    });

    await waitFor(() => expect(screen.getByTestId(`undo-toast-${TEST_EDIT_OPERATION_ID}`)).toBeInTheDocument());
  });

  it('renders the PreviewDialog using the current dialogState and refreshes the fresh plan on 409 drift', async () => {
    // Simulate the flow needing confirmation: open the dialog with an initial plan.
    currentDialogState = { open: true, plan: makePlan({ planHash: TEST_PLAN_HASH_INITIAL }), busy: false };

    const { rerender } = await mountExplorer();
    await waitFor(() => expect(screen.getByTestId('preview-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('preview-dialog').getAttribute('data-plan-hash')).toBe(TEST_PLAN_HASH_INITIAL);

    // A 409 conflict causes the hook to swap in a fresh plan (different planHash).
    currentDialogState = { open: true, plan: makePlan({ planHash: TEST_PLAN_HASH_REFRESH }), busy: false };
    const mod = await import('./errorsexplorer');
    const ErrorsExplorer = mod.default;
    rerender(<ErrorsExplorer />);

    await waitFor(() => expect(screen.getByTestId('preview-dialog').getAttribute('data-plan-hash')).toBe(TEST_PLAN_HASH_REFRESH));
  });

  it('wires the PreviewDialog Apply button to the flow.confirmDialog callback', async () => {
    currentDialogState = { open: true, plan: makePlan(), busy: false };
    await mountExplorer();

    fireEvent.click(screen.getByTestId('preview-confirm'));
    expect(mockConfirmDialog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('preview-cancel'));
    expect(mockCancelDialog).toHaveBeenCalledTimes(1);
  });

  it('undo toast Undo button calls /api/edits/revert with the scope and edit operation ID', async () => {
    mockBeginEdit.mockResolvedValueOnce({
      updatedIDs: { coreMeasurementID: TEST_CORE_MEASUREMENT_ID },
      applyErrors: [],
      editOperationID: TEST_EDIT_OPERATION_ID,
      validationPending: false
    });

    await mountExplorer();
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"coreMeasurementID":101'));

    await act(async () => {
      await (globalThis as any).__triggerRowUpdate(TEST_CORE_MEASUREMENT_ID, { ...GRID_ROW, measuredDBH: 12 });
    });

    await waitFor(() => expect(screen.getByTestId(`undo-toast-${TEST_EDIT_OPERATION_ID}`)).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('undo-toast-undo'));
    });

    await waitFor(() => {
      const revertCall = mockFetch.mock.calls.find(([input]) => (typeof input === 'string' ? input : input.toString()).includes('/api/edits/revert'));
      expect(revertCall).toBeTruthy();
      const body = JSON.parse((revertCall as [unknown, { body: string }])[1].body);
      expect(body).toMatchObject({
        schema: TEST_SCHEMA,
        plotID: TEST_PLOT_ID,
        censusID: TEST_CENSUS_ID,
        editOperationID: TEST_EDIT_OPERATION_ID
      });
    });
  });

  it('skips the preview flow entirely when the diff is empty', async () => {
    await mountExplorer();
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"coreMeasurementID":101'));

    await act(async () => {
      await (globalThis as any).__triggerRowUpdate(TEST_CORE_MEASUREMENT_ID, { ...GRID_ROW });
    });

    expect(mockBeginEdit).not.toHaveBeenCalled();
  });
});
