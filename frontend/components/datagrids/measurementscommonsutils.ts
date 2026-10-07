import { GridFilterModel, GridPaginationModel, GridRowModel, GridSortModel } from '@mui/x-data-grid';
import { ExtendedGridFilterModel, TSSFilter, VisibleFilter } from '@/config/datagridhelpers';
import { EDITABLE_FIELDS_BY_SURFACE, EditSurface, FIELD_ALIASES_BY_SURFACE, PER_COLUMN_DECIMAL_PRECISION } from '@/config/editplan/fieldpolicy';
import { areArraysEqual, areFilterItemsEqual, isActiveFilterItem, sanitizeQuickFilterValues, toServerFilterItem } from '@/lib/datagrid/filterModel';
import { EditRevertRequest, requestEditRevert } from '@/lib/editplan/requestrevert';
import type { UndoRevertOutcome } from '@/components/editplan/undotoast';

// Detects edits that round to the existing server-precision value, so typing
// 1.234 over 1.23 in a DBH cell isn't silently dropped as a no-op elsewhere.
function findRoundedNoOpField(canonicalField: string, newValue: unknown, oldValue: unknown): boolean {
  const precision = PER_COLUMN_DECIMAL_PRECISION[canonicalField];
  if (precision === undefined) return false;
  const newNum = Number(newValue);
  const oldNum = Number(oldValue);
  if (!Number.isFinite(newNum) || !Number.isFinite(oldNum)) return false;
  if (newNum === oldNum) return false;
  return newNum.toFixed(precision) === oldNum.toFixed(precision);
}

export interface EditableFieldsDiffResult {
  diff: Record<string, unknown>;
  // Canonical field names whose typed value rounded to the existing value at
  // server precision. Caller surfaces a hint snackbar so the user knows their
  // edit was a no-op (rather than wondering why nothing happened).
  roundedNoOpFields: string[];
}

export function buildEditableFieldsDiffWithMetaForSurface(newRow: GridRowModel, oldRow: GridRowModel, surface: EditSurface): EditableFieldsDiffResult {
  const editableFields = EDITABLE_FIELDS_BY_SURFACE[surface];
  const aliases = FIELD_ALIASES_BY_SURFACE[surface];
  const diff: Record<string, unknown> = {};
  const roundedNoOpFields: string[] = [];
  for (const [rawKey, newValue] of Object.entries(newRow)) {
    const canonicalField = aliases[rawKey] ?? rawKey;
    if (!editableFields.has(canonicalField)) continue;
    const oldValue = oldRow[rawKey];
    if (Object.is(newValue, oldValue)) continue;
    if (newValue instanceof Date || oldValue instanceof Date) {
      const newTime = newValue instanceof Date ? newValue.getTime() : newValue;
      const oldTime = oldValue instanceof Date ? oldValue.getTime() : oldValue;
      if (newTime === oldTime) continue;
    }
    if (findRoundedNoOpField(canonicalField, newValue, oldValue)) {
      roundedNoOpFields.push(canonicalField);
      continue;
    }
    diff[canonicalField] = newValue;
  }
  return { diff, roundedNoOpFields };
}

export function buildEditableFieldsDiffForSurface(newRow: GridRowModel, oldRow: GridRowModel, surface: EditSurface): Record<string, unknown> {
  return buildEditableFieldsDiffWithMetaForSurface(newRow, oldRow, surface).diff;
}

export function buildEditableFieldsDiff(newRow: GridRowModel, oldRow: GridRowModel): Record<string, unknown> {
  return buildEditableFieldsDiffForSurface(newRow, oldRow, 'measurementssummary');
}

export interface FormattedQueryRequest {
  query: string;
  params: Array<string | number>;
  format: true;
}

export function buildMeasurementVisibleFilters(showErrorRows: boolean, showValidRows: boolean, showPendingRows: boolean): VisibleFilter[] {
  return [
    ...(showErrorRows ? (['errors'] as VisibleFilter[]) : []),
    ...(showValidRows ? (['valid'] as VisibleFilter[]) : []),
    ...(showPendingRows ? (['pending'] as VisibleFilter[]) : [])
  ];
}

export function buildMeasurementTssFilters(showOT: boolean, showMS: boolean, showNR: boolean): TSSFilter[] {
  return [
    ...(showOT ? (['old tree'] as TSSFilter[]) : []),
    ...(showMS ? (['multi stem'] as TSSFilter[]) : []),
    ...(showNR ? (['new recruit'] as TSSFilter[]) : [])
  ];
}

