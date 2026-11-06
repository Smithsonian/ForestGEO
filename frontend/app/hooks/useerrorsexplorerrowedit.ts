'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GridRowModel, GridRowModesModel } from '@mui/x-data-grid';
import { EditOperationCancelledError, useEditPreviewFlow } from '@/app/hooks/useEditPreviewFlow';
import { buildEditableFieldsDiffWithMetaForSurface, revertEditAndRefresh } from '@/components/datagrids/measurementscommonsutils';
import type { UndoRevertOutcome } from '@/components/editplan/undotoast';
import type { RefreshOptions } from '@/components/datagrids/hooks/useinfinitegridrows';
import { isMuiRowEditCancelled } from '@/lib/muirowedit';
import {
  detailsActionLockReason,
  editEntryLockReason,
  editLockTooltip,
  isCellEditableUnderLock,
  owningGridLockReason,
  pageControlLockReason,
  resolveRowModesModelChange,
  undoLockReason,
  type EditLock
} from '@/lib/errorsexplorer/editlock';
import {
  addPendingScope,
  isSameMutationScope,
  removePendingScope,
  requestMeasurementViewRebuilds,
  requestScopeViewRebuilds,
  scopeOverlapsRead
} from '@/lib/errorsexplorer/viewrebuilds';
import { EDIT_LOCK_TOOLTIPS, VIEW_ERRORS_ALERTS, type ErrorExplorerRow, type ErrorsExplorerReadScope, type RowMutationScope } from '@/config/errorsexplorer';
import type { ApplyResult } from '@/config/editplan/types';
import ailogger from '@/ailogger';

const DEFAULT_DATA_TYPE = 'measurementssummary';
const FAILED_ROW_DATA_TYPE = 'failedmeasurements';
const UNKNOWN_TAG = '—';

export interface ErrorsExplorerUndoState {
  editOperationID: number;
  mutationScope: RowMutationScope;
  /** The edited row: the undo rebuilds its stored views (r3.1, R4). */
  coreMeasurementID: number;
}

/** An Undo or a Clear that owns the page until its rebuild and read refresh settle (P2-3). */
export type PageMutationKind = 'undo' | 'clear';

/** The lock plus the edit operation it belongs to: one counter value per edit entry, not the ledger's editOperationID (r3, P2-7). */
export interface RowEditLock extends EditLock {
  operationID: number;
}

/** The operation whose completion may still patch rows or enter `refreshing`; a census change ends it for good (r3, P2-7). */
interface PageContinuation {
  operationID: number;
  readScopeKey: string;
}

