import { PoolConnection, PoolOptions } from 'mysql2/promise';
import { PoolMonitor } from '@/config/poolmonitor';
import chalk from 'chalk';
import { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';
import { capitalizeAndTransformField } from '@/config/utils';
import { escape } from 'mysql2';

const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!),
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 100, // Lower limit if 100 is excessive for your DB
  queueLimit: 0, // unlimited queue size
  keepAliveInitialDelay: 10000, // 0 by default.
  enableKeepAlive: true, // false by default.
  connectTimeout: 30000 // 10 seconds by default.
};
export const poolMonitor = new PoolMonitor(sqlConfig);

export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    // console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);

    // Acquire the connection and ping to validate it
    const connection = await poolMonitor.getConnection();
    await connection.ping(); // Use ping to check the connection
    // console.log('Connection successful');
    return connection; // Resolve the connection when successful
  } catch (err) {
    console.error(`Connection attempt ${tries + 1} failed:`, err);

    if (tries === 5) {
      console.error('!!! Cannot connect !!! Error:', err);
      throw err;
    } else {
      console.log('Retrying connection...');
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
    console.error('Error processing files:', error.message);
    throw new Error(error.message);
  }
  if (!conn) {
    throw new Error('conn empty');
  }
  return conn;
}

export async function runQuery(connection: PoolConnection, query: string, params?: any[]): Promise<any> {
  const timeout = 60000; // 60 seconds
  const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Query execution timed out')), timeout));
  const startTime = Date.now();
  try {
    if (params) {
      params = params.map(param => (param === undefined ? null : param));
    }
    // Log query details
    // console.log(chalk.cyan(`Executing query: ${query}`));
    // if (params) {
    //   console.log(chalk.gray(`Query params: ${JSON.stringify(params)}`));
    // }
    if (query.trim().startsWith('CALL')) {
      const [rows] = await Promise.race([connection.query(query, params), timer]);
      // console.log(chalk.magenta(`CALL Query completed in ${Date.now() - startTime}ms`));
      return rows;
    } else {
      const [rows, _fields] = await Promise.race([connection.execute(query, params), timer]);
      // console.log(chalk.magenta(`STANDARD Query completed in ${Date.now() - startTime}ms`));

      if (query.trim().startsWith('INSERT') || query.trim().startsWith('UPDATE') || query.trim().startsWith('DELETE')) {
        return rows;
      }
      return rows;
    }
  } catch (error: any) {
    console.error(chalk.red(`Error executing query: ${query}`));
    // if (params) {
    //   console.error(chalk.red(`With params: ${JSON.stringify(params)}`));
    // }
    console.error(chalk.red('Error message:', error.message));
    throw error;
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

export function buildCondition({ operator, column, value }: { operator: Operator; column: string; value?: number | string | string[] }): string {
  switch (operator) {
    case 'contains':
      // Use the value as provided since it already includes the % signs
      return `${column} LIKE '%${escapeSql(value as string)}%'`;
    case 'doesNotContain':
      return `${column} NOT LIKE '%${escapeSql(value as string)}%'`;
    case 'equals':
    case 'is':
    case '=':
      return `${column} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'doesNotEqual':
    case 'isNot':
    case '!=':
      return `${column} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'startsWith':
      return `${column} LIKE '%${escapeSql(value as string)}'`;
    case 'endsWith':
      return `${column} LIKE '${escapeSql(value as string)}%'`;
    case 'isAfter':
    case '>':
      return `${column} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isOnOrAfter':
    case '>=':
      return `${column} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isBefore':
    case '<':
      return `${column} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isOnOrBefore':
    case '<=':
      return `${column} = ${typeof value === 'number' ? value : `'${escapeSql(value as string)}'`}`;
    case 'isEmpty':
      return `(${column} = '' OR ${column} IS NULL)`;
    case 'isNotEmpty':
      return `(${column} <> '' AND ${column} IS NOT NULL)`;
    case 'isAnyOf':
      if (Array.isArray(value)) {
        const values = value.map(val => `'${escapeSql(val)}'`).join(', ');
        return `${column} IN (${values})`;
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

  return filterModel.items
    .map((item: GridFilterItem) => {
      const { field, operator, value } = item;
      if (!field || !operator || !value) return '';
      const aliasedField = `${alias ? `${alias}.` : ''}${capitalizeAndTransformField(field)}`;
      const condition = buildCondition({ operator: operator as Operator, column: aliasedField, value });
      console.log('generated condition: ', condition);
      return condition;
    })
    .join(` ${filterModel?.logicOperator?.toUpperCase() || 'AND'} `);
};

export const buildSearchStub = (columns: string[], quickFilter: string[], alias?: string) => {
  if (!quickFilter || quickFilter.length === 0) {
    return ''; // Return empty if no quick filters
  }

  return columns
    .map(column => {
      const aliasedColumn = `${alias ? `${alias}.` : ''}${column}`;
      return quickFilter.map(word => `${aliasedColumn} LIKE ${escape(`%${word}%`)}`).join(' OR ');
    })
    .join(' OR ');
};
