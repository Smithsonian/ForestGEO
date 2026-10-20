// Issue #518: View Data phantom edits (sub-precision / shape-only diffs) and silently
// discarded negative DBH. These tests drive the real save path: the shared diff helper,
// runMeasurementEditSave (what the grid's save handler calls) over the real
// useEditPreviewFlow with a mocked fetch, the EditMeasurements cell editor, the column
// preprocessor and the server-side analyzer guard.
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
// setup.ts installs lightweight platform mocks for database definitions; restore the real
// exports the column definitions read at module load.
vi.mock('@/lib/db/definitions/views', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/core', async importOriginal => await importOriginal());

import { useEditPreviewFlow } from '@/app/hooks/useEditPreviewFlow';
import { MeasurementsSummaryViewGridColumns, preprocessor } from '@/components/client/datagridcolumns';
import { EditMeasurements } from './measurementscommons';
import {
  buildEditableFieldsDiffWithMetaForSurface,
  decideMeasurementEditSave,
  MeasurementEditValidationError,
  NO_CHANGE_SAVED_MESSAGE,
  PARTIAL_ROUNDED_MESSAGE,
  runMeasurementEditSave
} from './measurementscommonsutils';
import { assertNonNegativeFields, InvalidFieldValueError } from '@/config/editplan/fieldpolicy';
import type { ApplyResult, EditPlan } from '@/config/editplan/types';

// MySQL returns DECIMAL(12,6) columns as strings; the cell editor writes numbers.
const STORED_ROW = {
  id: 1,
  coreMeasurementID: 101,
  speciesCode: 'ACRU',
  treeTag: 'T-1',
  stemTag: 'S-1',
  quadratName: '0101',
  stemLocalX: '3.500000',
  stemLocalY: '4.250000',
  stemPlotX: null,
  stemPlotY: null,
  measurementDate: '2026-01-01',
  measuredDBH: '12.340000',
  measuredHOM: '0.000000',
  description: null,
  attributes: 'L'
};

const INFO_PLAN: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 101,
  fieldChanges: [{ field: 'MeasuredDBH', from: 12.34, to: 15 }],
  effects: [],
  maxSeverity: 'info',
  planHash: 'a'.repeat(64),
  generatedAt: '2026-10-20T00:00:00.000Z'
};
const APPLY_RESULT: ApplyResult = { updatedIDs: { coremeasurements: 101 }, applyErrors: [], editOperationID: 77, validationPending: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('shared diff: aliased numeric fields with differing shapes (root cause of phantom edits)', () => {
  it('does not treat string-vs-number, null-vs-zero-string or sub-precision values as changes', () => {
    const newRow = {
      ...STORED_ROW,
      stemLocalX: 3.5, // '3.500000' -> number, same value
      stemLocalY: 4.25,
      measuredHOM: null, // EditMeasurements writes null for 0; stored '0.000000'
      measuredDBH: 12.34
    };
    const result = buildEditableFieldsDiffWithMetaForSurface(newRow, STORED_ROW, 'measurementssummary');
    expect(result.diff).toEqual({});
  });

  it('reports a sub-precision DBH change as a rounded no-op against a stored string, not a diff', () => {
    const result = buildEditableFieldsDiffWithMetaForSurface({ ...STORED_ROW, measuredDBH: 12.341 }, STORED_ROW, 'measurementssummary');
    expect(result.diff).toEqual({});
    expect(result.roundedNoOpFields).toEqual(['MeasuredDBH']);
  });

  it('still returns a genuine edit when other numeric fields only differ by shape', () => {
    const result = buildEditableFieldsDiffWithMetaForSurface(
      { ...STORED_ROW, stemLocalX: 3.5, measuredHOM: null, measuredDBH: 15 },
      STORED_ROW,
      'measurementssummary'
    );
    expect(result.diff).toEqual({ MeasuredDBH: 15 });
  });

  it('does not report a missing stored value as a rounded zero', () => {
    const result = buildEditableFieldsDiffWithMetaForSurface({ ...STORED_ROW, stemPlotX: 0.001 }, STORED_ROW, 'measurementssummary');
    expect(result.diff).toEqual({ StemPlotX: 0.001 });
    expect(result.roundedNoOpFields).toEqual([]);
  });
});

describe('decideMeasurementEditSave', () => {
  it('flags negative DBH as invalid before any diffing', () => {
    const decision = decideMeasurementEditSave({ ...STORED_ROW, measuredDBH: -5 }, STORED_ROW);
    expect(decision.kind).toBe('invalid');
    if (decision.kind === 'invalid') expect(decision.errors).toEqual([{ field: 'measuredDBH', message: 'DBH must be non-negative' }]);
  });

  it('keeps zero/null DBH semantics: zero is not negative and null stays a no-op', () => {
    expect(decideMeasurementEditSave({ ...STORED_ROW, measuredDBH: 0 }, STORED_ROW).kind).not.toBe('invalid');
    expect(decideMeasurementEditSave({ ...STORED_ROW, measuredDBH: null }, STORED_ROW)).toEqual({ kind: 'unchanged', roundedNoOpFields: [] });
  });
});

describe('runMeasurementEditSave through the real edit preview flow (mocked fetch)', () => {
  const fetchMock = vi.fn();
  let notify: ReturnType<typeof vi.fn>;
  let onEditOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    notify = vi.fn();
    onEditOperation = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const { result } = renderHook(() => useEditPreviewFlow({ schema: 'forestgeo_testing', plotID: 1, censusID: 2, dataType: 'measurementssummary' }));
    return (newRow: Record<string, unknown>) =>
      runMeasurementEditSave({ coreMeasurementID: 101, newRow, oldRow: STORED_ROW, beginEdit: result.current.beginEdit, notify, onEditOperation });
  }

  it('sub-precision DBH edit: no preview, no apply, no edit op, no Undo, "No change saved" feedback, grid keeps the stored value', async () => {
    const save = setup();
    const saved = await save({ ...STORED_ROW, measuredDBH: 12.341 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onEditOperation).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(NO_CHANGE_SAVED_MESSAGE(['MeasuredDBH']), 'info');
    expect(notify).not.toHaveBeenCalledWith('Row updated!', 'success');
    expect(saved.measuredDBH).toBe('12.340000');
  });

  it('shape-only changes to other fields do not reach the server', async () => {
    const save = setup();
    await save({ ...STORED_ROW, stemLocalX: 3.5, stemLocalY: 4.25, measuredHOM: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onEditOperation).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('Row updated!', 'success');
  });

  it('negative DBH: rejected with an inline error, never persisted, no toast of success, no edit op', async () => {
    const save = setup();
    await expect(save({ ...STORED_ROW, measuredDBH: -5 })).rejects.toBeInstanceOf(MeasurementEditValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onEditOperation).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Error: DBH must be non-negative', 'error');
    expect(notify).not.toHaveBeenCalledWith('Row updated!', 'success');
  });

  it('genuine DBH edit alongside shape-only fields sends only the real change and offers Undo', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(INFO_PLAN)).mockResolvedValueOnce(jsonResponse(APPLY_RESULT));
    const save = setup();
    await save({ ...STORED_ROW, measuredDBH: 15, stemLocalX: 3.5, measuredHOM: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const previewBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(previewBody.newRow).toEqual({ MeasuredDBH: 15 });
    expect(onEditOperation).toHaveBeenCalledWith(77);
    expect(notify).toHaveBeenCalledWith('Row updated!', 'success');
  });

  it('mixed rounded + real edit saves the real part and tells the user the rounded part was kept', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(INFO_PLAN)).mockResolvedValueOnce(jsonResponse(APPLY_RESULT));
    const save = setup();
    const saved = await save({ ...STORED_ROW, measuredDBH: 12.341, measuredHOM: 2 });
    const previewBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(previewBody.newRow).toEqual({ MeasuredHOM: 2 });
    expect(saved.measuredDBH).toBe('12.340000');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(PARTIAL_ROUNDED_MESSAGE(['MeasuredDBH']), 'info');
    expect(notify).not.toHaveBeenCalledWith('Row updated!', 'success');
    expect(saved.measuredHOM).toBe(2);
  });

  it('mixed blank + real edit submits only the real change and returns persisted values for omitted fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(INFO_PLAN)).mockResolvedValueOnce(jsonResponse(APPLY_RESULT));
    const save = setup();
    const saved = await save({ ...STORED_ROW, measuredDBH: null, measuredHOM: 2 });
    const previewBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(previewBody.newRow).toEqual({ MeasuredHOM: 2 });
    expect(saved.measuredDBH).toBe('12.340000');
    expect(saved.measuredHOM).toBe(2);
  });

  it('mixed rounded + real edit: cancelled preview emits no applied notice', async () => {
    const beginEdit = vi.fn().mockRejectedValue(new Error('cancelled'));
    await expect(
      runMeasurementEditSave({
        coreMeasurementID: 101,
        newRow: { ...STORED_ROW, measuredDBH: 12.341, measuredHOM: 2 },
        oldRow: STORED_ROW,
        beginEdit,
        notify,
        onEditOperation
      })
    ).rejects.toThrow('cancelled');
    expect(notify).not.toHaveBeenCalled();
    expect(onEditOperation).not.toHaveBeenCalled();
  });

  it('mixed rounded + real edit: server failure emits no applied notice', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    const save = setup();
    await expect(save({ ...STORED_ROW, measuredDBH: 12.341, measuredHOM: 2 })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  it('offers no Undo when the server recorded no edit operation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(INFO_PLAN)).mockResolvedValueOnce(jsonResponse({ ...APPLY_RESULT, editOperationID: null }));
    const save = setup();
    await save({ ...STORED_ROW, measuredDBH: 15 });
    expect(onEditOperation).not.toHaveBeenCalled();
  });

  it('surfaces a server error (e.g. 422 from a bypassed browser check) instead of reporting success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid field value', field: 'MeasuredDBH' }, 422));
    const save = setup();
    await expect(save({ ...STORED_ROW, measuredDBH: 15 })).rejects.toThrow();
    expect(onEditOperation).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('Row updated!', 'success');
  });
});

