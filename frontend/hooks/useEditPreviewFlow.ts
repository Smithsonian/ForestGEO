'use client';

import { useCallback, useRef, useState } from 'react';
import { ApplyResult, EditPlan, EditPlanDataType } from '@/config/editplan/types';

const PREVIEW_ENDPOINT = '/api/edits/preview';
const APPLY_ENDPOINT = '/api/edits/apply';
const HASH_DRIFT_STATUS = 409;

export type EditSurface = 'measurements' | 'failedmeasurements' | 'errorsexplorer' | 'bulk';

export interface UseEditPreviewFlowArgs {
  schema: string;
  plotID: number;
  censusID: number;
  dataType: EditPlanDataType;
  surface: EditSurface;
  onSuccess?: (result: ApplyResult, plan: EditPlan) => void;
  onError?: (error: Error) => void;
}

export interface UseEditPreviewFlowReturn {
  beginEdit: (targetID: number, newRow: Record<string, unknown>) => Promise<ApplyResult>;
  dialogState: DialogState;
  cancelDialog: () => void;
  confirmDialog: () => Promise<void>;
}

export interface DialogState {
  open: boolean;
  plan: EditPlan | null;
  busy: boolean;
}

export class PreviewRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'PreviewRequestError';
  }
}

export class ApplyRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApplyRequestError';
  }
}

async function postPreview(body: Record<string, unknown>): Promise<EditPlan> {
  const response = await fetch(PREVIEW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new PreviewRequestError(response.status, text || `preview failed (${response.status})`);
  }
  return (await response.json()) as EditPlan;
}

interface ApplyResponseSuccess {
  kind: 'ok';
  result: ApplyResult;
}

interface ApplyResponseConflict {
  kind: 'conflict';
  freshPlan: EditPlan;
}

async function postApply(body: Record<string, unknown>): Promise<ApplyResponseSuccess | ApplyResponseConflict> {
  const response = await fetch(APPLY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (response.status === HASH_DRIFT_STATUS) {
    const payload = (await response.json().catch(() => null)) as { freshPlan?: EditPlan } | null;
    if (!payload?.freshPlan) {
      throw new ApplyRequestError(response.status, 'plan hash mismatch without fresh plan');
    }
    return { kind: 'conflict', freshPlan: payload.freshPlan };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new ApplyRequestError(response.status, text || `apply failed (${response.status})`);
  }
  const result = (await response.json()) as ApplyResult;
  return { kind: 'ok', result };
}

interface PendingEditRef {
  targetID: number;
  newRow: Record<string, unknown>;
  resolve: (result: ApplyResult) => void;
  reject: (err: Error) => void;
}

export function useEditPreviewFlow(args: UseEditPreviewFlowArgs): UseEditPreviewFlowReturn {
  const { schema, plotID, censusID, dataType, onSuccess, onError } = args;
  const [dialogState, setDialogState] = useState<DialogState>({ open: false, plan: null, busy: false });
  const pendingRef = useRef<PendingEditRef | null>(null);

  const buildRequestBody = useCallback(
    (targetID: number, newRow: Record<string, unknown>, planHash?: string) => ({
      schema,
      plotID,
      censusID,
      dataType,
      targetID,
      newRow,
      ...(planHash ? { planHash } : {})
    }),
    [schema, plotID, censusID, dataType]
  );

  const executeApply = useCallback(
    async (plan: EditPlan, targetID: number, newRow: Record<string, unknown>): Promise<ApplyResponseSuccess | ApplyResponseConflict> => {
      return postApply(buildRequestBody(targetID, newRow, plan.planHash));
    },
    [buildRequestBody]
  );

  const cancelDialog = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setDialogState({ open: false, plan: null, busy: false });
    if (pending) {
      pending.reject(new Error('cancelled'));
    }
  }, []);

  const confirmDialog = useCallback(async () => {
    const pending = pendingRef.current;
    const currentPlan = dialogState.plan;
    if (!pending || !currentPlan) return;

    setDialogState(prev => ({ ...prev, busy: true }));
    try {
      const applyResponse = await executeApply(currentPlan, pending.targetID, pending.newRow);
      if (applyResponse.kind === 'conflict') {
        setDialogState({ open: true, plan: applyResponse.freshPlan, busy: false });
        return;
      }

      const { result } = applyResponse;
      pendingRef.current = null;
      setDialogState({ open: false, plan: null, busy: false });
      if (onSuccess) onSuccess(result, currentPlan);
      pending.resolve(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      pendingRef.current = null;
      setDialogState({ open: false, plan: null, busy: false });
      if (onError) onError(error);
      pending.reject(error);
    }
  }, [dialogState.plan, executeApply, onError, onSuccess]);

  const beginEdit = useCallback(
    async (targetID: number, newRow: Record<string, unknown>): Promise<ApplyResult> => {
      if (pendingRef.current) {
        throw new Error('an edit is already pending');
      }

      let plan: EditPlan;
      try {
        plan = await postPreview(buildRequestBody(targetID, newRow));
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (onError) onError(error);
        throw error;
      }

      if (plan.maxSeverity === 'info') {
        try {
          const applyResponse = await executeApply(plan, targetID, newRow);
          if (applyResponse.kind === 'conflict') {
            return new Promise<ApplyResult>((resolve, reject) => {
              pendingRef.current = { targetID, newRow, resolve, reject };
              setDialogState({ open: true, plan: applyResponse.freshPlan, busy: false });
            });
          }

          const { result } = applyResponse;
          if (onSuccess) onSuccess(result, plan);
          return result;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (onError) onError(error);
          throw error;
        }
      }

      return new Promise<ApplyResult>((resolve, reject) => {
        pendingRef.current = { targetID, newRow, resolve, reject };
        setDialogState({ open: true, plan, busy: false });
      });
    },
    [buildRequestBody, executeApply, onError, onSuccess]
  );

  return { beginEdit, dialogState, cancelDialog, confirmDialog };
}
