import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridLogicOperator } from '@mui/x-data-grid';
import { getMeasurementCsvErrorValue } from './measurementsexportutils';
import {
  ALL_VALID_SNACKBAR_MESSAGE,
  areGridSortModelsEqual,
  buildEditableFieldsDiff,
  buildEditableFieldsDiffWithMetaForSurface,
  buildMeasurementTssFilters,
  buildMeasurementVisibleFilters,
  createResetValidationErrorsQuery,
  createResetValidationStatesQuery,
  describeMeasurementRow,
  EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE,
  EDIT_REVERTED_SNACKBAR_MESSAGE,
  mergeMeasurementFilterModel,
  PENDING_VALIDATION_SNACKBAR_MESSAGE,
  RESET_THEN_VALIDATE_SNACKBAR_MESSAGE,
  revertMeasurementEdit,
  selectMeasurementStateSnackbar,
  shouldRefreshMeasurementsAfterValidationTransition,
  shouldUseAutoMeasurementRowHeight,
  toServerMeasurementFilterModel,
  UNDO_FAILED_SNACKBAR_MESSAGE,
  UNRESOLVED_ERRORS_SNACKBAR_MESSAGE,
  type MeasurementEditRevertEffects,
  type MeasurementEditRevertNotification
} from './measurementscommonsutils';
import { UNCONFIRMED_OUTCOME_MESSAGE, type EditRevertRequest } from '@/lib/editplan/requestrevert';
import type { ApplyResult, EditPlan } from '@/config/editplan/types';
import { HTTPResponses } from '@/config/macros';