export function areExtendedFilterModelsEqual(left: ExtendedGridFilterModel, right: ExtendedGridFilterModel): boolean {
  return (
    areFilterItemsEqual(left.items, right.items) &&
    areArraysEqual(left.quickFilterValues, right.quickFilterValues) &&
    areArraysEqual(left.visible, right.visible) &&
    areArraysEqual(left.tss, right.tss) &&
    left.logicOperator === right.logicOperator &&
    left.quickFilterLogicOperator === right.quickFilterLogicOperator &&
    left.quickFilterExcludeHiddenColumns === right.quickFilterExcludeHiddenColumns
  );
}

export function mergeMeasurementFilterModel(
  previousModel: ExtendedGridFilterModel,
  incomingModel: Partial<GridFilterModel> & Partial<Pick<ExtendedGridFilterModel, 'visible' | 'tss'>>
): ExtendedGridFilterModel {
  const nextModel: ExtendedGridFilterModel = {
    ...previousModel,
    ...incomingModel,
    items: [...(incomingModel.items ?? previousModel.items ?? [])],
    quickFilterValues: [...(incomingModel.quickFilterValues ?? previousModel.quickFilterValues ?? [])],
    visible: [...(incomingModel.visible ?? previousModel.visible ?? [])],
    tss: [...(incomingModel.tss ?? previousModel.tss ?? [])]
  };

  return areExtendedFilterModelsEqual(previousModel, nextModel) ? previousModel : nextModel;
}

export function toServerMeasurementFilterModel(model: ExtendedGridFilterModel): ExtendedGridFilterModel {
  const items = (model.items ?? []).filter(isActiveFilterItem).map(toServerFilterItem);
  const quickFilterValues = sanitizeQuickFilterValues(model.quickFilterValues);
  const serverModel: ExtendedGridFilterModel = {
    items,
    quickFilterValues,
    visible: [...(model.visible ?? [])],
    tss: [...(model.tss ?? [])]
  };

  if (items.length > 1 && model.logicOperator) {
    serverModel.logicOperator = model.logicOperator;
  }

  if (quickFilterValues.length > 1 && model.quickFilterLogicOperator) {
    serverModel.quickFilterLogicOperator = model.quickFilterLogicOperator;
  }

  if (quickFilterValues.length > 0 && model.quickFilterExcludeHiddenColumns !== undefined) {
    serverModel.quickFilterExcludeHiddenColumns = model.quickFilterExcludeHiddenColumns;
  }

  return serverModel;
}

export function areGridSortModelsEqual(left: GridSortModel, right: GridSortModel): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item.field === right[index]?.field && item.sort === right[index]?.sort);
}

export function arePaginationModelsEqual(left: GridPaginationModel, right: GridPaginationModel): boolean {
  return left.page === right.page && left.pageSize === right.pageSize;
}

export function shouldUseAutoMeasurementRowHeight(userAgent?: string | null): boolean {
  if (!userAgent) {
    return true;
  }

  return !/firefox/i.test(userAgent);
}

export function shouldRefreshMeasurementsAfterValidationTransition(
  previousStatus: 'idle' | 'running' | 'completed' | 'failed',
  nextStatus: 'idle' | 'running' | 'completed' | 'failed'
): boolean {
  return previousStatus === 'running' && (nextStatus === 'completed' || nextStatus === 'failed');
}

export function createResetValidationErrorsQuery(schema: string, plotID: number, censusID: number): FormattedQueryRequest {
  return {
    query: `UPDATE ??.measurement_error_log mel
            JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
            JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
            JOIN ??.census c ON c.CensusID = cm.CensusID
            SET mel.IsResolved = TRUE,
                mel.ResolvedAt = NOW()
            WHERE c.CensusID = ?
              AND c.PlotID = ?
              AND me.ErrorSource = 'validation'
              AND mel.IsResolved = FALSE`,
    params: [schema, schema, schema, schema, censusID, plotID],
    format: true
  };
}

export function createResetValidationStatesQuery(schema: string, plotID: number, censusID: number): FormattedQueryRequest {
  return {
    query: `UPDATE ??.coremeasurements cm
            JOIN ??.census c ON c.CensusID = cm.CensusID
            SET cm.IsValidated = NULL
            WHERE c.CensusID = ?
              AND c.PlotID = ?`,
    params: [schema, schema, censusID, plotID],
    format: true
  };
}

export const UNRESOLVED_ERRORS_SNACKBAR_MESSAGE = (count: number) => `${count} row(s) with unresolved errors — open View Errors to resolve them.`;
export const PENDING_VALIDATION_SNACKBAR_MESSAGE = (count: number) => `${count} row(s) not yet validated — run validations to check them.`;
export const RESET_THEN_VALIDATE_SNACKBAR_MESSAGE = (count: number) => `${count} row(s) not yet validated — reset validation states, then run validations.`;
export const ALL_VALID_SNACKBAR_MESSAGE = (count: number) => `${count} row(s) passed validation.`;

