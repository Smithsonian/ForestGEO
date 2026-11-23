import type { RecentChangesServerFilters } from '@/config/recentchangesexplorer';

/**
 * Both row-state columns as JSON text. mysql2 parses a native JSON column itself, which would leave a stored JSON
 * string scalar looking like a row once the decoder parses it again; text makes the decoder the only parser.
 */
export const ROW_STATE_TEXT_COLUMNS_SQL =
  'CAST(uc.OldRowState AS CHAR CHARACTER SET utf8mb4) AS OldRowState, CAST(uc.NewRowState AS CHAR CHARACTER SET utf8mb4) AS NewRowState';

export const PLOT_SCOPE_CONDITION = '(uc.PlotID = ? OR uc.PlotID IS NULL)';
const QUICK_SEARCH_TEXT_TERMS = [
  'uc.RecordID LIKE ?',
  'uc.TableName LIKE ?',
  'uc.ChangedBy LIKE ?',
  'CAST(uc.OldRowState AS CHAR) LIKE ?',
  'CAST(uc.NewRowState AS CHAR) LIKE ?'
] as const;
/** `123` or `#123`: unifiedchangelog.ChangeID is INT, so at most ten digits. */
const CHANGE_ID_SEARCH_PATTERN = /^#?(\d{1,10})$/;

export interface ChangeFilter {
  sql: string;
  /** Every binding of `sql` in order, the plot binding included. */
  params: unknown[];
}

/**
 * The one WHERE clause the list, its counts and both export queries share, so they cannot drift.
 * Date bounds are calendar days of the stored ChangeTimestamp.
 */
export function buildChangeFilter(plotID: number, filters: RecentChangesServerFilters): ChangeFilter {
  const conditions: string[] = [PLOT_SCOPE_CONDITION];
  const params: unknown[] = [plotID];

  if (filters.operation !== 'all') {
    conditions.push('uc.Operation = ?');
    params.push(filters.operation);
  }

  if (filters.changedBy) {
    conditions.push('uc.ChangedBy = ?');
    params.push(filters.changedBy);
  }

  if (filters.tableName) {
    conditions.push('uc.TableName = ?');
    params.push(filters.tableName);
  }

  if (filters.quickSearch) {
    const searchPattern = `%${filters.quickSearch}%`;
    const terms: string[] = [...QUICK_SEARCH_TEXT_TERMS];
    const termParams: unknown[] = QUICK_SEARCH_TEXT_TERMS.map(() => searchPattern);
    const changeIDMatch = CHANGE_ID_SEARCH_PATTERN.exec(filters.quickSearch.trim());
    if (changeIDMatch) {
      terms.push('uc.ChangeID = ?');
      termParams.push(Number(changeIDMatch[1]));
    }
    conditions.push(`(${terms.join(' OR ')})`);
    params.push(...termParams);
  }

  if (filters.changedFrom) {
    conditions.push('uc.ChangeTimestamp >= ?');
    params.push(filters.changedFrom);
  }

  if (filters.changedTo) {
    conditions.push('uc.ChangeTimestamp < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(filters.changedTo);
  }

  return { sql: conditions.join(' AND '), params };
}
