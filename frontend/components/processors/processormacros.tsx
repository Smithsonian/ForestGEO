import {PoolConnection, PoolOptions} from 'mysql2/promise';
import {booleanToBit} from "@/config/macros";
import {FileRow} from "@/config/macros/formdetails";

import {processSpecies} from "@/components/processors/processspecies";
import {NextRequest} from "next/server";
import {processCensus} from "@/components/processors/processcensus";
import {PoolMonitor} from "@/config/poolmonitor";
import {AttributesResult} from '@/config/sqlrdsdefinitions/tables/attributerds';
import {GridValidRowModel} from '@mui/x-data-grid';

export async function getConn() {
  let conn: PoolConnection | null = null;
  try {
    const i = 0;
    conn = await getSqlConnection(i);
  } catch (error: any) {
    console.error("Error processing files:", error.message);
    throw new Error(error.message);
  }
  if (!conn) {
    throw new Error('conn empty');
  }
  return conn;
}

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
  "attributes": {
    tableName: "Attributes",
    columnMappings: {
      "code": "Code",
      "description": "Description",
      "status": "Status"
    }
  },
  "personnel": {
    tableName: "Personnel",
    columnMappings: {
      "firstname": "FirstName",
      "lastname": "LastName",
      "role": "Role"
    }
  },
  "species": {
    tableName: "",
    columnMappings: {
      "spcode": "Species.SpeciesCode",
      "family": "Family.Family",
      "genus": "Genus.GenusName",
      "species": "Species.SpeciesName",
      "subspecies": "Species.SubspeciesName", // optional
      "IDLevel": "Species.IDLevel",
      "authority": "Species.Authority",
      "subauthority": "Species.SubspeciesAuthority", // optional
    },
    specialProcessing: processSpecies
  },
  "quadrats": {
    tableName: "quadrats",
    // "quadrats": [{label: "quadrat"}, {label: "startx"}, {label: "starty"}, {label: "dimx"}, {label: "dimy"}, {label: "unit"}, {label: "quadratshape"}],
    columnMappings: {
      "quadrat": "QuadratName",
      "plotID": "PlotID",
      "censusID": "CensusID",
      "startx": "StartX",
      "starty": "StartY",
      "dimx": "DimensionX",
      "dimy": "DimensionY",
      "unit": "Unit",
      "quadratshape": "QuadratShape",
    },
  },
  // "subquadrats": "subquadrat, quadrat, dimx, dimy, xindex, yindex, unit, orderindex",
  "subquadrats": {
    tableName: "subquadrats",
    columnMappings: {
      "subquadrat": "SubquadratName",
      "quadrat": "QuadratID",
      "plotID": "PlotID",
      "censusID": "CensusID",
      "dimx": "DimensionX",
      "dimy": "DimensionY",
      "xindex": "X",
      "yindex": "Y",
      "unit": "Unit",
      "orderindex": "Ordering",
    }
  },
  "measurements": {
    tableName: "", // Multiple tables involved
    columnMappings: {},
    specialProcessing: processCensus
  },
};
const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER, // better stored in an app setting such as process.env.DB_USER
  password: process.env.AZURE_SQL_PASSWORD, // better stored in an app setting such as process.env.DB_PASSWORD
  host: process.env.AZURE_SQL_SERVER, // better stored in an app setting such as process.env.DB_SERVER
  port: parseInt(process.env.AZURE_SQL_PORT!), // optional, defaults to 1433, better stored in an app setting such as process.env.DB_PORT
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  keepAliveInitialDelay: 10000, // 0 by default.
  enableKeepAlive: true, // false by default.
};
// database: process.env.AZURE_SQL_SCHEMA!, // better stored in an app setting such as process.env.DB_NAME
export const poolMonitor = new PoolMonitor(sqlConfig);
// const pool = createPool(sqlConfig);

// Function to get a connection from the pool
export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);
    // const connection = await pool.getConnection();
    const connection = await poolMonitor.getConnection();
    await connection.ping(); // Use ping to check the connection
    console.log('Connection successful');
    return connection; // Resolve the connection when successful
  } catch (err) {
    console.error(`Connection attempt ${tries + 1} failed:`, err);
    if (tries == 5) {
      console.error("!!! Cannot connect !!! Error:", err);
      throw err;
    } else {
      console.log("Retrying connection...");
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait a bit before retrying
      return getSqlConnection(tries + 1); // Retry and return the promise
    }
  }
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

// Helper function to get value or default
function getValueOrDefault(value: any, defaultValue = null) {
  return value ?? defaultValue;
}

// Function to transform request body into data object
function transformRequestBody(requestBody: any) {
  return {
    CoreMeasurementID: getValueOrDefault(requestBody.coreMeasurementID),
    CensusID: getValueOrDefault(requestBody.censusID),
    PlotID: getValueOrDefault(requestBody.plotID),
    QuadratID: getValueOrDefault(requestBody.quadratID),
    SubQuadratID: getValueOrDefault(requestBody.subQuadratID),
    TreeID: getValueOrDefault(requestBody.treeID),
    StemID: getValueOrDefault(requestBody.stemID),
    PersonnelID: getValueOrDefault(requestBody.personnelID),
    IsRemeasurement: booleanToBit(getValueOrDefault(requestBody.isRemeasurement)),
    IsCurrent: booleanToBit(getValueOrDefault(requestBody.isCurrent)),
    IsPrimaryStem: booleanToBit(getValueOrDefault(requestBody.IsPrimaryStem)),
    IsValidated: booleanToBit(getValueOrDefault(requestBody.IsValidated)),
    MeasurementDate: requestBody.measurementDate ? new Date(requestBody.measurementDate) : null,
    MeasuredDBH: getValueOrDefault(requestBody.measuredDBH),
    MeasuredHOM: getValueOrDefault(requestBody.measuredHOM),
    Description: getValueOrDefault(requestBody.description),
    UserDefinedFields: getValueOrDefault(requestBody.userDefinedFields),
  };
}

export async function parseCoreMeasurementsRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return transformRequestBody(requestBody);
}

export async function parseAttributeRequestBody(request: NextRequest, parseType: string): Promise<AttributesResult> {
  const {newRow: requestBody}: { newRow: GridValidRowModel } = await request.json();
  switch (parseType) {
    case 'POST':
    case 'PATCH': {
      return {
        Code: requestBody.code,
        Description: requestBody.description ?? null,
        Status: requestBody.status ?? null,
      };
    }
    default:
      throw new Error("Invalid parse type -- attributes");
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
}
export type UpdateValidationResponse = {
  rowsValidated: any;
}

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

export function buildPaginatedQuery(config: QueryConfig): { query: string, params: any[] } {
  const {schema, table, joins, conditionals, pagination, extraParams} = config;
  const {page, pageSize} = pagination;
  const startRow = page * pageSize;
  const queryParams = extraParams || [];

  // Establish an alias for the primary table for consistency in joins and selections
  const tableAlias = table[0].toLowerCase();  // Simple default alias based on first letter of table name

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

  return {query, params: queryParams};
}

// Function to close all active connections
async function closeConnections() {
  console.log('Closing all active connections...');
  await poolMonitor.closeAllConnections();
  console.log('All connections closed.');
}

// Function to handle graceful shutdown
async function gracefulShutdown() {
  console.log('Initiating graceful shutdown...');
  try {
    await closeConnections();
    console.log('Graceful shutdown complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Capture SIGINT signal (triggered by ctrl+c)
process.on('SIGINT', async () => {
  console.log('SIGINT signal received.');
  await gracefulShutdown();
});

// Capture SIGTERM signal (triggered by process kill)
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received.');
  await gracefulShutdown();
});