describe('EditMeasurements DBH cell editor', () => {
  function renderEditor(field: string, value: unknown) {
    const setEditCellValue = vi.fn().mockResolvedValue(true);
    const params = { id: 1, field, value, api: { setEditCellValue } } as unknown as GridRenderEditCellParams;
    render(<EditMeasurements params={params} />);
    return { setEditCellValue, input: screen.getByLabelText('edit measurements input') as HTMLInputElement };
  }

  it('keeps a typed minus sign visible, flags it inline and pushes the invalid value into the grid edit state', () => {
    const { input, setEditCellValue } = renderEditor('measuredDBH', 12.34);
    fireEvent.change(input, { target: { value: '-5' } });
    expect(input.value).toBe('-5');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.closest('[title]')?.getAttribute('title')).toBe('DBH must be non-negative');
    expect(setEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'measuredDBH', value: -5 });
  });

  it('does not write NaN on blur of an incomplete value', () => {
    const { input, setEditCellValue } = renderEditor('measuredDBH', 12.34);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(setEditCellValue).not.toHaveBeenCalled();
  });

  it('preserves zero-to-null on blur', () => {
    const { input, setEditCellValue } = renderEditor('measuredDBH', 12.34);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(setEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'measuredDBH', value: null });
  });

  it('still rejects typed minus signs for non-DBH fields as before', () => {
    const { input } = renderEditor('stemLocalX', 3.5);
    fireEvent.change(input, { target: { value: '-5' } });
    expect(input.value).toBe('3.50');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('View Data column preprocessors (real column definitions)', () => {
  // MUI calls column.preProcessEditCellProps without the field name, so drive the actual columns.
  const call = (field: string, value: unknown) => {
    const column = MeasurementsSummaryViewGridColumns.find(c => c.field === field);
    return (column?.preProcessEditCellProps as (p: never) => { error?: boolean })({ id: 1, row: {}, hasChanged: true, props: { value } } as never);
  };

  it('marks a negative DBH cell as errored so MUI keeps the row in edit mode', () => {
    expect(call('measuredDBH', -5).error).toBe(true);
    expect(call('measuredDBH', '-5').error).toBe(true);
  });

  it('clears the DBH error when the value is corrected in the same edit session (carried-forward props)', () => {
    const column = MeasurementsSummaryViewGridColumns.find(c => c.field === 'measuredDBH');
    const pre = column?.preProcessEditCellProps as (p: never) => { error?: boolean; value?: unknown };
    const first = pre({ id: 1, row: {}, hasChanged: true, props: { value: -5 } } as never);
    expect(first.error).toBe(true);
    for (const corrected of [5, 0, '7.5']) {
      const next = pre({ id: 1, row: {}, hasChanged: true, props: { ...first, value: corrected } } as never);
      expect(next.error).toBe(false);
    }
  });

  it('leaves valid DBH and other numeric cells unflagged', () => {
    expect(call('measuredDBH', 12.34).error).toBeFalsy();
    expect(call('measuredDBH', 0).error).toBeFalsy();
    expect(call('stemLocalX', -3.5).error).toBeFalsy();
    expect(preprocessor({ id: 1, row: {}, hasChanged: true, props: { value: -5 } } as never).error).toBeFalsy();
  });
});

describe('server-side non-negative guard', () => {
  it('rejects a negative DBH with InvalidFieldValueError (browser checks bypassed)', () => {
    expect(() => assertNonNegativeFields({ MeasuredDBH: -5 })).toThrow(InvalidFieldValueError);
  });

  it('accepts zero, positive DBH and negative non-DBH fields', () => {
    expect(() => assertNonNegativeFields({ MeasuredDBH: 0, MeasuredHOM: -1, StemLocalX: -2 })).not.toThrow();
  });
});
