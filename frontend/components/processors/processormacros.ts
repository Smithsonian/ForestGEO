// processormacros.tsx
import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';
import { capitalizeAndTransformField } from '@/config/utils';
import { escape } from 'mysql2';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import ailogger from '@/ailogger';
import { safeEscapeId } from '@/config/utils/sqlsecurity';

async function getSqlConnection(tries: number): Promise<PoolConnection> {
  let connection: PoolConnection | null = null;
  let connectionAcquired = false;
  try {
    // console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);

    // Acquire the connection and ping to validate it
    connection = await getPoolMonitorInstance().getConnection();
    connectionAcquired = true;
    await connection.ping(); // Use ping to check the connection
    const conn = connection;
    connectionAcquired = false; // Successfully returning, caller now responsible
    return conn; // Resolve the connection when successful
  } catch (err: any) {
    ailogger.error(`Connection attempt ${tries + 1} failed:`, err);

    // Release connection if we acquired it but failed
    if (connectionAcquired && connection) {
      try {
        connection.release();
      } catch (releaseError: any) {
        ailogger.error('Error releasing failed connection:', releaseError);
      }
      connectionAcquired = false;
    }

    if (tries === 5) {
      ailogger.error('!!! Cannot connect !!! Error:', err);
      throw err;
    } else {
      ailogger.info('Retrying connection...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait a bit before retrying
      return getSqlConnection(tries + 1); // Retry and return the promise
    }
  }
}

export async function getConn() {
  let conn: PoolConnection | null = null;
  try {
    const i = 0;
    conn = await getSqlConnection(i);
  } catch (error: any) {
    ailogger.error('Error processing files:', error.message);
    throw new Error(error.message);
  }
  if (!conn) {
    throw new Error('conn empty');
  }
  return conn;
}

export async function runQuery(connection: PoolConnection, query: string, params?: any[]): Promise<any> {
  const QUERY_TIMEOUT_MS = 360000; // 360 seconds
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Query execution timed out')), QUERY_TIMEOUT_MS);
  });
  try {
    if (params) {
      params = params.map(param => (param === undefined ? null : param));
    }
    if (query.trim().startsWith('CALL')) {
      const [rows] = await Promise.race([connection.query(query, params), timer]);
      return rows;
    } else {
      // mysql2's execute() uses prepared statements which don't support
      // bulk INSERT ... VALUES ? with nested arrays. Use query() for those.
      const hasBulkValues = params?.some(p => Array.isArray(p) && p.length > 0 && Array.isArray(p[0]));
      const method = hasBulkValues ? connection.query.bind(connection) : connection.execute.bind(connection);
      const [rows, _fields] = await Promise.race([method(query, params), timer]);

      return rows;
    }
  } catch (error: any) {
    ailogger.error(chalk.red(`Error executing query: ${query}`));
    ailogger.error(chalk.red('Error message:', error.message));
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    getPoolMonitorInstance().signalActivity();
  }
}

// process.on('SIGTERM', async () => {
//   console.log('Received SIGTERM. Closing connections...');
//   await poolMonitor.closeAllConnections();
//   process.exit(0);
// });

// process.on('SIGINT', async () => {
//   console.log('Received SIGINT. Closing connections...');
//   await poolMonitor.closeAllConnections();
//   process.exit(0);
// });

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

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
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
      // Escape SQL quotes first, then escape LIKE wildcards (Bug #2 fix)
      return `${safeColumn} LIKE '%${escapeLikeWildcards(escapeSql(value as string))}%' ESCAPE '\\\\'`;
    case 'doesNotContain':
      return `${safeColumn} NOT LIKE '%${escapeLikeWildcards(escapeSql(value as string))}%' ESCAPE '\\\\'`;
    case 'equals':
    case 'is':
    case '=':
      return `${safeColumn} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'doesNotEqual':
    case 'isNot':
    case '!=':
      return `${safeColumn} <> ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'startsWith':
      return `${safeColumn} LIKE '${escapeLikeWildcards(escapeSql(value as string))}%' ESCAPE '\\\\'`;
    case 'endsWith':
      return `${safeColumn} LIKE '%${escapeLikeWildcards(escapeSql(value as string))}' ESCAPE '\\\\'`;
    case 'isAfter':
    case '>':
      return `${safeColumn} > ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isOnOrAfter':
    case '>=':
      return `${safeColumn} >= ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isBefore':
    case '<':
      return `${safeColumn} < ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isOnOrBefore':
    case '<=':
      return `${safeColumn} <= ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isEmpty':
      return `(${safeColumn} = '' OR ${safeColumn} IS NULL)`;
    case 'isNotEmpty':
      return `(${safeColumn} <> '' AND ${safeColumn} IS NOT NULL)`;
    case 'isAnyOf':
      if (Array.isArray(value)) {
        const values = value.map(val => `'${escapeSql(val)}'`).join(', ');
        return `${safeColumn} IN (${values})`;
      }
      throw new Error('For "is any of", value must be an array.');
    default:
      throw new Error('Unsupported operator');
  }
}

export const buildFilterModelStub = (filterModel: GridFilterModel, alias?: string) => {
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

  return conditions.join(` ${filterModel?.logicOperator?.toUpperCase() || 'AND'} `);
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
