import { describe, expect, it } from 'vitest';
import { GridRowModes } from '@mui/x-data-grid';
import { EDIT_LOCK_TOOLTIPS } from '@/config/errorsexplorer';
import {
  detailsActionLockReason,
  editEntryLockReason,
  isCellEditableUnderLock,
  owningGridLockReason,
  pageControlLockReason,
  resolveRowModesModelChange,
  undoLockReason,
  type EditLock
} from './editlock';

const SCOPE = 'scope-a';
const OTHER_SCOPE = 'scope-b';
const GRID_A = 'group:a';
const GRID_B = 'group:b';
const LOCK: EditLock = {
  gridKey: GRID_A,
  rowID: 101,
  phase: 'editing',
  mutationScope: { schema: 'forestgeo_testing', plotID: 1, censusID: 6 },
  readScopeKey: SCOPE,
  treeTag: 'T101',
  stemTag: '1',
  readsStarted: false,
  applyCommitted: false
};
const PAGE_MUTATION_BUSY = true;

describe('edit lock reasons (D-g, D-i)', () => {
  it.each([
    ['editing', EDIT_LOCK_TOOLTIPS.editing],
    ['saving', EDIT_LOCK_TOOLTIPS.saving],
    ['refreshing', EDIT_LOCK_TOOLTIPS.saving]
  ] as const)('uses the %s tooltip on page controls and the owning grid', (phase, tooltip) => {
    const lock = { ...LOCK, phase };
    expect(pageControlLockReason(lock, SCOPE)).toBe(tooltip);
    expect(owningGridLockReason(lock, SCOPE, GRID_A)).toBe(tooltip);
    expect(owningGridLockReason(lock, SCOPE, GRID_B)).toBeNull();
  });

  it('locks every other row but leaves the edited row’s Edit and Details free', () => {
    expect(editEntryLockReason(LOCK, SCOPE, GRID_A, 101)).toBeNull();
    expect(detailsActionLockReason(LOCK, SCOPE, GRID_A, 101)).toBeNull();
    expect(editEntryLockReason(LOCK, SCOPE, GRID_A, 102)).toBe(EDIT_LOCK_TOOLTIPS.editing);
    expect(editEntryLockReason(LOCK, SCOPE, GRID_B, 101), 'same measurement in another group').toBe(EDIT_LOCK_TOOLTIPS.editing);
    expect(detailsActionLockReason(LOCK, SCOPE, GRID_B, 101)).toBe(EDIT_LOCK_TOOLTIPS.editing);
    expect(isCellEditableUnderLock(LOCK, SCOPE, GRID_A, 101)).toBe(true);
    expect(isCellEditableUnderLock(LOCK, SCOPE, GRID_B, 202)).toBe(false);
    expect(isCellEditableUnderLock({ ...LOCK, phase: 'saving' }, SCOPE, GRID_A, 101)).toBe(false);
    expect(isCellEditableUnderLock(null, SCOPE, GRID_B, 202)).toBe(true);
  });

  it('lets a detached lock (older scope) block only edit entry and Undo (A4)', () => {
    const detached = { ...LOCK, phase: 'saving' as const };
    expect(pageControlLockReason(detached, OTHER_SCOPE)).toBeNull();
    expect(owningGridLockReason(detached, OTHER_SCOPE, GRID_A)).toBeNull();
    expect(detailsActionLockReason(detached, OTHER_SCOPE, GRID_A, 5)).toBeNull();
    expect(editEntryLockReason(detached, OTHER_SCOPE, GRID_A, 5)).toBe(EDIT_LOCK_TOOLTIPS.saving);
    expect(undoLockReason(detached)).toBe(EDIT_LOCK_TOOLTIPS.saving);
  });

  it('locks edit entry and cell editing everywhere while Undo or Clear is busy, with no edit lock held (P2-3)', () => {
    const reasons = [editEntryLockReason(null, SCOPE, GRID_A, 101, PAGE_MUTATION_BUSY), editEntryLockReason(null, SCOPE, GRID_B, 202, PAGE_MUTATION_BUSY)];
    console.log('[view-errors page mutation lock]', JSON.stringify(reasons));
    expect(reasons).toEqual([EDIT_LOCK_TOOLTIPS.saving, EDIT_LOCK_TOOLTIPS.saving]);
    expect(isCellEditableUnderLock(null, SCOPE, GRID_A, 101, PAGE_MUTATION_BUSY)).toBe(false);
    expect(editEntryLockReason(null, SCOPE, GRID_A, 101), 'no mutation, no lock').toBeNull();
  });

  it('locks Undo in editing and saving and releases it in refreshing', () => {
    expect(undoLockReason(LOCK)).toBe(EDIT_LOCK_TOOLTIPS.editing);
    expect(undoLockReason({ ...LOCK, phase: 'saving' })).toBe(EDIT_LOCK_TOOLTIPS.saving);
    expect(undoLockReason({ ...LOCK, phase: 'refreshing' })).toBeNull();
    expect(undoLockReason(null)).toBeNull();
  });
});

describe('resolveRowModesModelChange', () => {
  it('acquires the first row entering edit and strips a second one', () => {
    const resolution = resolveRowModesModelChange(null, SCOPE, GRID_A, { 101: { mode: GridRowModes.Edit }, 102: { mode: GridRowModes.Edit } });
    console.log('[view-errors row modes]', JSON.stringify(resolution));
    expect(resolution).toEqual({ kind: 'acquire', rowID: 101, model: { 101: { mode: GridRowModes.Edit } } });
  });

  it('strips edit entries in another grid while a lock is held', () => {
    expect(resolveRowModesModelChange(LOCK, SCOPE, GRID_B, { 202: { mode: GridRowModes.Edit }, 203: { mode: GridRowModes.View } })).toEqual({
      kind: 'unchanged',
      model: { 203: { mode: GridRowModes.View } }
    });
  });

  it('strips another row of the owning grid and keeps the locked one', () => {
    expect(resolveRowModesModelChange(LOCK, SCOPE, GRID_A, { 101: { mode: GridRowModes.Edit }, 102: { mode: GridRowModes.Edit } })).toEqual({
      kind: 'unchanged',
      model: { 101: { mode: GridRowModes.Edit } }
    });
  });

  it('refuses to acquire while Undo or Clear is busy (P2-3)', () => {
    expect(resolveRowModesModelChange(null, SCOPE, GRID_A, { 101: { mode: GridRowModes.Edit }, 102: { mode: GridRowModes.View } }, PAGE_MUTATION_BUSY)).toEqual(
      {
        kind: 'unchanged',
        model: { 102: { mode: GridRowModes.View } }
      }
    );
  });

  it('reports left when the locked row leaves its grid’s model (MUI finishRowEditMode)', () => {
    expect(resolveRowModesModelChange({ ...LOCK, phase: 'refreshing' }, SCOPE, GRID_A, {})).toEqual({ kind: 'left', model: {} });
    expect(resolveRowModesModelChange(LOCK, SCOPE, GRID_A, { 101: { mode: GridRowModes.View } }).kind, 'a Save click keeps the key until MUI finishes').toBe(
      'unchanged'
    );
  });
});
