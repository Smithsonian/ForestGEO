import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyResult, EditPlan } from '@/config/editplan/types';
import { useEditPreviewFlow, UseEditPreviewFlowArgs } from './useEditPreviewFlow';

const BASE_ARGS: UseEditPreviewFlowArgs = {
  schema: 'forestgeo_testing',
  plotID: 1,
  censusID: 2,
  dataType: 'measurementssummary',
  surface: 'measurements'
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
});
