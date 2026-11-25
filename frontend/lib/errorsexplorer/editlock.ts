import { GridRowModes, type GridRowModesModel } from '@mui/x-data-grid';
import { EDIT_LOCK_TOOLTIPS, type RowMutationScope } from '@/config/errorsexplorer';

export type EditLockPhase = 'editing' | 'saving' | 'refreshing';

/** One lock per page (spec Editing → Edit lock lifecycle). readScopeKey is the page read scope when the edit began. */
export interface EditLock {
  gridKey: string;
  rowID: number;
  phase: EditLockPhase;
  mutationScope: RowMutationScope;
  readScopeKey: string;
  treeTag: string;
  stemTag: string;
  /** refreshing only: the read refresh has started (after MUI finished the edit). */
  readsStarted: boolean;
  /** saving only: the apply committed and only its view rebuilds are outstanding, so a census change must not call it "not saved" (P2-4). */
  applyCommitted: boolean;
}

export function editLockTooltip(phase: EditLockPhase): string {
  return phase === 'editing' ? EDIT_LOCK_TOOLTIPS.editing : EDIT_LOCK_TOOLTIPS.saving;
}

function isCurrentScope(lock: EditLock, readScopeKey: string): boolean {
  return lock.readScopeKey === readScopeKey;
}

function isLockedRow(lock: EditLock, gridKey: string, rowID: number): boolean {
  return lock.gridKey === gridKey && lock.rowID === rowID;
}

/** Show, Search, Group rows, the Filtered-to chip and the sheet's own actions. */
export function pageControlLockReason(lock: EditLock | null, readScopeKey: string): string | null {
  return lock && isCurrentScope(lock, readScopeKey) ? editLockTooltip(lock.phase) : null;
}

/** The owning group's collapse button and its grid's paging, sorting and filtering. */
export function owningGridLockReason(lock: EditLock | null, readScopeKey: string, gridKey: string): string | null {
  return lock && isCurrentScope(lock, readScopeKey) && lock.gridKey === gridKey ? editLockTooltip(lock.phase) : null;
}

/** pageMutationBusy: an Undo or a Clear owns the page until its rebuild and reads settle (P2-3). */
export function editEntryLockReason(lock: EditLock | null, readScopeKey: string, gridKey: string, rowID: number, pageMutationBusy = false): string | null {
  if (pageMutationBusy) return EDIT_LOCK_TOOLTIPS.saving;
  if (!lock) return null;
  if (!isCurrentScope(lock, readScopeKey)) return EDIT_LOCK_TOOLTIPS.saving;
  return isLockedRow(lock, gridKey, rowID) ? null : editLockTooltip(lock.phase);
}

export function detailsActionLockReason(lock: EditLock | null, readScopeKey: string, gridKey: string, rowID: number): string | null {
  if (!lock || !isCurrentScope(lock, readScopeKey)) return null;
  return isLockedRow(lock, gridKey, rowID) ? null : editLockTooltip(lock.phase);
}

export function undoLockReason(lock: EditLock | null): string | null {
  if (!lock || lock.phase === 'refreshing') return null;
  return editLockTooltip(lock.phase);
}

export function isCellEditableUnderLock(lock: EditLock | null, readScopeKey: string, gridKey: string, rowID: number, pageMutationBusy = false): boolean {
  if (pageMutationBusy) return false;
  if (!lock) return true;
  return isCurrentScope(lock, readScopeKey) && isLockedRow(lock, gridKey, rowID) && lock.phase === 'editing';
}

export type RowModesResolution =
  | { kind: 'unchanged'; model: GridRowModesModel }
  | { kind: 'acquire'; model: GridRowModesModel; rowID: number }
  | { kind: 'left'; model: GridRowModesModel };

function editingRowIDs(model: GridRowModesModel): number[] {
  return Object.entries(model)
    .filter(([, entry]) => entry.mode === GridRowModes.Edit)
    .map(([id]) => Number(id));
}

function withoutRows(model: GridRowModesModel, rowIDs: readonly number[]): GridRowModesModel {
  if (rowIDs.length === 0) return model;
  const blocked = new Set(rowIDs.map(String));
  return Object.fromEntries(Object.entries(model).filter(([id]) => !blocked.has(id)));
}

/** Decides a grid's onRowModesModelChange: at most one row in Edit page-wide, and the locked row leaving its model ends the edit. */
export function resolveRowModesModelChange(
  lock: EditLock | null,
  readScopeKey: string,
  gridKey: string,
  nextModel: GridRowModesModel,
  pageMutationBusy = false
): RowModesResolution {
  const editing = editingRowIDs(nextModel);
  if (!lock && pageMutationBusy) return { kind: 'unchanged', model: withoutRows(nextModel, editing) };
  if (!lock) {
    if (editing.length === 0) return { kind: 'unchanged', model: nextModel };
    const [first, ...rest] = editing;
    return { kind: 'acquire', model: withoutRows(nextModel, rest), rowID: first };
  }
  if (!isCurrentScope(lock, readScopeKey) || lock.gridKey !== gridKey) return { kind: 'unchanged', model: withoutRows(nextModel, editing) };
  const model = withoutRows(
    nextModel,
    editing.filter(id => id !== lock.rowID)
  );
  return String(lock.rowID) in nextModel ? { kind: 'unchanged', model } : { kind: 'left', model };
}