export interface UseErrorsExplorerRowEditArgs {
  readScope: ErrorsExplorerReadScope | null;
  readScopeKey: string;
  /** Facets, every registered grid and the open sheet; settles when every read has settled, rejects only when strict. */
  refreshAllReads: (options?: RefreshOptions) => Promise<void>;
  patchRowEverywhere: (row: ErrorExplorerRow) => void;
  showPageAlert: (message: string) => void;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isSameOperation(candidate: RowEditLock | null, target: RowEditLock): boolean {
  return candidate !== null && candidate.operationID === target.operationID;
}

/**
 * The one rule both beginPageMutation and the Undo/Clear disabled reasons use (r3, P2-8): another mutation, or any lock
 * that is not refreshing, including a detached saving lock from the census just left, which page controls ignore.
 */
function pageMutationBlockedReason(lock: EditLock | null, mutationBusy: PageMutationKind | null): string | null {
  if (mutationBusy !== null) return EDIT_LOCK_TOOLTIPS.saving;
  return lock !== null && lock.phase !== 'refreshing' ? editLockTooltip(lock.phase) : null;
}

export function useErrorsExplorerRowEdit({ readScope, readScopeKey, refreshAllReads, patchRowEverywhere, showPageAlert }: UseErrorsExplorerRowEditArgs) {
  const editFlow = useEditPreviewFlow({
    schema: readScope?.schema ?? '',
    plotID: readScope?.plotID ?? 0,
    censusID: readScope?.censusID ?? 0,
    dataType: DEFAULT_DATA_TYPE
  });

  const [lock, setLockState] = useState<RowEditLock | null>(null);
  const lockRef = useRef<RowEditLock | null>(null);
  const nextOperationIDRef = useRef(0);
  const pageContinuationRef = useRef<PageContinuation | null>(null);
  const setLock = useCallback((next: RowEditLock | null) => {
    lockRef.current = next;
    setLockState(next);
  }, []);
  const [undo, setUndo] = useState<ErrorsExplorerUndoState | null>(null);
  const undoRef = useRef<ErrorsExplorerUndoState | null>(null);
  undoRef.current = undo;
  const [pendingViewRebuilds, setPendingViewRebuildsState] = useState<RowMutationScope[]>([]);
  const pendingRef = useRef<RowMutationScope[]>([]);
  const setPendingViewRebuilds = useCallback((next: RowMutationScope[]) => {
    pendingRef.current = next;
    setPendingViewRebuildsState(next);
  }, []);
  const [mutationBusy, setMutationBusyState] = useState<PageMutationKind | null>(null);
  const mutationBusyRef = useRef<PageMutationKind | null>(null);
  const setMutationBusy = useCallback((next: PageMutationKind | null) => {
    mutationBusyRef.current = next;
    setMutationBusyState(next);
  }, []);

  const readScopeRef = useRef(readScope);
  readScopeRef.current = readScope;
  const readScopeKeyRef = useRef(readScopeKey);
  readScopeKeyRef.current = readScopeKey;
  const refreshAllReadsRef = useRef(refreshAllReads);
  refreshAllReadsRef.current = refreshAllReads;
  const patchRowEverywhereRef = useRef(patchRowEverywhere);
  patchRowEverywhereRef.current = patchRowEverywhere;
  const showPageAlertRef = useRef(showPageAlert);
  showPageAlertRef.current = showPageAlert;
  const cancelPendingOperationRef = useRef(editFlow.cancelPendingOperation);
  cancelPendingOperationRef.current = editFlow.cancelPendingOperation;
  const isMountedRef = useRef(true);
  const unmountedOwnerOperationIDRef = useRef<number | null>(null);

  const ownsPageContinuation = useCallback(
    (operation: RowEditLock) => isMountedRef.current && pageContinuationRef.current?.operationID === operation.operationID,
    []
  );

  const recordPendingRebuild = useCallback(
    (scope: RowMutationScope) => {
      setPendingViewRebuilds(addPendingScope(pendingRef.current, scope));
    },
    [setPendingViewRebuilds]
  );

  const startReadRefresh = useCallback(() => {
    const current = lockRef.current;
    if (!current || current.phase !== 'refreshing' || current.readsStarted) return;
    const started = { ...current, readsStarted: true };
    setLock(started);
    void refreshAllReadsRef.current().finally(() => {
      if (isSameOperation(lockRef.current, started)) setLock(null);
    });
  }, [setLock]);

  const handleRowModesModelChange = useCallback(
    (gridKey: string, nextModel: GridRowModesModel, findRow: (rowID: number) => ErrorExplorerRow | undefined): GridRowModesModel => {
      const current = lockRef.current;
      const resolution = resolveRowModesModelChange(current, readScopeKeyRef.current, gridKey, nextModel, mutationBusyRef.current !== null);
      if (resolution.kind === 'acquire') {
        const row = findRow(resolution.rowID);
        const scope = readScopeRef.current;
        if (!row || !scope) return {};
        nextOperationIDRef.current += 1;
        const operationID = nextOperationIDRef.current;
        pageContinuationRef.current = { operationID, readScopeKey: readScopeKeyRef.current };
        setLock({
          operationID,
          gridKey,
          rowID: resolution.rowID,
          phase: 'editing',
          mutationScope: { schema: scope.schema, plotID: scope.plotID, censusID: Number(row.censusID) },
          readScopeKey: readScopeKeyRef.current,
          treeTag: row.treeTag ?? UNKNOWN_TAG,
          stemTag: row.stemTag ?? UNKNOWN_TAG,
          readsStarted: false,
          applyCommitted: false
        });
      } else if (resolution.kind === 'left' && current) {
        if (current.phase === 'editing') setLock(null);
        else if (current.phase === 'refreshing') startReadRefresh();
      }
      return resolution.model;
    },
    [setLock, startReadRefresh]
  );

  const handleGridUnmount = useCallback(
    (gridKey: string) => {
      const current = lockRef.current;
      if (current?.gridKey === gridKey) unmountedOwnerOperationIDRef.current = current.operationID;
      if (!current || current.gridKey !== gridKey || current.readScopeKey !== readScopeKeyRef.current) return;
      if (current.phase === 'editing') setLock(null);
      else if (current.phase === 'refreshing') startReadRefresh();
    },
    [setLock, startReadRefresh]
  );

  const completeCommittedSave = useCallback(
    async (savingLock: RowEditLock, editedRow: ErrorExplorerRow, originalRow: ErrorExplorerRow, applyResult: ApplyResult): Promise<GridRowModel> => {
      const updatedRow: ErrorExplorerRow = {
        ...editedRow,
        rawCodes: editedRow.attributes !== originalRow.attributes ? editedRow.attributes : editedRow.rawCodes
      };
      const lockAtSave: RowEditLock = { ...savingLock, applyCommitted: true };
      const editedMeasurementID = Number(originalRow.coreMeasurementID);
      const holdsLock = () => isSameOperation(lockRef.current, lockAtSave);
      if (holdsLock()) setLock(lockAtSave);
      if (isMountedRef.current && applyResult.editOperationID !== null) {
        setUndo({ editOperationID: applyResult.editOperationID, mutationScope: lockAtSave.mutationScope, coreMeasurementID: editedMeasurementID });
      }
      if (ownsPageContinuation(lockAtSave)) patchRowEverywhereRef.current(updatedRow);

      try {
        await requestMeasurementViewRebuilds(lockAtSave.mutationScope, [editedMeasurementID]);
      } catch (error: unknown) {
        if (isMountedRef.current) {
          recordPendingRebuild(lockAtSave.mutationScope);
          showPageAlertRef.current(VIEW_ERRORS_ALERTS.savedButRefreshFailed(toError(error).message));
        }
        if (holdsLock()) setLock(null);
        return updatedRow;
      }

      // Only this operation, still holding the lock in the scope it started in, may enter refreshing; a census change
      // ended its continuation even if the user has come back, and a newer edit's lock is never replaced (r3, P2-7).
      if (!ownsPageContinuation(lockAtSave) || !holdsLock()) {
        if (holdsLock()) setLock(null);
        return updatedRow;
      }
      setLock({ ...lockAtSave, phase: 'refreshing', readsStarted: false });
      return updatedRow;
    },
    [ownsPageContinuation, recordPendingRebuild, setLock]
  );

  const processRowUpdate = useCallback(
    (gridKey: string) =>
      async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
        const editedRow = newRow as ErrorExplorerRow;
        const originalRow = oldRow as ErrorExplorerRow;
        const current = lockRef.current;
        if (!current || current.gridKey !== gridKey || current.rowID !== Number(originalRow.id)) {
          throw new Error('This row is not the one being edited');
        }
        const surface = originalRow.isFailedRow ? FAILED_ROW_DATA_TYPE : DEFAULT_DATA_TYPE;
        const { diff, roundedNoOpFields } = buildEditableFieldsDiffWithMetaForSurface(newRow, oldRow, surface);
        if (Object.keys(diff).length === 0) {
          if (roundedNoOpFields.length > 0) showPageAlertRef.current(VIEW_ERRORS_ALERTS.roundedNoOp(roundedNoOpFields));
          return newRow;
        }

        const lockAtSave: RowEditLock = { ...current, phase: 'saving' };
        setLock(lockAtSave);
        let applyResult: ApplyResult;
        try {
          applyResult = await editFlow.beginEdit(Number(originalRow.coreMeasurementID), diff, {
            dataType: surface,
            censusID: lockAtSave.mutationScope.censusID
          });
        } catch (error: unknown) {
          const stillLocked = isSameOperation(lockRef.current, lockAtSave);
          const detached = !ownsPageContinuation(lockAtSave);
          const ownerUnmounted = unmountedOwnerOperationIDRef.current === lockAtSave.operationID;
          if (stillLocked && detached) {
            setLock(null);
            if (isMountedRef.current) showPageAlertRef.current(VIEW_ERRORS_ALERTS.editCancelledByCensusChange(lockAtSave.treeTag, lockAtSave.stemTag));
            throw new EditOperationCancelledError();
          }
          if (stillLocked && ownerUnmounted) setLock(null);
          else if (stillLocked) setLock({ ...lockAtSave, phase: 'editing' });
          throw error instanceof EditOperationCancelledError ? error : toError(error);
        }
        return completeCommittedSave(lockAtSave, editedRow, originalRow, applyResult);
      },
    [completeCommittedSave, editFlow, ownsPageContinuation, setLock]
  );

