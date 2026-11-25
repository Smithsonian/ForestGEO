import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyResult, EditPlan } from '@/config/editplan/types';
import { EditOperationCancelledError, useEditPreviewFlow, UseEditPreviewFlowArgs } from './useEditPreviewFlow';

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

const WARN_PLAN: EditPlan = { ...FRESH_PLAN, planHash: 'c'.repeat(64) };
const ROW_CENSUS_ID = 7;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('useEditPreviewFlow — per-call census and cancellation (spec Editing, P2-8, P2-13)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function applyCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/edits/apply'));
  }

  it('sends the per-call census on preview, apply and the confirmed apply after a 409', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INFO_PLAN))
      .mockResolvedValueOnce(jsonResponse({ freshPlan: FRESH_PLAN }, 409))
      .mockResolvedValueOnce(jsonResponse(APPLY_RESULT));
    const { result } = renderHook(() => useEditPreviewFlow(BASE_ARGS));
    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = result.current.beginEdit(42, { MeasuredDBH: 12 }, { censusID: ROW_CENSUS_ID });
    });
    await waitFor(() => expect(result.current.dialogState.open).toBe(true));
    await act(async () => {
      await result.current.confirmDialog();
    });
    await expect(editPromise).resolves.toEqual(APPLY_RESULT);
    const censusIDs = fetchMock.mock.calls.map((_call, index) => requestBody(fetchMock, index).censusID);
    console.log('[view-errors per-call census]', JSON.stringify(censusIDs));
    expect(censusIDs).toEqual([ROW_CENSUS_ID, ROW_CENSUS_ID, ROW_CENSUS_ID]);
  });

  it('returns none when nothing is pending', () => {
    const { result } = renderHook(() => useEditPreviewFlow(BASE_ARGS));
    expect(result.current.cancelPendingOperation()).toBe('none');
  });

  it('closes an open dialog, rejects with EditOperationCancelledError and sends no apply', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(WARN_PLAN));
    const { result } = renderHook(() => useEditPreviewFlow(BASE_ARGS));
    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = result.current.beginEdit(42, { MeasuredDBH: 12 });
    });
    await waitFor(() => expect(result.current.dialogState.open).toBe(true));
    let outcome = '';
    act(() => {
      outcome = result.current.cancelPendingOperation();
    });
    await expect(editPromise).rejects.toBeInstanceOf(EditOperationCancelledError);
    expect(outcome).toBe('cancelled-before-apply');
    expect(result.current.dialogState.open).toBe(false);
    expect(applyCalls()).toHaveLength(0);
  });

  it('aborts a preview in flight: no dialog, no apply, no onError', async () => {
    let previewSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          previewSignal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useEditPreviewFlow({ ...BASE_ARGS, onError }));
    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = result.current.beginEdit(42, { MeasuredDBH: 12 });
    });
    await waitFor(() => expect(previewSignal).toBeDefined());
    act(() => {
      expect(result.current.cancelPendingOperation()).toBe('cancelled-before-apply');
    });
    await expect(editPromise).rejects.toBeInstanceOf(EditOperationCancelledError);
    expect(previewSignal?.aborted).toBe(true);
    expect(result.current.dialogState.open).toBe(false);
    expect(applyCalls()).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
  });

  async function startConfirmedApply(onSuccess = vi.fn(), onError = vi.fn()) {
    const apply = deferred<Response>();
    fetchMock.mockResolvedValueOnce(jsonResponse(WARN_PLAN)).mockImplementationOnce(() => apply.promise);
    const hook = renderHook(() => useEditPreviewFlow({ ...BASE_ARGS, onSuccess, onError }));
    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = hook.result.current.beginEdit(42, { MeasuredDBH: 12 });
    });
    await waitFor(() => expect(hook.result.current.dialogState.open).toBe(true));
    let confirm!: Promise<void>;
    act(() => {
      confirm = hook.result.current.confirmDialog();
    });
    await waitFor(() => expect(applyCalls()).toHaveLength(1));
    return { hook, apply, editPromise, confirm, onSuccess, onError };
  }

  async function startAutoApply(onSuccess = vi.fn(), onError = vi.fn()) {
    const apply = deferred<Response>();
    fetchMock.mockResolvedValueOnce(jsonResponse(INFO_PLAN)).mockImplementationOnce(() => apply.promise);
    const hook = renderHook(() => useEditPreviewFlow({ ...BASE_ARGS, onSuccess, onError }));
    let editPromise!: Promise<ApplyResult>;
    act(() => {
      editPromise = hook.result.current.beginEdit(42, { MeasuredDBH: 12 });
    });
    await waitFor(() => expect(applyCalls()).toHaveLength(1));
    return { hook, apply, editPromise, onSuccess, onError };
  }

  it.each([
    ['a confirmed apply', startConfirmedApply],
    ['an auto-apply', startAutoApply]
  ])('drops a late 409 after %s was detached: no dialog, rejection, one apply', async (_label, start) => {
    const { hook, apply, editPromise } = await start();
    act(() => {
      expect(hook.result.current.cancelPendingOperation()).toBe('detached-apply');
    });
    await act(async () => {
      apply.resolve(jsonResponse({ freshPlan: FRESH_PLAN }, 409));
      await editPromise.catch(() => undefined);
    });
    await expect(editPromise).rejects.toBeInstanceOf(EditOperationCancelledError);
    expect(hook.result.current.dialogState.open).toBe(false);
    expect(applyCalls()).toHaveLength(1);
  });

  it.each([
    ['a confirmed apply', startConfirmedApply],
    ['an auto-apply', startAutoApply]
  ])('resolves a late success after %s was detached, opens nothing and skips onSuccess', async (_label, start) => {
    const { hook, apply, editPromise, onSuccess } = await start();
    act(() => {
      hook.result.current.cancelPendingOperation();
    });
    await act(async () => {
      apply.resolve(jsonResponse(APPLY_RESULT));
      await editPromise;
    });
    await expect(editPromise).resolves.toEqual(APPLY_RESULT);
    expect(hook.result.current.dialogState.open).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('rejects a late failure after detaching without calling onError', async () => {
    const { hook, apply, editPromise, onError } = await startConfirmedApply();
    act(() => {
      hook.result.current.cancelPendingOperation();
    });
    await act(async () => {
      apply.resolve(new Response('boom', { status: 500 }));
      await editPromise.catch(() => undefined);
    });
    await expect(editPromise).rejects.toThrow('boom');
    expect(onError).not.toHaveBeenCalled();
  });

  it('refuses a new edit while the detached apply is in flight, then runs one untouched by the old response', async () => {
    const { hook, apply, editPromise } = await startConfirmedApply();
    act(() => {
      hook.result.current.cancelPendingOperation();
    });
    await expect(hook.result.current.beginEdit(43, { MeasuredDBH: 13 })).rejects.toThrow('an edit is already pending');
    await act(async () => {
      apply.resolve(jsonResponse(APPLY_RESULT));
      await editPromise;
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(FRESH_PLAN));
    let second!: Promise<ApplyResult>;
    act(() => {
      second = hook.result.current.beginEdit(43, { MeasuredDBH: 13 });
    });
    await waitFor(() => expect(hook.result.current.dialogState.plan?.planHash).toBe(FRESH_PLAN.planHash));
    expect(hook.result.current.dialogState.open).toBe(true);
    act(() => {
      hook.result.current.cancelDialog();
    });
    await expect(second).rejects.toThrow('cancelled');
  });
});
