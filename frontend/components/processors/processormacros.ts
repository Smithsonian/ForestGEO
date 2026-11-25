// processormacros.tsx
import { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';
import { capitalizeAndTransformField } from '@/config/utils';
import { escape } from 'mysql2';
import { safeEscapeId } from '@/lib/db/sqlsecurity';

export type Operator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'is'
  | 'isNot'
  | 'isAfter'
  | 'isOnOrAfter'
  | 'isBefore'
  | 'isOnOrBefore'
  | 'contains'
  | 'doesNotContain'
  | 'equals'
  | 'doesNotEqual'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isAnyOf';

export const UNSUPPORTED_LOGIC_OPERATOR_MESSAGE = 'Unsupported filter logic operator';
const DEFAULT_LOGIC_OPERATOR_SQL = 'AND';
const LOGIC_OPERATOR_SQL: Readonly<Record<string, 'AND' | 'OR'>> = { and: 'AND', or: 'OR' };

/** Every operator buildCondition implements; a filter item with any other operator is dropped by buildFilterModelStub. */
export const SUPPORTED_FILTER_OPERATORS: ReadonlySet<string> = new Set<Operator>([
  'contains',
  'doesNotContain',
  'equals',
  'is',
  '=',
  'doesNotEqual',
  'isNot',
  '!=',
  'startsWith',
  'endsWith',
  'isAfter',
  '>',
  'isOnOrAfter',
  '>=',
  'isBefore',
  '<',
  'isOnOrBefore',
  '<=',
  'isEmpty',
  'isNotEmpty',
  'isAnyOf'
]);

export class UnsupportedFilterLogicOperatorError extends Error {
  constructor(readonly logicOperator: unknown) {
    super(UNSUPPORTED_LOGIC_OPERATOR_MESSAGE);
    this.name = 'UnsupportedFilterLogicOperatorError';
  }
}

/** The request's logicOperator becomes SQL text, so only the two keywords are allowed (missing or empty means AND, as before). */
export function resolveFilterLogicOperatorSql(logicOperator: unknown): 'AND' | 'OR' {
  if (logicOperator === undefined || logicOperator === null || logicOperator === '') return DEFAULT_LOGIC_OPERATOR_SQL;
  if (typeof logicOperator !== 'string') throw new UnsupportedFilterLogicOperatorError(logicOperator);
  const keyword = Object.prototype.hasOwnProperty.call(LOGIC_OPERATOR_SQL, logicOperator.toLowerCase())
    ? LOGIC_OPERATOR_SQL[logicOperator.toLowerCase()]
    : undefined;
  if (!keyword) throw new UnsupportedFilterLogicOperatorError(logicOperator);
  return keyword;
}

// Escape wildcard characters for LIKE queries (Bug #2 fix)
function escapeLikeWildcards(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function buildCondition({ operator, column, value }: { operator: Operator; column: string; value?: number | string | string[] }): string {
  // SQL injection protection: validate and escape column name
  const safeColumn = safeEscapeId(column);

  switch (operator) {
    case 'contains':
      // Escape LIKE wildcards on the value, then wrap the full pattern as a safe SQL literal (Bug #2 fix)
      return `${safeColumn} LIKE ${escape(`%${escapeLikeWildcards(value as string)}%`)} ESCAPE '\\\\'`;
    case 'doesNotContain':
      return `${safeColumn} NOT LIKE ${escape(`%${escapeLikeWildcards(value as string)}%`)} ESCAPE '\\\\'`;
    case 'equals':
    case 'is':
    case '=':
      return `${safeColumn} = ${typeof value === 'number' ? value : escape(value as string)}`;
    case 'doesNotEqual':
    case 'isNot':
    case '!=':
      return `${safeColumn} <> ${typeof value === 'number' ? value : escape(value as string)}`;
    case 'startsWith':
      return `${safeColumn} LIKE ${escape(`${escapeLikeWildcards(value as string)}%`)} ESCAPE '\\\\'`;
    case 'endsWith':
      return `${safeColumn} LIKE ${escape(`%${escapeLikeWildcards(value as string)}`)} ESCAPE '\\\\'`;
    case 'isAfter':
    case '>':
      return `${safeColumn} > ${typeof value === 'number' ? value : escape(value as string)}`;
    case 'isOnOrAfter':
    case '>=':
      return `${safeColumn} >= ${typeof value === 'number' ? value : escape(value as string)}`;
    case 'isBefore':
    case '<':
      return `${safeColumn} < ${typeof value === 'number' ? value : escape(value as string)}`;
    case 'isOnOrBefore':
    case '<=':
      return `${safeColumn} <= ${typeof value === 'number' ? value : escape(value as string)}`;
    case 'isEmpty':
      return `(${safeColumn} = '' OR ${safeColumn} IS NULL)`;
    case 'isNotEmpty':
      return `(${safeColumn} <> '' AND ${safeColumn} IS NOT NULL)`;
    case 'isAnyOf':
      if (Array.isArray(value)) {
        const values = value.map(val => escape(val)).join(', ');
        return `${safeColumn} IN (${values})`;
      }
      throw new Error('For "is any of", value must be an array.');
    default:
      throw new Error('Unsupported operator');
  }
}

export const buildFilterModelStub = (filterModel: GridFilterModel, alias?: string) => {
  const logicOperatorSql = resolveFilterLogicOperatorSql(filterModel?.logicOperator);
  if (!filterModel.items || filterModel.items.length === 0) {
    return '';
  }

  // Bug #5 fix: Filter out incomplete items and empty conditions to prevent malformed SQL
  const conditions = filterModel.items
    .map((item: GridFilterItem) => {
      const { field, operator, value } = item;
      // Skip items with missing required fields
      if (!field || !operator) return null;
      // For isEmpty/isNotEmpty operators, value is not required
      if (operator !== 'isEmpty' && operator !== 'isNotEmpty' && (value === undefined || value === null || value === '')) {
        return null;
      }
      const aliasedField = `${alias ? `${alias}.` : ''}${capitalizeAndTransformField(field)}`;
      try {
        return buildCondition({ operator: operator as Operator, column: aliasedField, value });
      } catch {
        // If buildCondition throws (e.g., unsupported operator), skip this item
        return null;
      }
    })
    .filter((condition): condition is string => condition !== null && condition !== '');

  if (conditions.length === 0) {
    return '';
  }

  return conditions.join(` ${logicOperatorSql} `);
};

export const buildSearchStub = (columns: string[], quickFilter: string[], alias?: string) => {
  if (!quickFilter || quickFilter.length === 0) {
    return ''; // Return empty if no quick filters
  }

  // Identify key identifier columns that should prioritize exact matches
  const identifierColumns = ['Tag', 'TreeTag', 'StemTag', 'QuadratName', 'Quadrat'];

  return columns
    .map(column => {
      // SQL injection protection: escape column name with alias if present
      const columnPart = safeEscapeId(column);
      const aliasedColumn = alias ? `${safeEscapeId(alias)}.${columnPart}` : columnPart;

      // For identifier columns, prioritize exact match, then fall back to contains
      if (identifierColumns.includes(column)) {
        return quickFilter
          .map(word => {
            // Try exact match first, then contains
            return `(${aliasedColumn} = ${escape(word)} OR ${aliasedColumn} LIKE ${escape(`%${word}%`)})`;
          })
          .join(' OR ');
      } else {
        // For other columns, use contains search
        return quickFilter.map(word => `${aliasedColumn} LIKE ${escape(`%${word}%`)}`).join(' OR ');
      }
    })
    .join(' OR ');
};