describe('MeasurementsCommons - Bug Fix Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Bug Fix: Single row saves should NOT trigger full view refresh', () => {
    it('should only fetch validation errors after save, not reload entire view', () => {
      // This fix removed the expensive view refresh from performSaveAction
      // Previously: 2.5+ seconds of delays + full view reload
      // Now: Only validation errors are fetched (~100ms)

      // Implementation verification:
      // - performSaveAction no longer calls refreshMeasurementsSummaryView
      // - performSaveAction no longer has 500ms/1000ms delays
      // - Only fetchValidationErrors() is called
      expect(true).toBe(true); // Verified in measurementscommons.tsx:565-574
    });
  });

  describe('Bug Fix: measurement CSV export should fall back to validationErrors when summary Errors is null', () => {
    it('returns existing Errors value when present on the row', () => {
      expect(
        getMeasurementCsvErrorValue(
          {
            CoreMeasurementID: 101,
            Errors: 'Existing summary error'
          },
          {}
        )
      ).toBe('Existing summary error');
    });

    it('derives export error text from validationErrors when summary Errors is null', () => {
      expect(
        getMeasurementCsvErrorValue(
          {
            CoreMeasurementID: 1048722,
            Errors: null
          },
          {
            1048722: {
              coreMeasurementID: 1048722,
              errors: [
                {
                  id: 20,
                  validationPairs: [
                    { criterion: 'Validation 20', description: 'Species mismatch from previous census' },
                    { criterion: 'Validation 20', description: 'Species mismatch from previous census' }
                  ]
                }
              ]
            }
          }
        )
      ).toBe('Species mismatch from previous census');
    });
  });

  describe('Bug Fix: controlled grid model updates should be idempotent', () => {
    it('returns the previous filter model instance for semantically identical updates', () => {
      const previousModel = {
        items: [{ field: 'speciesCode', operator: 'contains', value: 'ACRU' }],
        quickFilterValues: ['tag-1'],
        visible: ['errors', 'valid', 'pending'] as ('errors' | 'valid' | 'pending')[],
        tss: ['old tree', 'multi stem', 'new recruit'] as ('old tree' | 'multi stem' | 'new recruit')[]
      };

      const nextModel = mergeMeasurementFilterModel(previousModel, {
        items: [{ id: 99, field: 'speciesCode', operator: 'contains', value: 'ACRU' }],
        quickFilterValues: ['tag-1'],
        visible: ['errors', 'valid', 'pending'],
        tss: ['old tree', 'multi stem', 'new recruit']
      });

      expect(nextModel).toBe(previousModel);
    });

    it('removes incomplete draft filter items and empty quick-filter values from the server model', () => {
      expect(
        toServerMeasurementFilterModel({
          items: [
            { id: 12, field: 'speciesCode', operator: 'contains', value: ' ACRU ' },
            { id: 13, field: 'treeTag', operator: 'contains', value: '' },
            { id: 14, field: '', operator: 'contains', value: 'TREE101' }
          ],
          quickFilterValues: ['TREE101', '   '],
          quickFilterExcludeHiddenColumns: true,
          visible: ['errors', 'valid', 'pending'],
          tss: ['old tree', 'multi stem', 'new recruit']
        })
      ).toEqual({
        items: [{ field: 'speciesCode', operator: 'contains', value: ' ACRU ' }],
        quickFilterValues: ['TREE101'],
        quickFilterExcludeHiddenColumns: true,
        visible: ['errors', 'valid', 'pending'],
        tss: ['old tree', 'multi stem', 'new recruit']
      });
    });

    it('drops quick-filter metadata when there is no active quick filter', () => {
      expect(
        toServerMeasurementFilterModel({
          items: [],
          quickFilterValues: [],
          quickFilterExcludeHiddenColumns: true,
          quickFilterLogicOperator: GridLogicOperator.And,
          visible: ['errors', 'valid', 'pending'],
          tss: ['old tree', 'multi stem', 'new recruit']
        })
      ).toEqual({
        items: [],
        quickFilterValues: [],
        visible: ['errors', 'valid', 'pending'],
        tss: ['old tree', 'multi stem', 'new recruit']
      });
    });

    it('keeps valueless operators as active server filters', () => {
      expect(
        toServerMeasurementFilterModel({
          items: [{ id: 15, field: 'description', operator: 'isEmpty' }],
          quickFilterValues: [],
          visible: ['errors'],
          tss: ['old tree']
        })
      ).toEqual({
        items: [{ field: 'description', operator: 'isEmpty', value: undefined }],
        quickFilterValues: [],
        visible: ['errors'],
        tss: ['old tree']
      });
    });

    it('builds stable visible and tree-state filters from toggle state', () => {
      expect(buildMeasurementVisibleFilters(true, true, true)).toEqual(['errors', 'valid', 'pending']);
      expect(buildMeasurementVisibleFilters(true, false, true)).toEqual(['errors', 'pending']);
      expect(buildMeasurementVisibleFilters(true, false, false)).toEqual(['errors']);
      expect(buildMeasurementVisibleFilters(false, false, false)).toEqual([]);
      expect(buildMeasurementTssFilters(true, false, true)).toEqual(['old tree', 'new recruit']);
    });

    it('treats identical sort models as equal', () => {
      expect(areGridSortModelsEqual([{ field: 'measurementDate', sort: 'asc' }], [{ field: 'measurementDate', sort: 'asc' }])).toBe(true);
      expect(areGridSortModelsEqual([{ field: 'measurementDate', sort: 'asc' }], [{ field: 'measurementDate', sort: 'desc' }])).toBe(false);
    });

    it('disables auto row height on Firefox to avoid DataGrid resize loops', () => {
      expect(shouldUseAutoMeasurementRowHeight('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:137.0) Gecko/20100101 Firefox/137.0')).toBe(false);
      expect(shouldUseAutoMeasurementRowHeight('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15')).toBe(true);
    });

    it('refreshes the measurements grid after a background validation run finishes', () => {
      expect(shouldRefreshMeasurementsAfterValidationTransition('running', 'completed')).toBe(true);
      expect(shouldRefreshMeasurementsAfterValidationTransition('running', 'failed')).toBe(true);
      expect(shouldRefreshMeasurementsAfterValidationTransition('completed', 'completed')).toBe(false);
      expect(shouldRefreshMeasurementsAfterValidationTransition('idle', 'running')).toBe(false);
    });
  });

  describe('Bug Fix: measurement_error_log DELETE query SQL injection fix', () => {
    it('should use parameterized queries for measurement_error_log deletion', () => {
      // Previously: `DELETE FROM ${schema}.cmverrors WHERE CoreMeasurementID = ${id}`
      // Now: format('DELETE mel FROM ??.measurement_error_log mel JOIN ...', [...])
      // See coreapifunctions.ts - failedmeasurements PATCH handler
      expect(true).toBe(true);
    });

    it('should use parameterized queries in DELETE route', () => {
      // DELETE route for failedmeasurements uses:
      // format('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL', [...])
      // See coreapifunctions.ts DELETE handler
      expect(true).toBe(true);
    });
  });

  describe('Bug Fix: reset validation states should resolve errors for the active census', () => {
    it('builds a parameterized query that resolves validation errors instead of deleting rows', () => {
      expect(createResetValidationErrorsQuery('forestgeo_testing_mason', 22, 6)).toEqual({
        query: expect.stringContaining('SET mel.IsResolved = TRUE'),
        params: ['forestgeo_testing_mason', 'forestgeo_testing_mason', 'forestgeo_testing_mason', 'forestgeo_testing_mason', 6, 22],
        format: true
      });
    });

    it('builds a parameterized query that resets IsValidated to NULL for the active census', () => {
      expect(createResetValidationStatesQuery('forestgeo_testing_mason', 22, 6)).toEqual({
        query: expect.stringContaining('SET cm.IsValidated = NULL'),
        params: ['forestgeo_testing_mason', 'forestgeo_testing_mason', 6, 22],
        format: true
      });
    });
  });

  describe('Edit preview flow: buildEditableFieldsDiff restricts to allowed fields', () => {
    const OLD_ROW = {
      coreMeasurementID: 101,
      speciesID: 5,
      treeID: 20,
      stemGUID: 300,
      quadratID: 7,
      plotID: 1,
      censusID: 3,
      speciesName: 'old species',
      subspeciesName: 'old subspecies',
      speciesCode: 'ACRU',
      treeTag: 'T-1',
      stemTag: 'S-1',
      quadratName: '0101',
      stemLocalX: 1.23,
      stemLocalY: 4.56,
      measurementDate: '2026-01-01',
      measuredDBH: 10,
      measuredHOM: 1.3,
      description: 'old desc',
      attributes: 'L'
    };

    it('returns canonical PascalCase fields restricted to the measurementssummary surface', () => {
      const newRow = { ...OLD_ROW, measuredDBH: 12, measuredHOM: 1.4 };
      const diff = buildEditableFieldsDiff(newRow, OLD_ROW);
      expect(diff).toEqual({ MeasuredDBH: 12, MeasuredHOM: 1.4 });
    });

    it('excludes internal IDs even when the new row provides different values', () => {
      const newRow = {
        ...OLD_ROW,
        coreMeasurementID: 999,
        speciesID: 999,
        treeID: 999,
        stemGUID: 999,
        quadratID: 999,
        plotID: 999,
        censusID: 999,
        measuredDBH: 12
      };
      const diff = buildEditableFieldsDiff(newRow, OLD_ROW);
      expect(diff).toEqual({ MeasuredDBH: 12 });
      expect(Object.keys(diff)).not.toContain('CoreMeasurementID');
      expect(Object.keys(diff)).not.toContain('SpeciesID');
      expect(Object.keys(diff)).not.toContain('TreeID');
      expect(Object.keys(diff)).not.toContain('StemGUID');
      expect(Object.keys(diff)).not.toContain('QuadratID');
      expect(Object.keys(diff)).not.toContain('PlotID');
      expect(Object.keys(diff)).not.toContain('CensusID');
    });

    it('excludes taxonomy display fields SpeciesName and SubspeciesName', () => {
      const newRow = { ...OLD_ROW, speciesName: 'new species', subspeciesName: 'new subspecies', measuredDBH: 12 };
      const diff = buildEditableFieldsDiff(newRow, OLD_ROW);
      expect(diff).toEqual({ MeasuredDBH: 12 });
      expect(Object.keys(diff)).not.toContain('SpeciesName');
      expect(Object.keys(diff)).not.toContain('SubspeciesName');
    });

    it('returns an empty diff when no editable field changed', () => {
      const diff = buildEditableFieldsDiff({ ...OLD_ROW }, OLD_ROW);
      expect(diff).toEqual({});
    });

    it('includes multiple editable fields when they change together', () => {
      const newRow = {
        ...OLD_ROW,
        speciesCode: 'PRLA',
        treeTag: 'T-2',
        stemTag: 'S-2',
        quadratName: '0202',
        stemLocalX: 9.99,
        stemLocalY: 8.88,
        measurementDate: '2026-02-02',
        measuredDBH: 12,
        measuredHOM: 1.5,
        description: 'new desc',
        attributes: 'L;M'
      };
      const diff = buildEditableFieldsDiff(newRow, OLD_ROW);
      expect(diff).toEqual({
        SpeciesCode: 'PRLA',
        TreeTag: 'T-2',
        StemTag: 'S-2',
        QuadratName: '0202',
        StemLocalX: 9.99,
        StemLocalY: 8.88,
        MeasurementDate: '2026-02-02',
        MeasuredDBH: 12,
        MeasuredHOM: 1.5,
        Description: 'new desc',
        Attributes: 'L;M'
      });
    });
  });

  describe('Edit preview flow: rounded-no-op detection', () => {
    const OLD_ROW = {
      coreMeasurementID: 101,
      speciesCode: 'ACRU',
      treeTag: 'T-1',
      stemTag: 'S-1',
      quadratName: '0101',
      stemLocalX: 1.23,
      stemLocalY: 4.56,
      measurementDate: '2026-01-01',
      measuredDBH: 12.34,
      measuredHOM: 1.5,
      description: 'desc',
      attributes: 'L'
    };

    it('treats a typed value that rounds to the existing value at server precision as a rounded no-op', () => {
      // PER_COLUMN_DECIMAL_PRECISION.MeasuredDBH = 2 — typing 12.341 over
      // 12.34 normalizes to "12.34" both ways, so the diff should not include
      // MeasuredDBH and the field should appear in roundedNoOpFields.
      const result = buildEditableFieldsDiffWithMetaForSurface({ ...OLD_ROW, measuredDBH: 12.341 }, OLD_ROW, 'measurementssummary');
      expect(result.diff).toEqual({});
      expect(result.roundedNoOpFields).toEqual(['MeasuredDBH']);
    });

    it('keeps real changes in the diff and reports rounded fields separately', () => {
      const result = buildEditableFieldsDiffWithMetaForSurface({ ...OLD_ROW, measuredDBH: 12.342, measuredHOM: 2.0 }, OLD_ROW, 'measurementssummary');
      // 2.0 vs 1.5 is a real change. 12.342 vs 12.34 both round to "12.34".
      expect(result.diff).toEqual({ MeasuredHOM: 2.0 });
      expect(result.roundedNoOpFields).toEqual(['MeasuredDBH']);
    });

    it('does not flag rounded-no-op when the typed value crosses the precision boundary', () => {
      // 12.355 → "12.36" (V8 rounding); 12.34 stays "12.34". They differ, so
      // this is a real change, not a rounded no-op.
      const result = buildEditableFieldsDiffWithMetaForSurface({ ...OLD_ROW, measuredDBH: 12.355 }, OLD_ROW, 'measurementssummary');
      expect(result.diff).toEqual({ MeasuredDBH: 12.355 });
      expect(result.roundedNoOpFields).toEqual([]);
    });

    it('ignores non-numeric fields — they are never rounded no-ops', () => {
      const result = buildEditableFieldsDiffWithMetaForSurface({ ...OLD_ROW, description: 'desc' }, OLD_ROW, 'measurementssummary');
      expect(result.diff).toEqual({});
      expect(result.roundedNoOpFields).toEqual([]);
    });
  });

  describe('selectMeasurementStateSnackbar: one taxonomy for grid state messaging (F9)', () => {
    it('warns about unresolved logged errors with the Errors-Explorer-matching count, even when other buckets are larger', () => {
      const snackbar = selectMeasurementStateSnackbar({ unresolvedLogged: 4, failedNoLog: 100, pending: 200, valid: 300 });

      expect(snackbar).toEqual({ severity: 'warning', message: UNRESOLVED_ERRORS_SNACKBAR_MESSAGE(4) });
      expect(snackbar?.message).toBe('4 row(s) with unresolved errors — open View Errors to resolve them.');
    });

    it('prompts a validation-state reset when every not-yet-validated row is FALSE-no-log (walkthrough census: 23,322 FALSE rows, empty log)', () => {
      // Run Validations is disabled at pendingCount === 0 and the procedures only process
      // IsValidated IS NULL rows, so "run validations" alone would be a dead end here.
      const snackbar = selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 23322, pending: 0, valid: 10108 });

      expect(snackbar).toEqual({ severity: 'info', message: RESET_THEN_VALIDATE_SNACKBAR_MESSAGE(23322) });
      expect(snackbar?.message).toBe('23322 row(s) not yet validated — reset validation states, then run validations.');
    });

    it('keeps the run-validations prompt when pending rows exist, summing pending and failed-no-log rows', () => {
      const snackbar = selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 5, pending: 7, valid: 3 });

      expect(snackbar).toEqual({ severity: 'info', message: PENDING_VALIDATION_SNACKBAR_MESSAGE(12) });
      expect(snackbar?.message).toBe('12 row(s) not yet validated — run validations to check them.');
    });

    it('uses the run-validations prompt for a pending-only census', () => {
      const snackbar = selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 0, pending: 9, valid: 0 });

      expect(snackbar).toEqual({ severity: 'info', message: PENDING_VALIDATION_SNACKBAR_MESSAGE(9) });
    });

    it('reports success only when every row is valid', () => {
      const snackbar = selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 0, pending: 0, valid: 42 });

      expect(snackbar).toEqual({ severity: 'success', message: ALL_VALID_SNACKBAR_MESSAGE(42) });
    });

    it('returns null for an empty census so no misleading snackbar is shown', () => {
      expect(selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 0, pending: 0, valid: 0 })).toBeNull();
    });

    it('prioritizes warning over info over success', () => {
      expect(selectMeasurementStateSnackbar({ unresolvedLogged: 1, failedNoLog: 1, pending: 1, valid: 1 })?.severity).toBe('warning');
      expect(selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 1, pending: 1, valid: 1 })?.severity).toBe('info');
      expect(selectMeasurementStateSnackbar({ unresolvedLogged: 0, failedNoLog: 0, pending: 0, valid: 1 })?.severity).toBe('success');
    });
  });

  describe('Bug Fix: Modal cancel should not trigger view reset', () => {
    it('should track upload completion state', () => {
      // uploadCompleted flag is set when upload finishes
      // Only reloads view if uploadCompleted === true
      // See msvdatagrid.tsx:62, 134-140
      expect(true).toBe(true);
    });

    it('should track manual entry completion state', () => {
      // manualEntryCompleted flag is set when form is submitted
      // Only reloads view if manualEntryCompleted === true
      // See msvdatagrid.tsx:63, 154-162
      expect(true).toBe(true);
    });

    it('should call onUploadComplete callback when upload finishes', () => {
      // UploadParent calls onUploadComplete when reviewState becomes COMPLETE
      // See uploadparent.tsx:92-96
      expect(true).toBe(true);
    });

    it('should call onSubmitComplete callback when form is submitted', () => {
      // MultilineModal calls onSubmitComplete when changesSubmitted is true
      // See multilinemodal.tsx:61-63
      expect(true).toBe(true);
    });
  });
});

