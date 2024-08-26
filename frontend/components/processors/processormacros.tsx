import { PoolConnection, PoolOptions } from 'mysql2/promise';
import { FileRow } from '@/config/macros/formdetails';
import { processSpecies } from '@/components/processors/processspecies';
import { processCensus } from '@/components/processors/processcensus';
import { PoolMonitor } from '@/config/poolmonitor';
import { processPersonnel } from '@/components/processors/processpersonnel';

export interface SpecialProcessingProps {
  connection: PoolConnection;
  rowData: FileRow;
  schema: string;
  plotID?: number;
  censusID?: number;
  quadratID?: number;
  fullName?: string;
}

export interface InsertUpdateProcessingProps extends SpecialProcessingProps {
  formType: string;
}

export type FileMapping = {
  tableName: string;
  columnMappings: { [fileColumn: string]: string };
  specialProcessing?: (props: Readonly<SpecialProcessingProps>) => Promise<number | undefined>;
};

// Define the mappings for each file type
export const fileMappings: Record<string, FileMapping> = {
  attributes: {
    tableName: 'Attributes',
    columnMappings: {
      code: 'Code',
      description: 'Description',
      status: 'Status'
    }
  },
  personnel: {
    tableName: 'Personnel',
    columnMappings: {
      firstname: 'FirstName',
      lastname: 'LastName',
      role: 'Role'
    },
    specialProcessing: processPersonnel
  },
  species: {
    tableName: '',
    columnMappings: {
      spcode: 'Species.SpeciesCode',
      family: 'Family.Family',
      genus: 'Genus.GenusName',
      species: 'Species.SpeciesName',
      subspecies: 'Species.SubspeciesName', // optional
      IDLevel: 'Species.IDLevel',
      authority: 'Species.Authority',
      subauthority: 'Species.SubspeciesAuthority' // optional
    },
    specialProcessing: processSpecies
  },
  quadrats: {
    tableName: 'quadrats',
    // "quadrats": [{label: "quadrat"}, {label: "startx"}, {label: "starty"}, {label: "dimx"}, {label: "dimy"}, {label: "unit"}, {label: "quadratshape"}],
    columnMappings: {
      quadrat: 'QuadratName',
      plotID: 'PlotID',
      censusID: 'CensusID',
      startx: 'StartX',
      starty: 'StartY',
      coordinateunit: 'CoordinateUnits',
      dimx: 'DimensionX',
      dimy: 'DimensionY',
      dimensionunit: 'DimensionUnits',
      quadratshape: 'QuadratShape'
    }
  },
  // "subquadrats": "subquadrat, quadrat, dimx, dimy, xindex, yindex, unit, orderindex",
  subquadrats: {
    tableName: 'subquadrats',
    columnMappings: {
      subquadrat: 'SubquadratName',
      quadrat: 'QuadratID',
      plotID: 'PlotID',
      censusID: 'CensusID',
      dimx: 'DimensionX',
      dimy: 'DimensionY',
      xindex: 'X',
      yindex: 'Y',
      unit: 'Unit',
      orderindex: 'Ordering'
    }
  },
  measurements: {
    tableName: '', // Multiple tables involved
    columnMappings: {},
    specialProcessing: processCensus
  }
};
const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!),
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 100, // increased from 10 to prevent bottlenecks
  queueLimit: 0,
  keepAliveInitialDelay: 10000, // 0 by default.
  enableKeepAlive: true, // false by default.
  connectTimeout: 20000 // 10 seconds by default.
};
export const poolMonitor = new PoolMonitor(sqlConfig);

export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);

    // Check if the pool is closed and reinitialize if necessary
    if (poolMonitor.isPoolClosed()) {
      console.log('Connection pool is closed. Reinitializing...');
      poolMonitor.reinitializePool();
    }

    const connection = await poolMonitor.getConnection();
    await connection.ping(); // Use ping to check the connection
    console.log('Connection successful');
    return connection; // Resolve the connection when successful
  } catch (err) {
    console.error(`Connection attempt ${tries + 1} failed:`, err);
    if (tries == 5) {
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
  try {
    // Check if the query is for calling a stored procedure
    if (query.trim().startsWith('CALL')) {
      // Use `connection.query` for stored procedures
      const [rows] = await connection.query(query, params);
      return rows;
    } else {
      // Use `connection.execute` for standard SQL queries
      const [rows, _fields] = await connection.execute(query, params);

      // Check if the query is an INSERT, UPDATE, or DELETE
      if (query.trim().startsWith('INSERT') || query.trim().startsWith('UPDATE') || query.trim().startsWith('DELETE')) {
        return rows; // This will include insertId, affectedRows, etc.
      }
      return rows; // This is for SELECT queries and will return RowDataPacket[]
    }
  } catch (error: any) {
    console.error('Error executing query:', error.message);
    throw error;
  }
}

export function getCatalogSchema() {
  const catalogSchema = process.env.AZURE_SQL_CATALOG_SCHEMA;
  if (!catalogSchema) throw new Error('Environmental variable extraction for catalog schema failed');
  return catalogSchema;
}

export type ValidationResponse = {
  totalRows: number;
  failedRows: number;
  message: string;
  failedCoreMeasurementIDs?: number[];
};
export type UpdateValidationResponse = {
  rowsValidated: any;
};

export interface QueryConfig {
  schema: string;
  table: string;
  joins?: {
    table: string;
    alias: string;
    on: string;
  }[];
  conditionals?: string;
  pagination: {
    page: number;
    pageSize: number;
  };
  extraParams?: any[];
}

export function buildPaginatedQuery(config: QueryConfig): {
  query: string;
  params: any[];
} {
  const { schema, table, joins, conditionals, pagination, extraParams } = config;
  const { page, pageSize } = pagination;
  const startRow = page * pageSize;
  const queryParams = extraParams || [];

  // Establish an alias for the primary table for consistency in joins and selections
  const tableAlias = table[0].toLowerCase(); // Simple default alias based on first letter of table name

  // Build the base query with possible joins
  let query = `SELECT SQL_CALC_FOUND_ROWS ${tableAlias}.* FROM ${schema}.${table} AS ${tableAlias}`;
  if (joins) {
    joins.forEach(join => {
      query += ` LEFT JOIN ${schema}.${join.table} AS ${join.alias} ON ${join.on}`;
    });
  }

  if (conditionals) {
    query += ` WHERE ${conditionals}`;
  }

  // Add LIMIT clause
  query += ` LIMIT ?, ?`;
  queryParams.push(startRow, pageSize); // Ensure these are the last parameters added

  return { query, params: queryParams };
}
