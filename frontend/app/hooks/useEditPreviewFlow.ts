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
  /** The row's own physical census; defaults to the census the hook was created with. */
  censusID?: number;
}

/** What cancelPendingOperation found: nothing, an operation it cancelled before any apply, or an apply it could only detach. */
export type CancelPendingOperationResult = 'none' | 'cancelled-before-apply' | 'detached-apply';

export interface UseEditPreviewFlowReturn {
  beginEdit: (targetID: number, newRow: Record<string, unknown>, options?: BeginEditOptions) => Promise<ApplyResult>;
  dialogState: DialogState;
  cancelDialog: () => void;
  confirmDialog: () => Promise<void>;
  cancelPendingOperation: () => CancelPendingOperationResult;
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

export class EditOperationCancelledError extends Error {
  constructor() {
    super('The edit was cancelled before it was applied');
    this.name = 'EditOperationCancelledError';
  }
}

const CLOSED_DIALOG_STATE: DialogState = { open: false, plan: null, busy: false, wasRefreshed: false };

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function postPreview(body: Record<string, unknown>, signal: AbortSignal): Promise<EditPlan> {
  const response = await fetch(PREVIEW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
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
  censusID: number;
  /** The operation generation it belongs to; a later cancelPendingOperation() advances the current one. */
  generation: number;
  resolve: (result: ApplyResult) => void;
  reject: (err: Error) => void;
}

export function useEditPreviewFlow(args: UseEditPreviewFlowArgs): UseEditPreviewFlowReturn {
  const { schema, plotID, censusID, dataType, onSuccess, onError, onBlockingBusyChange } = args;
  const [dialogState, setDialogState] = useState<DialogState>(CLOSED_DIALOG_STATE);
  const pendingRef = useRef<PendingEditRef | null>(null);
  const beginEditInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const previewControllerRef = useRef<AbortController | null>(null);
  const applyInFlightRef = useRef(false);

  const buildRequestBody = useCallback(
    (targetID: number, newRow: Record<string, unknown>, callDataType: EditPlanDataType, callCensusID: number, planHash?: string) => ({
      schema,
      plotID,
      censusID: callCensusID,
      dataType: callDataType,
      targetID,
      newRow,
      ...(planHash ? { planHash } : {})
    }),
    [schema, plotID]
  );

  const executeApply = useCallback(
    async (plan: EditPlan, targetID: number, newRow: Record<string, unknown>, callDataType: EditPlanDataType, callCensusID: number) => {
      applyInFlightRef.current = true;
      try {
        return await postApply(buildRequestBody(targetID, newRow, callDataType, callCensusID, plan.planHash));
      } finally {
        applyInFlightRef.current = false;
      }
    },
    [buildRequestBody]
  );

  const releasePending = useCallback((pending: PendingEditRef) => {
    if (pendingRef.current === pending) pendingRef.current = null;
  }, []);

  const cancelDialog = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setDialogState(CLOSED_DIALOG_STATE);
    if (pending) {
      pending.reject(new Error('cancelled'));
    }
  }, []);

  const cancelPendingOperation = useCallback((): CancelPendingOperationResult => {
    if (applyInFlightRef.current) {
      // The apply can't be recalled: detach the UI only. pendingRef (a confirmed apply) or
      // beginEditInFlightRef (an auto-apply) stays set as the guard until the response arrives.
      generationRef.current += 1;
      setDialogState(CLOSED_DIALOG_STATE);
      return 'detached-apply';
    }
    const pending = pendingRef.current;
    const previewController = previewControllerRef.current;
    if (!pending && !previewController) return 'none';
    generationRef.current += 1;
    if (previewController) {
      previewControllerRef.current = null;
      previewController.abort();
    }
    if (pending) {
      pendingRef.current = null;
      setDialogState(CLOSED_DIALOG_STATE);
      pending.reject(new EditOperationCancelledError());
    }
    return 'cancelled-before-apply';
  }, []);

