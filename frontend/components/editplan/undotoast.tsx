'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import UndoIcon from '@mui/icons-material/Undo';
import ailogger from '@/ailogger';
import { EditPlan } from '@/config/editplan/types';
import { UNCONFIRMED_OUTCOME_MESSAGE } from '@/lib/editplan/requestrevert';
import PreviewDialog from './previewdialog';

// Mirrors requestrevert.ts's EditRevertOutcome; the call site owns the
// snackbar/error copy. `unconfirmed` is treated as terminal like `failed` —
// never implies success, never offers an automatic retry.
export type UndoRevertOutcome =
  | { status: 'reverted' }
  | { status: 'confirmation-required'; freshPlan: EditPlan }
  | { status: 'unconfirmed' }
  | { status: 'failed' };

interface UndoToastProps {
  editOperationID: number;
  onUndo: (confirmedPlanHash?: string) => Promise<UndoRevertOutcome>;
  onDismiss: () => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 12000;

export default function UndoToast({ editOperationID, onUndo, onDismiss, timeoutMs = DEFAULT_TIMEOUT_MS }: UndoToastProps) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [previewPlan, setPreviewPlan] = useState<EditPlan | null>(null);
  const [previewWasRefreshed, setPreviewWasRefreshed] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);

  const dismissCalledRef = useRef(false);
  const isMountedRef = useRef(true);
  // Synchronous re-entrance guard: `busy` state only takes effect on the next
  // render, which is too late to stop a second click handler invocation that
  // fires before React has re-rendered (e.g. userEvent.dblClick).
  const requestPendingRef = useRef(false);
  // Bumped whenever the operation this toast is bound to changes, so an
  // in-flight onUndo()/confirm() started for the previous editOperationID
  // can detect it is stale and must not touch state for the new one.
  const operationTokenRef = useRef(0);
  const previousEditOperationIDRef = useRef(editOperationID);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (previousEditOperationIDRef.current === editOperationID) return;
    previousEditOperationIDRef.current = editOperationID;
    operationTokenRef.current += 1;
    dismissCalledRef.current = false;
    requestPendingRef.current = false;
    setBusy(false);
    setPreviewPlan(null);
    setPreviewWasRefreshed(false);
    setUnexpectedError(null);
    setOpen(true);
  }, [editOperationID]);

  const triggerDismiss = useCallback(() => {
    if (dismissCalledRef.current) return;
    dismissCalledRef.current = true;
    setOpen(false);
    onDismiss();
  }, [onDismiss]);

  const handleUndoClick = useCallback(async () => {
    if (requestPendingRef.current || dismissCalledRef.current || previewPlan) return;
    requestPendingRef.current = true;
    const tokenAtStart = operationTokenRef.current;
    setBusy(true);
    setUnexpectedError(null);
    try {
      const outcome = await onUndo();
      if (!isMountedRef.current || operationTokenRef.current !== tokenAtStart) return;

      if (outcome.status === 'confirmation-required') {
        setPreviewWasRefreshed(false);
        setPreviewPlan(outcome.freshPlan);
        return;
      }
      triggerDismiss();
    } catch (error) {
      // onUndo() rejected rather than resolving an outcome; the server may
      // still have committed the revert, so report unconfirmed, never retry.
      const errorObj = error instanceof Error ? error : new Error(String(error));
      ailogger.error('UndoToast: onUndo rejected unexpectedly', errorObj);
      if (isMountedRef.current && operationTokenRef.current === tokenAtStart) {
        setUnexpectedError(UNCONFIRMED_OUTCOME_MESSAGE);
      }
    } finally {
      // Skip state updates if unmounted or the toast moved on to a new editOperationID.
      if (isMountedRef.current && operationTokenRef.current === tokenAtStart) {
        requestPendingRef.current = false;
        setBusy(false);
      }
    }
  }, [previewPlan, onUndo, triggerDismiss]);

  const handlePreviewConfirm = useCallback(async () => {
    if (requestPendingRef.current || !previewPlan || previewPlan.canApply === false) return;
    requestPendingRef.current = true;
    const tokenAtStart = operationTokenRef.current;
    const confirmedPlanHash = previewPlan.planHash;
    setBusy(true);
    setUnexpectedError(null);
    try {
      const outcome = await onUndo(confirmedPlanHash);
      if (!isMountedRef.current || operationTokenRef.current !== tokenAtStart) return;

      if (outcome.status === 'confirmation-required') {
        setPreviewWasRefreshed(true);
        setPreviewPlan(outcome.freshPlan);
        return;
      }
      setPreviewPlan(null);
      triggerDismiss();
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      ailogger.error('UndoToast: onUndo rejected unexpectedly during preview confirmation', errorObj);
      if (isMountedRef.current && operationTokenRef.current === tokenAtStart) {
        // Close the preview so the inline error message in the Snackbar is
        // visible, and drop the stale "refreshed" banner state with it.
        setPreviewPlan(null);
        setPreviewWasRefreshed(false);
        setUnexpectedError(UNCONFIRMED_OUTCOME_MESSAGE);
      }
    } finally {
      if (isMountedRef.current && operationTokenRef.current === tokenAtStart) {
        requestPendingRef.current = false;
        setBusy(false);
      }
    }
  }, [previewPlan, onUndo, triggerDismiss]);

  const handlePreviewCancel = useCallback(() => {
    if (busy) return;
    setPreviewPlan(null);
    setPreviewWasRefreshed(false);
  }, [busy]);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    // While unexpectedError is set it is the only explanation the user has
    // for why the undo did not complete; letting the timer auto-dismiss it
    // would silently remove that message with no way to recover it.
    if (busy || previewPlan || unexpectedError) return;
    const timer = setTimeout(() => {
      triggerDismiss();
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs, busy, previewPlan, unexpectedError, triggerDismiss]);

  return (
    <>
      <Snackbar
        open={open}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return;
          triggerDismiss();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        data-testid={`undo-toast-${editOperationID}`}
      >
        <Box sx={{ minWidth: 320, maxWidth: 480 }}>
          <Alert
            variant="soft"
            color="neutral"
            startDecorator={<UndoIcon />}
            endDecorator={
              // Non-overlapping action group: Undo and Dismiss are separate,
              // fully clickable siblings instead of a button under an
              // absolutely-positioned overlay.
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button
                  size="sm"
                  variant="solid"
                  color="primary"
                  onClick={handleUndoClick}
                  loading={busy}
                  disabled={busy || !!previewPlan}
                  data-testid="undo-toast-undo"
                >
                  Undo
                </Button>
                <IconButton variant="plain" size="sm" onClick={triggerDismiss} data-testid="undo-toast-dismiss" aria-label="Dismiss">
                  <CloseIcon />
                </IconButton>
              </Box>
            }
            sx={{ boxShadow: 'lg' }}
          >
            Edit #{editOperationID} applied.
          </Alert>
          {unexpectedError ? (
            <Alert variant="soft" color="danger" role="alert" data-testid="undo-toast-unexpected-error" sx={{ mt: 1, boxShadow: 'lg' }}>
              {unexpectedError}
            </Alert>
          ) : null}
        </Box>
      </Snackbar>
      {previewPlan ? (
        <PreviewDialog plan={previewPlan} onConfirm={handlePreviewConfirm} onCancel={handlePreviewCancel} busy={busy} wasRefreshed={previewWasRefreshed} />
      ) : null}
    </>
  );
}