  const handleProcessRowUpdateError = useCallback((error: Error) => {
    if (isMuiRowEditCancelled(error) || error instanceof EditOperationCancelledError) return;
    showPageAlertRef.current(VIEW_ERRORS_ALERTS.saveFailed(error.message));
  }, []);

  // A census change keeps this page mounted: handle the lock of the scope just left (spec lifecycle table).
  useEffect(() => {
    if (pageContinuationRef.current !== null && pageContinuationRef.current.readScopeKey !== readScopeKey) pageContinuationRef.current = null;
    const current = lockRef.current;
    if (!current || current.readScopeKey === readScopeKey) return;
    if (current.phase === 'editing') {
      setLock(null);
      showPageAlertRef.current(VIEW_ERRORS_ALERTS.editDiscardedByCensusChange(current.treeTag, current.stemTag));
      return;
    }
    if (current.phase === 'saving') {
      // Committed: only its rebuilds are outstanding, and completeCommittedSave finishes them for the old scope (P2-4).
      if (current.applyCommitted) {
        setLock(null);
        return;
      }
      if (cancelPendingOperationRef.current() !== 'detached-apply') {
        setLock(null);
        showPageAlertRef.current(VIEW_ERRORS_ALERTS.editCancelledByCensusChange(current.treeTag, current.stemTag));
      }
      return;
    }
    setLock(null);
  }, [readScopeKey, setLock]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelPendingOperationRef.current();
    };
  }, []);

  /**
   * Undo and Clear send their write before any edit can see its result, so they reserve the page instead (P2-3):
   * refused while an edit is open or saving (refreshing is free, as Undo is, D-i) or another mutation is busy.
   */
  const beginPageMutation = useCallback(
    (kind: PageMutationKind): (() => void) | null => {
      if (pageMutationBlockedReason(lockRef.current, mutationBusyRef.current) !== null) return null;
      setMutationBusy(kind);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (mutationBusyRef.current === kind) setMutationBusy(null);
      };
    },
    [setMutationBusy]
  );

  const onUndo = useCallback(
    async (confirmedPlanHash?: string): Promise<UndoRevertOutcome> => {
      const current = undoRef.current;
      if (!current) return { status: 'failed' };
      const release = beginPageMutation('undo');
      if (!release) return { status: 'failed' };
      try {
        return await revertEditAndRefresh(
          { ...current.mutationScope, editOperationID: current.editOperationID, confirmedPlanHash },
          {
            refreshAfterRevert: async () => {
              try {
                await requestMeasurementViewRebuilds(current.mutationScope, [current.coreMeasurementID]);
              } catch (error: unknown) {
                recordPendingRebuild(current.mutationScope);
                throw error;
              }
              await refreshAllReadsRef.current({ strict: true });
            },
            notify: ({ message, severity }) => {
              if (severity !== 'success') showPageAlertRef.current(message);
            },
            logError: (message, error) => ailogger.error(`ErrorsExplorer: ${message}`, error)
          }
        );
      } finally {
        release();
      }
    },
    [beginPageMutation, recordPendingRebuild]
  );

  const dismissUndo = useCallback(() => setUndo(null), []);

  const retryInFlightRef = useRef<Promise<void> | null>(null);
  const retryRefresh = useCallback((): Promise<void> => {
    if (retryInFlightRef.current) return retryInFlightRef.current;
    const scope = readScopeRef.current;
    if (!scope) return Promise.resolve();
    const attempt = (async () => {
      for (const pending of pendingRef.current.filter(entry => scopeOverlapsRead(entry, scope))) {
        try {
          await requestScopeViewRebuilds(pending);
          setPendingViewRebuilds(removePendingScope(pendingRef.current, pending));
        } catch (error: unknown) {
          showPageAlertRef.current(VIEW_ERRORS_ALERTS.savedButRefreshFailed(toError(error).message));
          return;
        }
      }
    })().finally(() => {
      retryInFlightRef.current = null;
    });
    retryInFlightRef.current = attempt;
    return attempt;
  }, [setPendingViewRebuilds]);

  const isReadScopeGated = readScope !== null && pendingViewRebuilds.some(entry => scopeOverlapsRead(entry, readScope));
  /** One row's own census (the details sheet): gated only by a pending rebuild of that census (P2-2). */
  const isMutationScopeGated = useCallback(
    (scope: RowMutationScope) => pendingViewRebuilds.some(entry => isSameMutationScope(entry, scope)),
    [pendingViewRebuilds]
  );

  const reasons = useMemo(
    () => ({
      pageControl: pageControlLockReason(lock, readScopeKey),
      owningGrid: (gridKey: string) => owningGridLockReason(lock, readScopeKey, gridKey),
      editEntry: (gridKey: string, rowID: number) => editEntryLockReason(lock, readScopeKey, gridKey, rowID, mutationBusy !== null),
      details: (gridKey: string, rowID: number) => detailsActionLockReason(lock, readScopeKey, gridKey, rowID),
      // The toast shows its own busy state during its own Undo; a Clear in flight disables it.
      undo: mutationBusy === 'clear' ? EDIT_LOCK_TOOLTIPS.saving : undoLockReason(lock),
      pageMutationBlocked: pageMutationBlockedReason(lock, mutationBusy)
    }),
    [lock, readScopeKey, mutationBusy]
  );

  const isCellEditable = useCallback(
    (gridKey: string, rowID: number) => isCellEditableUnderLock(lockRef.current, readScopeKeyRef.current, gridKey, rowID, mutationBusyRef.current !== null),
    []
  );

  return {
    editFlow,
    lock,
    reasons,
    isCellEditable,
    handleRowModesModelChange,
    handleGridUnmount,
    processRowUpdate,
    handleProcessRowUpdateError,
    undo,
    onUndo,
    dismissUndo,
    pendingViewRebuilds,
    isReadScopeGated,
    isMutationScopeGated,
    retryRefresh,
    mutationBusy,
    beginPageMutation
  };
}

export type ErrorsExplorerRowEdit = ReturnType<typeof useErrorsExplorerRowEdit>;
