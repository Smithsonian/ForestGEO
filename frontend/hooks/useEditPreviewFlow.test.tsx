import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyResult, EditPlan } from '@/config/editplan/types';
import { useEditPreviewFlow, UseEditPreviewFlowArgs } from './useEditPreviewFlow';

const BASE_ARGS: UseEditPreviewFlowArgs = {
  schema: 'forestgeo_testing',
  plotID: 1,
  censusID: 2,
  dataType: 'measurementssummary'
};

const INFO_PLAN: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 42,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [],
  maxSeverity: 'info',
  planHash: 'a'.repeat(64),
  generatedAt: '2026-04-21T00:00:00.000Z'
};

const FRESH_PLAN: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 42,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [
    {
      id: 'linked-stem',
      severity: 'warn',
      category: 'cross-row',
      title: 'Changed linked stem',
      detail: 'A linked stem would also change.',
      affectedTable: 'stems',
      affectedRowCount: 1
    }
  ],
  maxSeverity: 'warn',
  planHash: 'b'.repeat(64),
  generatedAt: '2026-04-21T00:00:01.000Z'
};

const APPLY_RESULT: ApplyResult = {
  updatedIDs: { coremeasurements: 42 },
  applyErrors: [],
  editOperationID: 9,
  validationPending: false
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[callIndex][1] as RequestInit).body as string);
}

describe('useEditPreviewFlow', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a 409 fresh plan open for renewed confirmation instead of auto-applying it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INFO_PLAN))
      .mockResolvedValueOnce(jsonResponse({ freshPlan: FRESH_PLAN }, 409))
      .mockResolvedValueOnce(jsonResponse(APPLY_RESULT));

    const { result } = renderHook(() => useEditPreviewFlow(BASE_ARGS));

    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = result.current.beginEdit(42, { MeasuredDBH: 12 });
    });

    await waitFor(() => expect(result.current.dialogState.open).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.dialogState.plan?.planHash).toBe(FRESH_PLAN.planHash);
    expect(requestBody(fetchMock, 1).planHash).toBe(INFO_PLAN.planHash);

    await act(async () => {
      await result.current.confirmDialog();
    });

    await expect(editPromise).resolves.toEqual(APPLY_RESULT);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchMock, 2).planHash).toBe(FRESH_PLAN.planHash);
    expect(result.current.dialogState.open).toBe(false);
  });

  it('uses a per-call dataType override for both preview and apply', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...INFO_PLAN, dataType: 'failedmeasurements' })).mockResolvedValueOnce(jsonResponse(APPLY_RESULT));

    const { result } = renderHook(() => useEditPreviewFlow(BASE_ARGS));

    let editResult!: ApplyResult;
    await act(async () => {
      editResult = await result.current.beginEdit(42, { SpCode: 'NEWSP' }, { dataType: 'failedmeasurements' });
    });

    expect(editResult).toEqual(APPLY_RESULT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0)).toMatchObject({
      dataType: 'failedmeasurements',
      targetID: 42,
      newRow: { SpCode: 'NEWSP' }
    });
    expect(requestBody(fetchMock, 1)).toMatchObject({
      dataType: 'failedmeasurements',
      targetID: 42,
      newRow: { SpCode: 'NEWSP' },
      planHash: INFO_PLAN.planHash
    });
  });

  it('reports blocking busy while previewing and auto-applying an info-only edit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(INFO_PLAN)).mockResolvedValueOnce(jsonResponse(APPLY_RESULT));
    const onBlockingBusyChange = vi.fn();

    const { result } = renderHook(() => useEditPreviewFlow({ ...BASE_ARGS, onBlockingBusyChange }));

    await act(async () => {
      await result.current.beginEdit(42, { MeasuredDBH: 12 });
    });

    expect(onBlockingBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(result.current.dialogState.open).toBe(false);
  });

  it('rejects overlapping edits while preview and auto-apply are in flight', async () => {
    let resolvePreview!: (response: Response) => void;
    const previewResponse = new Promise<Response>(resolve => {
      resolvePreview = resolve;
    });
    fetchMock.mockReturnValueOnce(previewResponse).mockResolvedValueOnce(jsonResponse(APPLY_RESULT));
    const onBlockingBusyChange = vi.fn();

    const { result } = renderHook(() => useEditPreviewFlow({ ...BASE_ARGS, onBlockingBusyChange }));

    let firstEdit!: Promise<ApplyResult>;
    act(() => {
      firstEdit = result.current.beginEdit(42, { MeasuredDBH: 12 });
    });

    await waitFor(() => expect(onBlockingBusyChange).toHaveBeenCalledWith(true));
    await expect(result.current.beginEdit(43, { MeasuredDBH: 13 })).rejects.toThrow('an edit is already pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolvePreview(jsonResponse(INFO_PLAN));
    await act(async () => {
      await expect(firstEdit).resolves.toEqual(APPLY_RESULT);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onBlockingBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('clears blocking busy before opening a review dialog', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FRESH_PLAN));
    const onBlockingBusyChange = vi.fn();

    const { result } = renderHook(() => useEditPreviewFlow({ ...BASE_ARGS, onBlockingBusyChange }));

    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = result.current.beginEdit(42, { MeasuredDBH: 12 });
    });

    await waitFor(() => expect(result.current.dialogState.open).toBe(true));
    expect(onBlockingBusyChange.mock.calls).toEqual([[true], [false]]);

    act(() => {
      result.current.cancelDialog();
    });
    await expect(editPromise).rejects.toThrow('cancelled');
  });

  it('opens review instead of auto-applying an info-severity plan with blocking errors', async () => {
    const blockedPlan: EditPlan = {
      ...INFO_PLAN,
      canApply: false,
      errors: [
        {
          kind: 'RoleForbiddenField',
          field: 'SpeciesCode',
          role: 'field crew',
          message: 'SpeciesCode can only be edited by global or db admin users.',
          severity: 'destructive',
          blocking: true
        }
      ]
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(blockedPlan));

    const { result } = renderHook(() => useEditPreviewFlow(BASE_ARGS));

    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = result.current.beginEdit(42, { SpeciesCode: 'BB' });
    });

    await waitFor(() => expect(result.current.dialogState.open).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.dialogState.plan?.canApply).toBe(false);

    act(() => {
      result.current.cancelDialog();
    });
    await expect(editPromise).rejects.toThrow('cancelled');
  });
});
