import {
  isErrorExplorerColumnField,
  isErrorExplorerNumberField,
  isOperatorAllowedForField,
  isValuelessFilterOperator,
  toFiniteNumberOrNull,
  type ErrorExplorerColumnField,
  type ErrorExplorerColumnFilter,
  type ErrorExplorerFilterOperator,
  type ErrorExplorerSortItem
} from '@/config/errorsexplorer';

/** The display values a filter or sort reads; the server passes ErrorExplorerRow, the Cypress mock its fixtures. */
export type ColumnValueRow = { coreMeasurementID: number } & Partial<Record<ErrorExplorerColumnField, unknown>>;

const ASCENDING = 'asc';

export function toTextCellValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function matchesTextFilter(cell: string | null, operator: ErrorExplorerFilterOperator, value: unknown): boolean {
  if (operator === 'isEmpty') return cell === null;
  if (operator === 'isNotEmpty') return cell !== null;
  if (cell === null) return false;
  const haystack = cell.toLowerCase();
  const needle = String(value).trim().toLowerCase();
  switch (operator) {
    case 'contains':
      return haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    default:
      return false;
  }
}

function matchesNumberFilter(cell: number | null, operator: ErrorExplorerFilterOperator, value: unknown): boolean {
  if (operator === 'isEmpty') return cell === null;
  if (operator === 'isNotEmpty') return cell !== null;
  const target = toFiniteNumberOrNull(value);
  if (target === null) return false;
  if (operator === '!=') return cell !== target;
  if (cell === null) return false;
  switch (operator) {
    case '=':
      return cell === target;
    case '>':
      return cell > target;
    case '>=':
      return cell >= target;
    case '<':
      return cell < target;
    case '<=':
      return cell <= target;
    default:
      return false;
  }
}

export function matchesColumnFilter(row: ColumnValueRow, filter: ErrorExplorerColumnFilter): boolean {
  const cell = row[filter.field];
  return isErrorExplorerNumberField(filter.field)
    ? matchesNumberFilter(toFiniteNumberOrNull(cell), filter.operator, filter.value)
    : matchesTextFilter(toTextCellValue(cell), filter.operator, filter.value);
}

export function compareRowsBySortItem(a: ColumnValueRow, b: ColumnValueRow, item: ErrorExplorerSortItem): number {
  const idDelta = a.coreMeasurementID - b.coreMeasurementID;
  const isNumber = isErrorExplorerNumberField(item.field);
  const left = isNumber ? toFiniteNumberOrNull(a[item.field]) : toTextCellValue(a[item.field]);
  const right = isNumber ? toFiniteNumberOrNull(b[item.field]) : toTextCellValue(b[item.field]);
  if (left === null && right === null) return idDelta;
  if (left === null) return 1;
  if (right === null) return -1;
  const delta = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
  if (delta !== 0) return item.sort === ASCENDING ? delta : -delta;
  return idDelta;
}

export interface GridFilterItemLike {
  field: string;
  operator: string;
  value?: unknown;
}

export interface GridSortItemLike {
  field: string;
  sort?: 'asc' | 'desc' | null;
}

/** The MIT grid allows one item; the client sends it only when the server would accept it. */
export function toServerColumnFilters(items: readonly GridFilterItemLike[]): ErrorExplorerColumnFilter[] {
  const item = items[0];
  if (!item || !isErrorExplorerColumnField(item.field) || !isOperatorAllowedForField(item.field, item.operator)) return [];
  const operator = item.operator as ErrorExplorerFilterOperator;
  if (isValuelessFilterOperator(operator)) return [{ field: item.field, operator }];
  if (isErrorExplorerNumberField(item.field)) {
    return typeof item.value === 'number' && Number.isFinite(item.value) ? [{ field: item.field, operator, value: item.value }] : [];
  }
  return typeof item.value === 'string' && item.value.trim().length > 0 ? [{ field: item.field, operator, value: item.value }] : [];
}

export function toServerSortModel(items: readonly GridSortItemLike[]): ErrorExplorerSortItem[] {
  const item = items[0];
  if (!item || !isErrorExplorerColumnField(item.field) || (item.sort !== 'asc' && item.sort !== 'desc')) return [];
  return [{ field: item.field, sort: item.sort }];
}