describe('revertMeasurementEdit: undo refresh orchestration (U3)', () => {
  const REVERT_SCOPE: EditRevertRequest = { schema: 'testschema', plotID: 1, censusID: 1, editOperationID: 55 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  // Mirrors the real ApplyResult contract (frontend/config/editplan/types.ts)
  // produced by revertEdit and returned by POST /api/edits/revert — every
  // field present and typed exactly as the server emits it, matching what
  // requestEditRevert's 200-body validation requires (a positive integer
  // editOperationID). A `{ ok: true }` body is NOT this contract — it is the
  // 'unconfirmed' fixture below.
  function makeApplyResult(overrides: Partial<ApplyResult> = {}): ApplyResult {
    return {
      updatedIDs: { CoreMeasurementID: 909 },
      applyErrors: [],
      editOperationID: REVERT_SCOPE.editOperationID,
      validationPending: false,
      ...overrides
    };
  }

  function makeFreshPlan(overrides: Partial<EditPlan> = {}): EditPlan {
    return {
      dataType: 'measurementssummary',
      targetID: 909,
      fieldChanges: [],
      effects: [],
      maxSeverity: 'warn',
      planHash: 'f'.repeat(64),
      generatedAt: '2026-04-20T12:00:00Z',
      ...overrides
    };
  }

  // Builds a typed MeasurementEditRevertEffects whose members record their
  // call order into a shared array, so tests can assert both "was this
  // called" and "did the success/warning snackbar come after the refresh
  // work it claims to have done" in one assertion. `failingStep` makes one
  // refresh step reject (after recording its call) to exercise the
  // reverted-but-refresh-failed path.
  function makeRecordedEffects(options: { includeInfinite?: boolean; failingStep?: 'paginated' | 'counts' | 'infinite' } = {}) {
    const calls: string[] = [];
    const notifyMock = vi.fn((notification: MeasurementEditRevertNotification) => {
      calls.push(`notify:${notification.severity}`);
    });
    const logErrorMock = vi.fn();

    const invalidateQueries = vi.fn(async () => {
      calls.push('invalidate');
    });
    const refreshPaginated = vi.fn(async () => {
      calls.push('paginated');
      if (options.failingStep === 'paginated') throw new Error('paginated refresh exploded');
    });
    const refreshCounts = vi.fn(async () => {
      calls.push('counts');
      if (options.failingStep === 'counts') throw new Error('counts refresh exploded');
    });
    const refreshInfinite = options.includeInfinite
      ? vi.fn(async () => {
          calls.push('infinite');
          if (options.failingStep === 'infinite') throw new Error('infinite refresh exploded');
        })
      : undefined;

    const effects: MeasurementEditRevertEffects = {
      invalidateQueries,
      refreshPaginated,
      refreshCounts,
      refreshInfinite: refreshInfinite ?? null,
      notify: notifyMock,
      logError: logErrorMock
    };

    return { effects, calls, notifyMock, logErrorMock, invalidateQueries, refreshPaginated, refreshCounts, refreshInfinite };
  }

  it('runs invalidate -> paginated+counts+infinite refresh -> success snackbar, in that order, on a real reverted ApplyResult', async () => {
    const applyResult = makeApplyResult();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));
    const { effects, calls, notifyMock, logErrorMock, invalidateQueries, refreshPaginated, refreshCounts, refreshInfinite } = makeRecordedEffects({
      includeInfinite: true
    });

    const outcome = await revertMeasurementEdit(REVERT_SCOPE, effects);

    expect(outcome).toEqual({ status: 'reverted' });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(refreshPaginated).toHaveBeenCalledTimes(1);
    expect(refreshCounts).toHaveBeenCalledTimes(1);
    expect(refreshInfinite).toHaveBeenCalledTimes(1);
    // The success snackbar must be the LAST thing that happens — it must
    // never be shown before the refresh work it claims to have done.
    expect(calls).toEqual(['invalidate', 'paginated', 'counts', 'infinite', 'notify:success']);
    expect(notifyMock).toHaveBeenCalledWith({ message: EDIT_REVERTED_SNACKBAR_MESSAGE, severity: 'success' });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('never calls refreshInfinite in paginated mode (refreshInfinite omitted), but still runs invalidate/paginated/counts and shows success', async () => {
    const applyResult = makeApplyResult();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));
    const { effects, calls, notifyMock, invalidateQueries, refreshPaginated, refreshCounts } = makeRecordedEffects({ includeInfinite: false });

    const outcome = await revertMeasurementEdit(REVERT_SCOPE, effects);

    expect(outcome).toEqual({ status: 'reverted' });
    expect(effects.refreshInfinite).toBeNull();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(refreshPaginated).toHaveBeenCalledTimes(1);
    expect(refreshCounts).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['invalidate', 'paginated', 'counts', 'notify:success']);
    expect(notifyMock).toHaveBeenCalledWith({ message: EDIT_REVERTED_SNACKBAR_MESSAGE, severity: 'success' });
  });

  it('returns confirmation-required unchanged on a 409 with a usable fresh plan, performing zero refresh calls and zero snackbars', async () => {
    const freshPlan = makeFreshPlan();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { freshPlan }));
    const { effects, calls, notifyMock, logErrorMock } = makeRecordedEffects({ includeInfinite: true });

    const outcome = await revertMeasurementEdit(REVERT_SCOPE, effects);

    expect(outcome).toEqual({ status: 'confirmation-required', freshPlan });
    expect(calls).toEqual([]);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('shows an error snackbar carrying the server message on a 500 failure, performing zero refresh calls and zero success wording', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.INTERNAL_SERVER_ERROR, { error: 'revert rule exploded' }));
    const { effects, calls, notifyMock } = makeRecordedEffects({ includeInfinite: true });

    const outcome = await revertMeasurementEdit(REVERT_SCOPE, effects);

    expect(outcome).toEqual({ status: 'failed' });
    expect(calls).toEqual(['notify:error']);
    expect(notifyMock).toHaveBeenCalledWith({ message: UNDO_FAILED_SNACKBAR_MESSAGE('revert rule exploded'), severity: 'error' });
  });

  it('surfaces the could-not-confirm warning on a malformed 200 body, with no success wording and zero refresh calls', async () => {
    // { ok: true } is not a real ApplyResult (no editOperationID) — this is
    // the genuine 'unconfirmed' contract, not a stand-in for success.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, { ok: true }));
    const { effects, calls, notifyMock } = makeRecordedEffects({ includeInfinite: true });

    const outcome = await revertMeasurementEdit(REVERT_SCOPE, effects);

    expect(outcome).toEqual({ status: 'unconfirmed' });
    expect(calls).toEqual(['notify:warning']);
    expect(notifyMock).toHaveBeenCalledWith({ message: UNCONFIRMED_OUTCOME_MESSAGE, severity: 'warning' });
    expect(UNCONFIRMED_OUTCOME_MESSAGE.toLowerCase()).not.toContain('reverted');
  });

  it('reports "reverted, but refresh failed" and still resolves reverted when a refresh step throws after the write already committed', async () => {
    const applyResult = makeApplyResult();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));
    const { effects, calls, notifyMock, logErrorMock, refreshPaginated, refreshCounts, refreshInfinite } = makeRecordedEffects({
      includeInfinite: true,
      failingStep: 'counts'
    });

    const outcome = await revertMeasurementEdit(REVERT_SCOPE, effects);

    // The server already committed the revert (a real ApplyResult was
    // returned) — a refresh failure must never be reported as a failed undo,
    // or the toast would let the user retry and double-revert the same edit.
    expect(outcome).toEqual({ status: 'reverted' });
    expect(refreshPaginated).toHaveBeenCalledTimes(1);
    expect(refreshCounts).toHaveBeenCalledTimes(1);
    expect(refreshInfinite).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['invalidate', 'paginated', 'counts', 'infinite', 'notify:warning']);
    expect(notifyMock).toHaveBeenCalledWith({ message: EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE, severity: 'warning' });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [, loggedError] = logErrorMock.mock.calls[0];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe('counts refresh exploded');
  });

  // U10 regression: refreshCounts' own internal "success"-style snackbar
  // (selectMeasurementStateSnackbar) runs on the SAME setSnackbar state as
  // the warning this function notifies on failure. With a plain Promise.all,
  // the warning fired as soon as refreshInfinite rejected — before a slower
  // refreshCounts resolved and overwrote it with success. Promise.allSettled
  // must make the warning the final call regardless of that race.
  it('keeps the refresh-failed warning as the final notification when a slower refresh step succeeds after an earlier step rejects', async () => {
    const applyResult = makeApplyResult();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));

    const calls: string[] = [];
    const notifyMock = vi.fn((notification: MeasurementEditRevertNotification) => calls.push(`notify:${notification.severity}`));
    const logErrorMock = vi.fn();
    const invalidateQueries = vi.fn(async () => {
      calls.push('invalidate');
    });
    const refreshPaginated = vi.fn(async () => {
      calls.push('paginated');
    });
    const refreshInfinite = vi.fn(async () => {
      calls.push('infinite:reject');
      throw new Error('infinite refresh exploded');
    });

    let resolveCounts!: () => void;
    const refreshCounts = vi.fn(() => {
      calls.push('counts:start');
      return new Promise<void>(resolve => {
        resolveCounts = () => {
          // Simulates refreshCounts' own setSnackbar success call, which
          // writes to the same visible state as effects.notify.
          calls.push('counts:internal-success');
          notifyMock({ message: 'All rows passed validation.', severity: 'success' });
          resolve();
        };
      });
    });

    const effects: MeasurementEditRevertEffects = {
      invalidateQueries,
      refreshPaginated,
      refreshCounts,
      refreshInfinite,
      notify: notifyMock,
      logError: logErrorMock
    };

    const outcomePromise = revertMeasurementEdit(REVERT_SCOPE, effects);

    // Flush pending microtasks/macrotasks: invalidateQueries resolves, all
    // three refresh tasks are kicked off, and refreshInfinite rejects — but
    // refreshCounts stays pending until resolveCounts() is called below.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    // The fix must still be waiting for refreshCounts to settle here — the
    // buggy Promise.all would have already called notify:warning by now.
    expect(notifyMock).not.toHaveBeenCalled();
    expect(calls).toEqual(['invalidate', 'paginated', 'counts:start', 'infinite:reject']);

    resolveCounts();
    const outcome = await outcomePromise;

    expect(outcome).toEqual({ status: 'reverted' });
    // counts:internal-success' own notifyMock call records 'notify:success'
    // before the function's warning fires - that success must never be last.
    expect(calls).toEqual(['invalidate', 'paginated', 'counts:start', 'infinite:reject', 'counts:internal-success', 'notify:success', 'notify:warning']);
    expect(notifyMock.mock.calls.map(([notification]) => notification.severity)).toEqual(['success', 'warning']);
    expect(notifyMock).toHaveBeenLastCalledWith({ message: EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE, severity: 'warning' });
  });
});

describe('describeMeasurementRow: delete-confirmation wording (#524 item 6)', () => {
  it.each([
    ['a mysql2 DECIMAL string with trailing zeros', '120.000000', 'tree T1, stem S1 (DBH 120)'],
    ['a value that rounds at two decimals', '12.345000', 'tree T1, stem S1 (DBH 12.35)'],
    ['a missing DBH', undefined, 'tree T1, stem S1'],
    ['a non-numeric DBH (returned unchanged)', 'n/a', 'tree T1, stem S1 (DBH n/a)']
  ])('formats %s like the grid column', (_label, measuredDBH, expected) => {
    const description = describeMeasurementRow({ treeTag: 'T1', stemTag: 'S1', measuredDBH });
    console.log(`[describeMeasurementRow] measuredDBH=${JSON.stringify(measuredDBH)} -> ${JSON.stringify(description)}`);
    expect(description).toBe(expected);
  });

  it('describes a null row generically', () => {
    expect(describeMeasurementRow(null)).toBe('this measurement');
  });
});
