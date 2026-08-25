'use client';

import { useCallback, useRef, useState } from 'react';
import { ApplyResult, EditPlan, EditPlanDataType } from '@/config/editplan/types';

const PREVIEW_ENDPOINT = '/api/edits/preview';
const APPLY_ENDPOINT = '/api/edits/apply';
const HASH_DRIFT_STATUS = 409;

export interface UseEditPreviewFlowArgs {
  schema: string;
  plotID: number;
  censusID: number;
  dataType: EditPlanDataType;
  onSuccess?: (result: ApplyResult, plan: EditPlan) => void;
  onError?: (error: Error) => void;
  onBlockingBusyChange?: (busy: boolean) => void;
}

export interface BeginEditOptions {
  // Per-call override for dataType. Required when a single grid mixes
  // measurementssummary and failedmeasurements rows (e.g. ErrorsExplorer).
  // When omitted, the hook falls back to the dataType passed at hook init.
  dataType?: EditPlanDataType;
}

export interface UseEditPreviewFlowReturn {
  beginEdit: (targetID: number, newRow: Record<string, unknown>, options?: BeginEditOptions) => Promise<ApplyResult>;
  dialogState: DialogState;
  cancelDialog: () => void;
  confirmDialog: () => Promise<void>;
}

export interface DialogState {
  open: boolean;
  plan: EditPlan | null;
  busy: boolean;
  // True when the dialog is showing a fresh plan that replaced an earlier
  // one because of a 409 hash-drift response. Resets to false on each new
  // beginEdit. PreviewDialog uses this to render a banner and reset the
  // typed-confirm input.
  wasRefreshed: boolean;
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
  dataType: EditPlanDataType;
  resolve: (result: ApplyResult) => void;
  reject: (err: Error) => void;
}

export function useEditPreviewFlow(args: UseEditPreviewFlowArgs): UseEditPreviewFlowReturn {
  const { schema, plotID, censusID, dataType, onSuccess, onError, onBlockingBusyChange } = args;
  const [dialogState, setDialogState] = useState<DialogState>({ open: false, plan: null, busy: false, wasRefreshed: false });
  const pendingRef = useRef<PendingEditRef | null>(null);
  const beginEditInFlightRef = useRef(false);

  const buildRequestBody = useCallback(
    (targetID: number, newRow: Record<string, unknown>, callDataType: EditPlanDataType, planHash?: string) => ({
      schema,
      plotID,
      censusID,
      dataType: callDataType,
      targetID,
      newRow,
      ...(planHash ? { planHash } : {})
    }),
    [schema, plotID, censusID]
  );

  const executeApply = useCallback(
    async (
      plan: EditPlan,
      targetID: number,
      newRow: Record<string, unknown>,
      callDataType: EditPlanDataType
    ): Promise<ApplyResponseSuccess | ApplyResponseConflict> => {
      return postApply(buildRequestBody(targetID, newRow, callDataType, plan.planHash));
    },
    [buildRequestBody]
  );

  const cancelDialog = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setDialogState({ open: false, plan: null, busy: false, wasRefreshed: false });
    if (pending) {
      pending.reject(new Error('cancelled'));
    }
  }, []);

  const confirmDialog = useCallback(async () => {
    const pending = pendingRef.current;
    const currentPlan = dialogState.plan;
    if (!pending || !currentPlan) return;
    if (currentPlan.canApply === false) return;

    setDialogState(prev => ({ ...prev, busy: true }));
    try {
      const applyResponse = await executeApply(currentPlan, pending.targetID, pending.newRow, pending.dataType);
      if (applyResponse.kind === 'conflict') {
        setDialogState({ open: true, plan: applyResponse.freshPlan, busy: false, wasRefreshed: true });
        return;
      }

      const { result } = applyResponse;
      pendingRef.current = null;
      setDialogState({ open: false, plan: null, busy: false, wasRefreshed: false });
      if (onSuccess) onSuccess(result, currentPlan);
      pending.resolve(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      pendingRef.current = null;
      setDialogState({ open: false, plan: null, busy: false, wasRefreshed: false });
      if (onError) onError(error);
      pending.reject(error);
    }
  }, [dialogState.plan, executeApply, onError, onSuccess]);

  const beginEdit = useCallback(
    async (targetID: number, newRow: Record<string, unknown>, options?: BeginEditOptions): Promise<ApplyResult> => {
      if (pendingRef.current || beginEditInFlightRef.current) {
        throw new Error('an edit is already pending');
      }
      beginEditInFlightRef.current = true;

      const callDataType: EditPlanDataType = options?.dataType ?? dataType;
      let blockingBusy = false;
      const setBlockingBusy = (busy: boolean) => {
        if (blockingBusy === busy) return;
        blockingBusy = busy;
        onBlockingBusyChange?.(busy);
      };
      const finishBlockingPhase = () => {
        beginEditInFlightRef.current = false;
        setBlockingBusy(false);
      };

      let plan: EditPlan;
      try {
        setBlockingBusy(true);
        plan = await postPreview(buildRequestBody(targetID, newRow, callDataType));
      } catch (err) {
        finishBlockingPhase();
        const error = err instanceof Error ? err : new Error(String(err));
        if (onError) onError(error);
        throw error;
      }

      if (plan.maxSeverity === 'info' && plan.canApply !== false) {
        try {
          const applyResponse = await executeApply(plan, targetID, newRow, callDataType);
          if (applyResponse.kind === 'conflict') {
            finishBlockingPhase();
            return new Promise<ApplyResult>((resolve, reject) => {
              pendingRef.current = { targetID, newRow, dataType: callDataType, resolve, reject };
              setDialogState({ open: true, plan: applyResponse.freshPlan, busy: false, wasRefreshed: true });
            });
          }

          const { result } = applyResponse;
          finishBlockingPhase();
          if (onSuccess) onSuccess(result, plan);
          return result;
        } catch (err) {
          finishBlockingPhase();
          const error = err instanceof Error ? err : new Error(String(err));
          if (onError) onError(error);
          throw error;
        }
      }

      finishBlockingPhase();
      return new Promise<ApplyResult>((resolve, reject) => {
        pendingRef.current = { targetID, newRow, dataType: callDataType, resolve, reject };
        setDialogState({ open: true, plan, busy: false, wasRefreshed: false });
      });
    },
    [buildRequestBody, dataType, executeApply, onBlockingBusyChange, onError, onSuccess]
  );

  return { beginEdit, dialogState, cancelDialog, confirmDialog };
}
