import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridRowModes, type GridRowModesModel } from '@mui/x-data-grid';
import { buildReadScopeKey, EDIT_LOCK_TOOLTIPS, VIEW_ERRORS_ALERTS, type ErrorExplorerRow, type ErrorsExplorerReadScope } from '@/config/errorsexplorer';
import type { ApplyResult, EditPlan } from '@/config/editplan/types';
import type { RefreshOptions } from '@/components/datagrids/hooks/useinfinitegridrows';
import { useErrorsExplorerRowEdit, type RowEditLock, type UseErrorsExplorerRowEditArgs } from './useerrorsexplorerrowedit';

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(onResolve => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

const GRID = 'group:a';
const OTHER_GRID = 'group:b';
const ROW_CENSUS_ID = 6;
const READ_SCOPE: ErrorsExplorerReadScope = { schema: 'forestgeo_testing', plotID: 1, censusID: 5, censusIDs: [5, ROW_CENSUS_ID] };
const OTHER_READ_SCOPE: ErrorsExplorerReadScope = { schema: 'forestgeo_testing', plotID: 1, censusID: 9, censusIDs: [9] };
const ROW = {
  id: 101,
  coreMeasurementID: 101,
  censusID: ROW_CENSUS_ID,
  plotID: 1,
  treeTag: 'T101',
  stemTag: '1',
  measuredDBH: 10,
  attributes: 'A',
  rawCodes: 'A',
  isFailedRow: false
} as unknown as ErrorExplorerRow;
const EDITED = { ...ROW, measuredDBH: 12 } as ErrorExplorerRow;
const OPERATION_ID = 77;
const INFO_PLAN: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 101,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [],
  maxSeverity: 'info',
  planHash: 'a'.repeat(64),
  generatedAt: '2026-11-04T00:00:00.000Z'
};
const WARN_PLAN: EditPlan = { ...INFO_PLAN, maxSeverity: 'warn', planHash: 'b'.repeat(64) };
const APPLY_RESULT: ApplyResult = { updatedIDs: { coremeasurements: 101 }, applyErrors: [], editOperationID: OPERATION_ID, validationPending: false };
/** What both client rebuilds send after a save or an undo of ROW (r3.1, R4). */
const EDITED_REBUILD_BODY = { coreMeasurementIDs: [ROW.coreMeasurementID] };

type Route = { match: RegExp; respond: () => Promise<Response> | Response };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(routes: Route[], initialScope = READ_SCOPE) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const route = routes.find(candidate => candidate.match.test(url));
    if (!route) throw new Error(`No route for ${url}`);
    return route.respond();
  });
  vi.stubGlobal('fetch', fetchMock);
  const refreshAllReads = vi.fn<(options?: RefreshOptions) => Promise<void>>(async () => undefined);
  const patchRowEverywhere = vi.fn();
  const showPageAlert = vi.fn();
  /** The lock as of every render, so a case can prove a phase was never installed, not just that it isn't there at the end. */
  const lockHistory: Array<RowEditLock | null> = [];
  const rendered = renderHook(
    ({ readScope }: { readScope: ErrorsExplorerReadScope }) => {
      const rowEdit = useErrorsExplorerRowEdit({
        readScope,
        readScopeKey: buildReadScopeKey(readScope),
        refreshAllReads,
        patchRowEverywhere,
        showPageAlert
      } satisfies UseErrorsExplorerRowEditArgs);
      lockHistory.push(rowEdit.lock);
      return rowEdit;
    },
    { initialProps: { readScope: initialScope } }
  );
  const bodies = (pattern: RegExp) =>
    fetchMock.mock.calls.filter(([url]) => pattern.test(String(url))).map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  return { ...rendered, fetchMock, refreshAllReads, patchRowEverywhere, showPageAlert, bodies, lockHistory };
}

function enterEdit(result: { current: ReturnType<typeof useErrorsExplorerRowEdit> }, gridKey = GRID, row = ROW): GridRowModesModel {
  let model: GridRowModesModel = {};
  act(() => {
    model = result.current.handleRowModesModelChange(gridKey, { [row.id]: { mode: GridRowModes.Edit } }, id => (id === row.id ? row : undefined));
  });
  return model;
}

