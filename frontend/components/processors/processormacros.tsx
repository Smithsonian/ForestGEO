import {PoolConnection, PoolOptions} from 'mysql2/promise';
import {booleanToBit} from "@/config/macros";
import {FileRow} from "@/config/macros/formdetails";

import {processSpecies} from "@/components/processors/processspecies";
import * as fs from "fs";
import {NextRequest} from "next/server";
import {processQuadrats} from "@/components/processors/processquadrats";
import {processCensus} from "@/components/processors/processcensus";
import {PoolMonitor} from "@/config/poolmonitor";
import { AttributesResult } from '@/config/sqlrdsdefinitions/tables/attributerds';
import { GridValidRowModel } from '@mui/x-data-grid';

export async function getConn() {
  let conn: PoolConnection | null = null;
  try {
    let i = 0;
    console.log("Attempting to get SQL connection");
    conn = await getSqlConnection(i);
    console.log("SQL connection obtained");
  } catch (error: any) {
    console.error("Error processing files:", error.message);
    throw new Error(error.message);
  }
  if (!conn) {
    console.error("Container client or SQL connection is undefined.");
    throw new Error('conn empty');
  }
  conn.on('release', () => {
    console.log("Connection released back to pool");
  });
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
  dbhUnit?: string;
  homUnit?: string;
  coordUnit?: string;
}

export interface InsertUpdateProcessingProps extends SpecialProcessingProps {
  formType: string;
}

export type FileMapping = {
  tableName: string;
  columnMappings: { [fileColumn: string]: string };
  specialProcessing?: (props: Readonly<SpecialProcessingProps>) => Promise<number | null>;
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
      "genus": "Genus.GenusName",
      "species": "Species.SpeciesName",
      "IDLevel": "Species.IDLevel",
      "family": "Species.Family",
      "authority": "Species.Authority"
    },
    specialProcessing: processSpecies
  },
  "quadrats": {
    tableName: "",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "dimx": "Quadrats.DimensionX",
      "dimy": "Quadrats.DimensionY"
    },
    specialProcessing: processQuadrats
  },
  "measurements": {
    tableName: "", // Multiple tables involved
    columnMappings: {
      "tag": "Trees.TreeTag",
      "stemtag": "Stems.StemTag",
      "spcode": "Species.SpeciesCode",
      "quadrat": "Quadrats.QuadratName",
      "lx": "Stems.StemQuadX",
      "ly": "Stems.StemQuadY",
      "dbh": "CoreMeasurements.MeasuredDBH",
      "codes": "Attributes.Code",
      "hom": "CoreMeasurement.MeasuredHOM",
      "date": "CoreMeasurement.MeasurementDate",
    },
    specialProcessing: processCensus
  },
};
const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER!, // better stored in an app setting such as process.env.DB_USER
  password: process.env.AZURE_SQL_PASSWORD!, // better stored in an app setting such as process.env.DB_PASSWORD
  host: process.env.AZURE_SQL_SERVER!, // better stored in an app setting such as process.env.DB_SERVER
  port: parseInt(process.env.AZURE_SQL_PORT!), // optional, defaults to 1433, better stored in an app setting such as process.env.DB_PORT
  database: process.env.AZURE_SQL_DATABASE!, // better stored in an app setting such as process.env.DB_NAME
  // ssl: {ca: fs.readFileSync("DigiCertGlobalRootCA.crt.pem")}
};
export const poolMonitor = new PoolMonitor(sqlConfig);
// const pool = mysql.createPool(sqlConfig);

// Function to get a connection from the pool
export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    const connection = await poolMonitor.getConnection();
    await connection.ping(); // Use ping to check the connection
    return connection; // Resolve the connection when successful
  } catch (err) {
    if (tries == 5) {
      console.error("!!! Cannot connect !!! Error:", err);
      throw err;
    } else {
      console.log("Connection attempt failed --> trying again");
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit before retrying
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
  const {newRow: requestBody}: {newRow: GridValidRowModel} = await request.json();
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
  const { schema, table, joins, conditionals, pagination, extraParams } = config;
  const { page, pageSize } = pagination;
  const startRow = page * pageSize;
  let queryParams = extraParams || [];

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

  return { query, params: queryParams };
}