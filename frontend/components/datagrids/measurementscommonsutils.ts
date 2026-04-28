import { GridFilterItem, GridFilterModel, GridPaginationModel, GridRowModel, GridSortModel } from '@mui/x-data-grid';
import { ExtendedGridFilterModel, TSSFilter, VisibleFilter } from '@/config/datagridhelpers';
import { EDITABLE_FIELDS_BY_SURFACE, EditSurface, FIELD_ALIASES_BY_SURFACE, PER_COLUMN_DECIMAL_PRECISION } from '@/config/editplan/fieldpolicy';

// Numeric edits that round to the existing value at server precision are
// detected here so the client can (a) skip the API roundtrip and (b) tell the
// user their typing didn't change anything. Without this, typing 1.234 over
// 1.23 in a DBH cell silently disappears (server normalizes both to 1.23).
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

function areArraysEqual<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => Object.is(value, rightValues[index]));
}

function normalizeFilterItem(item: GridFilterItem) {
  return {
    field: item.field ?? '',
    operator: item.operator ?? '',
    value: item.value ?? null
  };
}

function areFilterItemsEqual(left: readonly GridFilterItem[] | undefined, right: readonly GridFilterItem[] | undefined): boolean {
  const leftItems = left ?? [];
  const rightItems = right ?? [];

  if (leftItems.length !== rightItems.length) {
    return false;
  }

  return leftItems.every((item, index) => {
    const normalizedLeft = normalizeFilterItem(item);
    const normalizedRight = normalizeFilterItem(rightItems[index]);

    return (
      normalizedLeft.field === normalizedRight.field &&
      normalizedLeft.operator === normalizedRight.operator &&
      Object.is(normalizedLeft.value, normalizedRight.value)
    );
  });
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