  const confirmDialog = useCallback(async () => {
    const pending = pendingRef.current;
    const currentPlan = dialogState.plan;
    if (!pending || !currentPlan) return;
    if (currentPlan.canApply === false) return;

    setDialogState(prev => ({ ...prev, busy: true }));
    try {
      const applyResponse = await executeApply(currentPlan, pending.targetID, pending.newRow, pending.dataType, pending.censusID);
      const detached = pending.generation !== generationRef.current;
      if (applyResponse.kind === 'conflict') {
        if (detached) {
          releasePending(pending);
          pending.reject(new EditOperationCancelledError());
          return;
        }
        setDialogState({ open: true, plan: applyResponse.freshPlan, busy: false, wasRefreshed: true });
        return;
      }

      releasePending(pending);
      if (!detached) {
        setDialogState(CLOSED_DIALOG_STATE);
        if (onSuccess) onSuccess(applyResponse.result, currentPlan);
      }
      pending.resolve(applyResponse.result);
    } catch (err) {
      const error = toError(err);
      const detached = pending.generation !== generationRef.current;
      releasePending(pending);
      if (!detached) {
        setDialogState(CLOSED_DIALOG_STATE);
        if (onError) onError(error);
      }
      pending.reject(error);
    }
  }, [dialogState.plan, executeApply, onError, onSuccess, releasePending]);

  const beginEdit = useCallback(
    async (targetID: number, newRow: Record<string, unknown>, options?: BeginEditOptions): Promise<ApplyResult> => {
      if (pendingRef.current || beginEditInFlightRef.current) {
        throw new Error('an edit is already pending');
      }
      beginEditInFlightRef.current = true;

      const generation = generationRef.current;
      const isDetached = () => generation !== generationRef.current;
      const callDataType: EditPlanDataType = options?.dataType ?? dataType;
      const callCensusID = options?.censusID ?? censusID;
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
      const previewController = new AbortController();
      previewControllerRef.current = previewController;
      try {
        setBlockingBusy(true);
        plan = await postPreview(buildRequestBody(targetID, newRow, callDataType, callCensusID), previewController.signal);
      } catch (err) {
        finishBlockingPhase();
        if (isDetached()) throw new EditOperationCancelledError();
        const error = toError(err);
        if (onError) onError(error);
        throw error;
      } finally {
        if (previewControllerRef.current === previewController) previewControllerRef.current = null;
      }
      if (isDetached()) {
        finishBlockingPhase();
        throw new EditOperationCancelledError();
      }

      if (plan.maxSeverity === 'info' && plan.canApply !== false) {
        let applyResponse: ApplyResponseSuccess | ApplyResponseConflict;
        try {
          applyResponse = await executeApply(plan, targetID, newRow, callDataType, callCensusID);
        } catch (err) {
          finishBlockingPhase();
          const error = toError(err);
          if (!isDetached() && onError) onError(error);
          throw error;
        }
        finishBlockingPhase();
        if (applyResponse.kind === 'conflict') {
          if (isDetached()) throw new EditOperationCancelledError();
          const freshPlan = applyResponse.freshPlan;
          return new Promise<ApplyResult>((resolve, reject) => {
            pendingRef.current = { targetID, newRow, dataType: callDataType, censusID: callCensusID, generation, resolve, reject };
            setDialogState({ open: true, plan: freshPlan, busy: false, wasRefreshed: true });
          });
        }
        if (!isDetached() && onSuccess) onSuccess(applyResponse.result, plan);
        return applyResponse.result;
      }

      finishBlockingPhase();
      return new Promise<ApplyResult>((resolve, reject) => {
        pendingRef.current = { targetID, newRow, dataType: callDataType, censusID: callCensusID, generation, resolve, reject };
        setDialogState({ open: true, plan, busy: false, wasRefreshed: false });
      });
    },
    [buildRequestBody, censusID, dataType, executeApply, onBlockingBusyChange, onError, onSuccess]
  );

  return { beginEdit, dialogState, cancelDialog, confirmDialog, cancelPendingOperation };
}