export interface MeasurementStateCounts {
  unresolvedLogged: number;
  failedNoLog: number;
  pending: number;
  valid: number;
}

export interface MeasurementStateSnackbar {
  severity: 'warning' | 'info' | 'success';
  message: string;
}

export function selectMeasurementStateSnackbar(counts: MeasurementStateCounts): MeasurementStateSnackbar | null {
  if (counts.unresolvedLogged > 0) {
    return { severity: 'warning', message: UNRESOLVED_ERRORS_SNACKBAR_MESSAGE(counts.unresolvedLogged) };
  }

  // failedNoLog rows count as "not yet validated": they may be a hard failure
  // whose error-log link was dropped (see migration 51_backfill_hard_failure_error_log.sql).
  const notYetValidated = counts.pending + counts.failedNoLog;
  if (notYetValidated > 0) {
    // FALSE-without-log rows carry no unresolved validation error, so they are outside
    // prepareValidationRun's rerun reset (CountRevalidatable = 0) and the Run Validations menu
    // entry stays disabled for them — "run validations" would be a dead end; prompt the reset first.
    const message = counts.pending > 0 ? PENDING_VALIDATION_SNACKBAR_MESSAGE(notYetValidated) : RESET_THEN_VALIDATE_SNACKBAR_MESSAGE(notYetValidated);
    return { severity: 'info', message };
  }

  if (counts.valid > 0) {
    return { severity: 'success', message: ALL_VALID_SNACKBAR_MESSAGE(counts.valid) };
  }

  return null;
}

// --- Undo (edit revert) orchestration ---------------------------------
// Once requestEditRevert resolves 'reverted' the write already committed;
// a refresh failure here must never be reported as a failed undo.

export interface MeasurementEditRevertNotification {
  message: string;
  severity: 'success' | 'warning' | 'error';
}

export interface MeasurementEditRevertEffects {
  invalidateQueries: () => Promise<void>;
  refreshPaginated: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  // Pass null (or omit) when infinite scroll is not the grid's active mode.
  refreshInfinite?: (() => Promise<void>) | null;
  notify: (notification: MeasurementEditRevertNotification) => void;
  logError: (message: string, error: Error) => void;
}

export const EDIT_REVERTED_SNACKBAR_MESSAGE = 'Edit reverted';
export const UNDO_FAILED_SNACKBAR_MESSAGE = (message: string) => `Undo failed: ${message}`;
export const EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE = 'Edit reverted, but the view could not be refreshed. Reload the page to see current data.';
const EDIT_REVERT_REFRESH_FAILURE_LOG_MESSAGE = 'revertMeasurementEdit: refreshing the view after a successful revert failed';

export async function revertMeasurementEdit(scope: EditRevertRequest, effects: MeasurementEditRevertEffects): Promise<UndoRevertOutcome> {
  const outcome = await requestEditRevert(scope);

  if (outcome.status === 'confirmation-required') {
    // No refresh, no snackbar — the toast is about to show the confirmation
    // preview for the same operation.
    return outcome;
  }

  if (outcome.status === 'failed') {
    effects.notify({ message: UNDO_FAILED_SNACKBAR_MESSAGE(outcome.message), severity: 'error' });
    return { status: 'failed' };
  }

  if (outcome.status === 'unconfirmed') {
    // Write may or may not have committed; never claim success or refresh.
    effects.notify({ message: outcome.message, severity: 'warning' });
    return { status: 'unconfirmed' };
  }

  try {
    await effects.invalidateQueries();
    const refreshTasks: Promise<void>[] = [effects.refreshPaginated(), effects.refreshCounts()];
    if (effects.refreshInfinite) refreshTasks.push(effects.refreshInfinite());
    // allSettled, not all: waiting for every task guarantees the notify()
    // below always runs last, even if a sibling task's own internal success
    // notification is still pending when another task rejects.
    const settled = await Promise.allSettled(refreshTasks);
    const firstRejection = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (firstRejection) throw firstRejection.reason;
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    effects.logError(EDIT_REVERT_REFRESH_FAILURE_LOG_MESSAGE, errorObj);
    // The revert already committed server-side; this must still resolve as
    // 'reverted' so UndoToast dismisses and the write is never retried.
    effects.notify({ message: EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE, severity: 'warning' });
    return { status: 'reverted' };
  }

  effects.notify({ message: EDIT_REVERTED_SNACKBAR_MESSAGE, severity: 'success' });
  return { status: 'reverted' };
}
