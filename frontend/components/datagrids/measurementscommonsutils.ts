import { GridFilterItem, GridFilterModel, GridPaginationModel, GridSortModel } from '@mui/x-data-grid';
import { ExtendedGridFilterModel, TSSFilter, VisibleFilter } from '@/config/datagridhelpers';

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
