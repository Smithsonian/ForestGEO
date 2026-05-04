import type { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';

export const VALUELESS_FILTER_OPERATORS = new Set(['isEmpty', 'isNotEmpty']);

export function isNonEmptyFilterValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isNonEmptyFilterValue);
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function sanitizeQuickFilterValues(values: GridFilterModel['quickFilterValues']): NonNullable<GridFilterModel['quickFilterValues']> {
  return (values ?? []).filter(isNonEmptyFilterValue).map(value => (typeof value === 'string' ? value.trim() : value));
}

export function isActiveFilterItem(item: GridFilterItem): boolean {
  if (!item.field || !item.operator) return false;
  return VALUELESS_FILTER_OPERATORS.has(item.operator) || isNonEmptyFilterValue(item.value);
}

export function toServerFilterItem(item: GridFilterItem): GridFilterItem {
  const { id: _id, value, ...serverItem } = item;
  if (Array.isArray(value)) {
    return { ...serverItem, value: value.filter(isNonEmptyFilterValue) };
  }
  return { ...serverItem, value };
}

export function areArraysEqual<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): boolean {
  const l = left ?? [];
  const r = right ?? [];
  return l.length === r.length && l.every((v, i) => Object.is(v, r[i]));
}

export function areFilterValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && areArraysEqual(left, right);
  }
  return Object.is(left ?? null, right ?? null);
}

export function areFilterItemsEqual(left: readonly GridFilterItem[] | undefined, right: readonly GridFilterItem[] | undefined): boolean {
  const l = left ?? [];
  const r = right ?? [];
  return (
    l.length === r.length &&
    l.every((item, i) => item.field === r[i]?.field && item.operator === r[i]?.operator && areFilterValuesEqual(item.value, r[i]?.value))
  );
}

export function toServerFilterModel(model: GridFilterModel): GridFilterModel {
  const items = (model.items ?? []).filter(isActiveFilterItem).map(toServerFilterItem);
  const quickFilterValues = sanitizeQuickFilterValues(model.quickFilterValues);
  const out: GridFilterModel = { items, quickFilterValues };
  if (items.length > 1 && model.logicOperator) out.logicOperator = model.logicOperator;
  if (quickFilterValues.length > 1 && model.quickFilterLogicOperator) out.quickFilterLogicOperator = model.quickFilterLogicOperator;
  return out;
}

export function areGridFilterModelsEqual(left: GridFilterModel, right: GridFilterModel): boolean {
  return (
    areFilterItemsEqual(left.items, right.items) &&
    areArraysEqual(left.quickFilterValues, right.quickFilterValues) &&
    left.logicOperator === right.logicOperator &&
    left.quickFilterLogicOperator === right.quickFilterLogicOperator &&
    left.quickFilterExcludeHiddenColumns === right.quickFilterExcludeHiddenColumns
  );
}