function finishEdit(result: { current: ReturnType<typeof useErrorsExplorerRowEdit> }, gridKey = GRID) {
  act(() => {
    result.current.handleRowModesModelChange(gridKey, {}, () => undefined);
  });
}

const okRebuilds: Route = { match: /\/api\/refreshviews\//, respond: () => json({ success: true }) };

describe('useErrorsExplorerRowEdit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('acquires on edit entry, refuses a second row in another grid, and releases on Cancel', () => {
    const { result } = harness([]);
    enterEdit(result);
    expect(result.current.lock).toMatchObject({ gridKey: GRID, rowID: 101, phase: 'editing', mutationScope: { censusID: ROW_CENSUS_ID } });
    const refused = result.current.handleRowModesModelChange(OTHER_GRID, { 202: { mode: GridRowModes.Edit } }, () => undefined);
    expect(refused).toEqual({});
    expect(result.current.reasons.editEntry(OTHER_GRID, 202)).toBe(EDIT_LOCK_TOOLTIPS.editing);
    finishEdit(result);
    expect(result.current.lock).toBeNull();
  });

  it('saves with the row census, resolves before any read, starts reads when MUI finishes, and releases after they settle', async () => {
    let settleReads!: () => void;
    const { result, refreshAllReads, bodies, patchRowEverywhere } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      okRebuilds
    ]);
    refreshAllReads.mockImplementation(() => new Promise<void>(resolve => (settleReads = resolve)));
    enterEdit(result);
    let saved: unknown;
    await act(async () => {
      saved = await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    console.log('[view-errors row edit save]', JSON.stringify({ lock: result.current.lock, reads: refreshAllReads.mock.calls.length }));
    expect(saved).toMatchObject({ measuredDBH: 12 });
    expect(result.current.lock?.phase).toBe('refreshing');
    expect(refreshAllReads, 'no read before MUI finishes the edit').not.toHaveBeenCalled();
    expect(bodies(/\/api\/edits\/(preview|apply)/).map(body => body.censusID)).toEqual([ROW_CENSUS_ID, ROW_CENSUS_ID]);
    expect(bodies(/\/api\/refreshviews\//), 'both rebuilds name only the edited measurement (r3.1, R4)').toEqual([EDITED_REBUILD_BODY, EDITED_REBUILD_BODY]);
    expect(patchRowEverywhere).toHaveBeenCalledWith(expect.objectContaining({ coreMeasurementID: 101, measuredDBH: 12 }));
    expect(result.current.undo).toEqual({
      editOperationID: OPERATION_ID,
      mutationScope: { schema: READ_SCOPE.schema, plotID: 1, censusID: ROW_CENSUS_ID },
      coreMeasurementID: ROW.coreMeasurementID
    });
    expect(result.current.reasons.undo, 'Undo is free in refreshing').toBeNull();
    finishEdit(result);
    expect(refreshAllReads).toHaveBeenCalledTimes(1);
    expect(result.current.lock?.phase).toBe('refreshing');
    await act(async () => settleReads());
    expect(result.current.lock).toBeNull();
  });

  it('returns to editing and rejects when the preview fails, with the save-failed alert', async () => {
    const { result, showPageAlert } = harness([{ match: /\/api\/edits\/preview/, respond: () => new Response('species not found', { status: 422 }) }]);
    enterEdit(result);
    let failure: unknown;
    await act(async () => {
      failure = await result.current
        .processRowUpdate(GRID)(EDITED, ROW)
        .catch((error: unknown) => error);
    });
    expect(result.current.lock?.phase).toBe('editing');
    act(() => result.current.handleProcessRowUpdateError(failure as Error));
    expect(showPageAlert).toHaveBeenCalledWith(VIEW_ERRORS_ALERTS.saveFailed('species not found'));
  });

  it('records a failed rebuild after a commit, releases the lock, runs no read, and gates only overlapping reads', async () => {
    const { result, refreshAllReads, showPageAlert, rerender } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/refreshviews\/measurementssummary/, respond: () => json({ error: 'Lock wait timeout exceeded' }, 500) },
      okRebuilds
    ]);
    enterEdit(result);
    await act(async () => {
      await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    expect(result.current.pendingViewRebuilds).toEqual([{ schema: READ_SCOPE.schema, plotID: 1, censusID: ROW_CENSUS_ID }]);
    expect(result.current.lock).toBeNull();
    expect(showPageAlert).toHaveBeenCalledWith(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'));
    finishEdit(result);
    expect(refreshAllReads).not.toHaveBeenCalled();
    expect(result.current.isReadScopeGated).toBe(true);
    rerender({ readScope: OTHER_READ_SCOPE });
    expect(result.current.isReadScopeGated, 'an unrelated census reads normally').toBe(false);
    rerender({ readScope: READ_SCOPE });
    expect(result.current.isReadScopeGated, 'switching back is still gated').toBe(true);
  });

  it('retries the rebuilds before any read and lifts the gate only when both succeed', async () => {
    let rebuildFails = true;
    const { result, fetchMock, bodies } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/refreshviews\//, respond: () => (rebuildFails ? json({ error: 'still failing' }, 500) : json({ success: true })) }
    ]);
    enterEdit(result);
    await act(async () => {
      await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    fetchMock.mockClear();
    await act(async () => {
      await result.current.retryRefresh();
    });
    expect(fetchMock.mock.calls.every(([url]) => /\/api\/refreshviews\//.test(String(url)))).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => /\/api\/edits\/apply/.test(String(url))),
      'the save is never re-sent'
    ).toBe(false);
    expect(result.current.isReadScopeGated).toBe(true);
    rebuildFails = false;
    await act(async () => {
      await result.current.retryRefresh();
    });
    expect(result.current.pendingViewRebuilds).toEqual([]);
    expect(result.current.isReadScopeGated).toBe(false);
    const scopeBody = { plotID: 1, censusID: ROW_CENSUS_ID };
    console.log('[view-errors retry bodies]', JSON.stringify(bodies(/\/api\/refreshviews\//)));
    expect(bodies(/\/api\/refreshviews\//), 'each Retry refresh rebuilds the whole pending scope (two tries, two views each)').toEqual([
      scopeBody,
      scopeBody,
      scopeBody,
      scopeBody
    ]);
  });

  it('runs one whole-scope rebuild for a Retry refresh clicked twice while the first is still running', async () => {
    const heldRebuild = deferred<Response>();
    let holdRebuilds = false;
    const { result, bodies } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      {
        match: /\/api\/refreshviews\//,
        respond: () => (holdRebuilds ? heldRebuild.promise : json({ error: 'still failing' }, 500))
      }
    ]);
    enterEdit(result);
    await act(async () => {
      await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    expect(result.current.isReadScopeGated).toBe(true);
    const rebuildsBeforeRetry = bodies(/\/api\/refreshviews\//).length;
    holdRebuilds = true;

    let firstClick!: Promise<void>;
    let secondClick!: Promise<void>;
    act(() => {
      firstClick = result.current.retryRefresh();
      secondClick = result.current.retryRefresh();
    });
    await act(async () => {
      heldRebuild.resolve(json({ success: true }));
      await Promise.all([firstClick, secondClick]);
    });

    const rebuildsFromRetry = bodies(/\/api\/refreshviews\//).length - rebuildsBeforeRetry;
    console.log('[view-errors retry double click]', JSON.stringify({ rebuildsFromRetry }));
    expect(rebuildsFromRetry, 'one scope, two views, once').toBe(2);
  });

  it('discards an open row on a census change with the page notice', () => {
    const { result, rerender, showPageAlert } = harness([]);
    enterEdit(result);
    rerender({ readScope: OTHER_READ_SCOPE });
    expect(result.current.lock).toBeNull();
    expect(showPageAlert).toHaveBeenCalledWith(VIEW_ERRORS_ALERTS.editDiscardedByCensusChange('T101', '1'));
  });

  it('cancels an operation whose dialog is open on a census change: no apply, the not-saved notice', async () => {
    const { result, rerender, showPageAlert, bodies } = harness([{ match: /\/api\/edits\/preview/, respond: () => json(WARN_PLAN) }]);
    enterEdit(result);
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .processRowUpdate(GRID)(EDITED, ROW)
        .catch((error: unknown) => error);
    });
    await waitFor(() => expect(result.current.editFlow.dialogState.open).toBe(true));
    rerender({ readScope: OTHER_READ_SCOPE });
    await act(async () => {
      await pending;
    });
    expect(result.current.editFlow.dialogState.open).toBe(false);
    expect(bodies(/\/api\/edits\/apply/)).toHaveLength(0);
    expect(result.current.lock).toBeNull();
    expect(showPageAlert).toHaveBeenCalledWith(VIEW_ERRORS_ALERTS.editCancelledByCensusChange('T101', '1'));
  });

  it('completes an apply already sent at a census change: rebuilds its edited measurement and keeps its undo scope, with no patch and no read', async () => {
    let settleApply!: (response: Response) => void;
    const { result, rerender, refreshAllReads, patchRowEverywhere, bodies } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => new Promise<Response>(resolve => (settleApply = resolve)) },
      okRebuilds
    ]);
    enterEdit(result);
    let saving!: Promise<unknown>;
    act(() => {
      saving = result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    await waitFor(() => expect(bodies(/\/api\/edits\/apply/)).toHaveLength(1));
    rerender({ readScope: OTHER_READ_SCOPE });
    expect(result.current.reasons.editEntry(GRID, 999), 'detached lock blocks new edits').toBe(EDIT_LOCK_TOOLTIPS.saving);
    await act(async () => {
      settleApply(json(APPLY_RESULT));
      await saving;
    });
    expect(bodies(/\/api\/refreshviews\//), 'both rebuilds name only the edited measurement (r3.1, R4)').toEqual([EDITED_REBUILD_BODY, EDITED_REBUILD_BODY]);
    expect(result.current.undo?.mutationScope.censusID).toBe(ROW_CENSUS_ID);
    expect(patchRowEverywhere).not.toHaveBeenCalled();
    expect(refreshAllReads).not.toHaveBeenCalled();
    expect(result.current.lock).toBeNull();
  });

  it('sends no apply when unmounted with the dialog open', async () => {
    const { result, unmount, bodies } = harness([{ match: /\/api\/edits\/preview/, respond: () => json(WARN_PLAN) }]);
    enterEdit(result);
    act(() => {
      void result.current
        .processRowUpdate(GRID)(EDITED, ROW)
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.editFlow.dialogState.open).toBe(true));
    unmount();
    expect(bodies(/\/api\/edits\/apply/)).toHaveLength(0);
  });

  it('undoes with the operation scope, rebuilds both views for the edited measurement, then runs the strict read refresh', async () => {
    const { result, refreshAllReads, bodies } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/edits\/revert/, respond: () => json({ ...APPLY_RESULT, editOperationID: OPERATION_ID + 1 }) },
      okRebuilds
    ]);
    enterEdit(result);
    await act(async () => {
      await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    finishEdit(result);
    await waitFor(() => expect(result.current.lock).toBeNull());
    refreshAllReads.mockClear();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.onUndo();
    });
    expect(outcome).toEqual({ status: 'reverted' });
    expect(bodies(/\/api\/edits\/revert/)[0]).toMatchObject({ censusID: ROW_CENSUS_ID, editOperationID: OPERATION_ID });
    expect(bodies(/\/api\/refreshviews\//).slice(-2), "the undo rebuilds the edited measurement's rows (r3.1, R4)").toEqual([
      EDITED_REBUILD_BODY,
      EDITED_REBUILD_BODY
    ]);
    expect(refreshAllReads).toHaveBeenCalledWith({ strict: true });
  });

  it('refuses edit entry while an Undo is outstanding, until its rebuilds and reads settle (P2-3)', async () => {
    const revertRebuild = deferred<Response>();
    let rebuildCalls = 0;
    const { result, refreshAllReads } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/edits\/revert/, respond: () => json({ ...APPLY_RESULT, editOperationID: OPERATION_ID + 1 }) },
      {
        match: /\/api\/refreshviews\//,
        respond: () => {
          rebuildCalls += 1;
          return rebuildCalls <= 2 ? json({ success: true }) : revertRebuild.promise;
        }
      }
    ]);
    enterEdit(result);
    await act(async () => {
      await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    finishEdit(result);
    await waitFor(() => expect(result.current.lock).toBeNull());
    let undoing!: Promise<unknown>;
    act(() => {
      undoing = result.current.onUndo();
    });
    await waitFor(() => expect(rebuildCalls).toBe(4));
    const model = enterEdit(result, OTHER_GRID, { ...ROW, id: 202, coreMeasurementID: 202 } as ErrorExplorerRow);
    console.log('[view-errors undo busy]', JSON.stringify({ model, lock: result.current.lock, reason: result.current.reasons.editEntry(OTHER_GRID, 202) }));
    expect(model, 'an edit entry during Undo is stripped').toEqual({});
    expect(result.current.lock).toBeNull();
    expect(result.current.reasons.editEntry(OTHER_GRID, 202)).toBe(EDIT_LOCK_TOOLTIPS.saving);
    expect(result.current.isCellEditable(OTHER_GRID, 202)).toBe(false);
    expect(result.current.beginPageMutation('clear'), 'a Clear cannot start during Undo').toBeNull();
    await act(async () => {
      revertRebuild.resolve(json({ success: true }));
      await undoing;
    });
    expect(refreshAllReads).toHaveBeenCalledWith({ strict: true });
    expect(result.current.reasons.editEntry(OTHER_GRID, 202), 'free again once the undo settled').toBeNull();
    expect(enterEdit(result, OTHER_GRID, { ...ROW, id: 202, coreMeasurementID: 202 } as ErrorExplorerRow)).toEqual({ 202: { mode: GridRowModes.Edit } });
  });

  it('keeps a committed save committed when the census changes during its rebuilds (P2-4)', async () => {
    const summaryRebuild = deferred<Response>();
    const { result, rerender, showPageAlert, bodies } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/refreshviews\/measurementssummary/, respond: () => summaryRebuild.promise },
      okRebuilds
    ]);
    enterEdit(result);
    let saving!: Promise<unknown>;
    act(() => {
      saving = result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    await waitFor(() => expect(bodies(/\/api\/refreshviews\/measurementssummary/)).toHaveLength(1));
    expect(result.current.lock).toMatchObject({ phase: 'saving', applyCommitted: true });
    rerender({ readScope: OTHER_READ_SCOPE });
    console.log(
      '[view-errors committed census change]',
      JSON.stringify({ lock: result.current.lock, alerts: showPageAlert.mock.calls, undo: result.current.undo })
    );
    expect(showPageAlert).not.toHaveBeenCalledWith(VIEW_ERRORS_ALERTS.editCancelledByCensusChange('T101', '1'));
    expect(result.current.lock, 'released silently').toBeNull();
    expect(result.current.undo).toEqual({
      editOperationID: OPERATION_ID,
      mutationScope: { schema: READ_SCOPE.schema, plotID: 1, censusID: ROW_CENSUS_ID },
      coreMeasurementID: ROW.coreMeasurementID
    });
    await act(async () => {
      summaryRebuild.resolve(json({ error: 'Lock wait timeout exceeded' }, 500));
      await saving;
    });
    expect(result.current.pendingViewRebuilds).toEqual([{ schema: READ_SCOPE.schema, plotID: 1, censusID: ROW_CENSUS_ID }]);
    expect(showPageAlert).toHaveBeenCalledWith(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'));
  });

  it("never lets an old scope's completion replace a newer edit after a return to that scope (r3, P2-7)", async () => {
    const summaryRebuild = deferred<Response>();
    const { result, rerender, bodies, refreshAllReads, patchRowEverywhere, lockHistory } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/refreshviews\/measurementssummary/, respond: () => summaryRebuild.promise },
      okRebuilds
    ]);
    enterEdit(result);
    let saving!: Promise<unknown>;
    act(() => {
      saving = result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    await waitFor(() => expect(bodies(/\/api\/refreshviews\/measurementssummary/)).toHaveLength(1));
    const oldOperationID = result.current.lock?.operationID;
    expect(result.current.lock).toMatchObject({ phase: 'saving', applyCommitted: true });
    rerender({ readScope: OTHER_READ_SCOPE });
    rerender({ readScope: READ_SCOPE });
    const newerRow = { ...ROW, id: 202, coreMeasurementID: 202, treeTag: 'T202' } as ErrorExplorerRow;
    enterEdit(result, OTHER_GRID, newerRow);
    const newerLock = result.current.lock;
    const patchesBeforeRelease = patchRowEverywhere.mock.calls.length;
    const historyStart = lockHistory.length;
    await act(async () => {
      summaryRebuild.resolve(json({ success: true }));
      await saving;
    });
    const locksSinceRelease = lockHistory.slice(historyStart);
    console.log('[view-errors scope return]', JSON.stringify({ oldOperationID, newerLock, lock: result.current.lock, locksSinceRelease }));
    expect(newerLock).toMatchObject({ gridKey: OTHER_GRID, rowID: 202, phase: 'editing' });
    expect(newerLock?.operationID, 'a new edit entry is a new operation').not.toBe(oldOperationID);
    expect(result.current.lock, "the newer edit's lock is untouched").toEqual(newerLock);
    expect(
      locksSinceRelease.some(lock => lock?.phase === 'refreshing'),
      'no refreshing phase is installed for the old operation'
    ).toBe(false);
    expect(
      locksSinceRelease.every(lock => lock?.operationID === newerLock?.operationID),
      'no render shows another lock'
    ).toBe(true);
    expect(patchRowEverywhere.mock.calls.length, 'the old completion patches nothing after the census change').toBe(patchesBeforeRelease);
    expect(refreshAllReads).not.toHaveBeenCalled();
    expect(result.current.isCellEditable(OTHER_GRID, 202), 'the newer row is still editable').toBe(true);
    expect(result.current.undo, "the old scope's undo record stays").toEqual({
      editOperationID: OPERATION_ID,
      mutationScope: { schema: READ_SCOPE.schema, plotID: 1, censusID: ROW_CENSUS_ID },
      coreMeasurementID: ROW.coreMeasurementID
    });
  });

  it('blocks Undo and Clear by the same rule as beginPageMutation while a detached apply from another census is outstanding (r3, P2-8)', async () => {
    let settleApply!: (response: Response) => void;
    const { result, rerender, bodies } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => new Promise<Response>(resolve => (settleApply = resolve)) },
      okRebuilds
    ]);
    enterEdit(result);
    let saving!: Promise<unknown>;
    act(() => {
      saving = result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    await waitFor(() => expect(bodies(/\/api\/edits\/apply/)).toHaveLength(1));
    rerender({ readScope: OTHER_READ_SCOPE });
    console.log(
      '[view-errors detached mutation block]',
      JSON.stringify({
        lock: result.current.lock,
        reasons: { pageControl: result.current.reasons.pageControl, pageMutationBlocked: result.current.reasons.pageMutationBlocked }
      })
    );
    expect(result.current.lock, 'the detached lock stays until its apply settles (A4)').toMatchObject({
      phase: 'saving',
      readScopeKey: buildReadScopeKey(READ_SCOPE)
    });
    expect(result.current.reasons.pageControl, 'page controls ignore an old-scope lock').toBeNull();
    expect(result.current.reasons.pageMutationBlocked, 'Clear shows why it is disabled').toBe(EDIT_LOCK_TOOLTIPS.saving);
    expect(result.current.beginPageMutation('clear'), 'and the refusal agrees with the reason').toBeNull();
    await act(async () => {
      settleApply(json(APPLY_RESULT));
      await saving;
    });
    expect(result.current.lock).toBeNull();
    expect(result.current.reasons.pageMutationBlocked, 'free once the apply settled').toBeNull();
    let release: (() => void) | null = null;
    act(() => {
      release = result.current.beginPageMutation('clear');
    });
    expect(release, 'a Clear can start now').not.toBeNull();
    act(() => release?.());
  });

  it('gates details only for the mutation scope that has a pending rebuild (P2-2)', async () => {
    const { result } = harness([
      { match: /\/api\/edits\/preview/, respond: () => json(INFO_PLAN) },
      { match: /\/api\/edits\/apply/, respond: () => json(APPLY_RESULT) },
      { match: /\/api\/refreshviews\/measurementssummary/, respond: () => json({ error: 'Lock wait timeout exceeded' }, 500) },
      okRebuilds
    ]);
    enterEdit(result);
    await act(async () => {
      await result.current.processRowUpdate(GRID)(EDITED, ROW);
    });
    const censusA = { schema: READ_SCOPE.schema, plotID: 1, censusID: ROW_CENSUS_ID };
    const censusB = { ...censusA, censusID: READ_SCOPE.censusID };
    console.log('[view-errors mutation gate]', JSON.stringify({ pending: result.current.pendingViewRebuilds }));
    expect(result.current.isReadScopeGated, 'the page read scope holds census A').toBe(true);
    expect(result.current.isMutationScopeGated(censusA)).toBe(true);
    expect(result.current.isMutationScopeGated(censusB), "census B's details read normally").toBe(false);
  });
});
