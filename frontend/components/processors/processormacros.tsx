import mysql, {PoolConnection} from 'mysql2/promise';
import {booleanToBit, FileRow} from "@/config/macros";

import {processSpecies} from "@/components/processors/processspecies";
import processCensus from "@/components/processors/processcensus";
import processNewPlantsForm from "@/components/processors/processnewplantsform";
import processOldTreeForm from "@/components/processors/processoldtreeform";
import processBigTreesForm from "@/components/processors/processbigtreesform";
import processMultipleStemsForm from "@/components/processors/processmultiplestemsform";
import * as fs from "fs";
import {NextRequest} from "next/server";


export async function getConn() {
  let conn: PoolConnection | null = null; // Use PoolConnection type

  try {
    let i = 0;
    conn = await getSqlConnection(i);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error processing files:", error.message);
      throw new Error(error.message);
    } else {
      console.error("Unknown error in connecting to SQL:", error);
      throw new Error('unknown');
    }
  }

  if (!conn) {
    console.error("Container client or SQL connection is undefined.");
    throw new Error('conn empty');
  }

  return conn;
}

export type FileMapping = {
  tableName: string;
  columnMappings: { [fileColumn: string]: string };
  specialProcessing?: (connection: mysql.PoolConnection, rowData: FileRow, plotKey: string, censusID: string, fullName: string) => Promise<void>;
};

// Define the mappings for each file type
export const fileMappings: Record<string, FileMapping> = {
  "fixeddata_codes": {
    tableName: "Attributes",
    columnMappings: {
      "code": "Code",
      "description": "Description",
      "status": "Status"
    }
  },
  "fixeddata_personnel": {
    tableName: "Personnel",
    columnMappings: {
      "firstname": "FirstName",
      "lastname": "LastName",
      "role": "Role"
    }
  },
  "fixeddata_species": {
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
  "fixeddata_quadrat": {
    tableName: "Quadrats",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "startx": "Quadrats.QuadratX",
      "starty": "Quadrats.QuadratY",
      "dimx": "Quadrats.DimensionX",
      "dimy": "Quadrats.DimensionY"
    }
  },
  "fixeddata_census": {
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
  "ctfsweb_new_plants_form": {
    tableName: "",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "tag": "Trees.TreeTag",
      "stemtag": "Stems.StemTag",
      "spcode": "Species.SpeciesCode",
      "dbh": "CoreMeasurements.MeasuredDBH",
      "codes": "Attributes.Code",
      "comments": "CoreMeasurements.Description"
    },
    specialProcessing: processNewPlantsForm
  },
  "ctfsweb_old_tree_form": {
    tableName: "",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "tag": "Trees.TreeTag",
      "stemtag": "Stems.StemTag",
      "spcode": "Species.SpeciesCode",
      "olddbh": "CoreMeasurements.MeasuredDBH",
      "oldhom": "CoreMeasurements.MeasuredHOM",
      "dbh": "CoreMeasurements.MeasuredDBH",
      "codes": "Attributes.Code",
      "comments": "CoreMeasurements.Description"
    },
    specialProcessing: processOldTreeForm
  },
  "ctfsweb_multiple_stems_form": {
    tableName: "",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "tag": "Trees.TreeTag",
      "stemtag": "Stems.StemTag",
      "dbh": "CoreMeasurements.MeasuredDBH",
      "codes": "Attributes.Code",
      "comments": "CoreMeasurements.Description"
    },
    specialProcessing: processMultipleStemsForm
  },
  "ctfsweb_big_trees_form": {
    tableName: "",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "subquadrat": "",
      "tag": "Trees.TreeTag",
      "multistemtag": "Stems.StemTag",
      "species": "Species.SpeciesCode",
      "dbh": "CoreMeasurements.MeasuredDBH",
      "hom": "CoreMeasurements.MeasuredHOM",
      "comments": "CoreMeasurements.Description"
    },
    specialProcessing: processBigTreesForm
  },
};

const sqlConfig: any = {
  user: process.env.AZURE_SQL_USER!, // better stored in an app setting such as process.env.DB_USER
  password: process.env.AZURE_SQL_PASSWORD!, // better stored in an app setting such as process.env.DB_PASSWORD
  host: process.env.AZURE_SQL_SERVER!, // better stored in an app setting such as process.env.DB_SERVER
  port: parseInt(process.env.AZURE_SQL_PORT!), // optional, defaults to 1433, better stored in an app setting such as process.env.DB_PORT
  database: process.env.AZURE_SQL_DATABASE!, // better stored in an app setting such as process.env.DB_NAME
  ssl: {ca: fs.readFileSync("DigiCertGlobalRootCA.crt.pem")}
}
const pool = mysql.createPool(sqlConfig);

// Function to get a connection from the pool
export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    const connection = await pool.getConnection();
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
  } finally {
    connection.release(); // Release the connection back to the pool
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

export async function parseAttributeRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return {
    Code: requestBody.code,
    Description: requestBody.description ?? null,
    Status: requestBody.status ?? null,
  };
}

export async function parseCensusRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return {
    CensusID: requestBody.censusID,
    PlotID: requestBody.plotID ?? null,
    PlotCensusNumber: requestBody.plotCensusNumber ?? null,
    StartDate: new Date(requestBody.startDate ?? null),
    EndDate: new Date(requestBody.endDate ?? null),
    Description: requestBody.description ?? null,
  }
}

export async function parsePersonnelRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return {
    PersonnelID: requestBody.personnelID,
    FirstName: requestBody.firstName ?? null,
    LastName: requestBody.lastName ?? null,
    Role: requestBody.role ?? null,
  };
}

export async function parseQuadratsRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return {
    QuadratID: requestBody.quadratID,
    PlotID: requestBody.plotID,
    QuadratName: requestBody.quadratName,
    QuadratX: requestBody.quadratX,
    QuadratY: requestBody.quadratY,
    DimensionX: requestBody.dimensionX,
    DimensionY: requestBody.dimensionY,
    Area: requestBody.area,
    QuadratShape: requestBody.quadratShape,
  };
}

export async function parseSpeciesRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return {
    SpeciesID: requestBody.speciesID,
    GenusID: requestBody.genusID ?? null,
    CurrentTaxonFlag: booleanToBit(requestBody.currentTaxonFlag) ?? null,
    ObsoleteTaxonFlag: booleanToBit(requestBody.obsoleteTaxonFlag) ?? null,
    SpeciesName: requestBody.speciesName ?? null,
    SpeciesCode: requestBody.speciesCode ?? null,
    IDLevel: requestBody.idLevel ?? null,
    Authority: requestBody.authority ?? null,
    FieldFamily: requestBody.fieldFamily ?? null,
    Description: requestBody.description ?? null,
    ReferenceID: requestBody.referenceID ?? null,
  };
}

export async function parseSubSpeciesRequestBody(request: NextRequest) {
  const requestBody = await request.json();
  return {
    SubSpeciesID: requestBody.subSpeciesID,
    SpeciesID: requestBody.speciesID ?? null,
    SubSpeciesName: requestBody.subSpeciesName ?? null,
    SubSpeciesCode: requestBody.subSpeciesCode ?? null,
    CurrentTaxonFlag: booleanToBit(requestBody.currentTaxonFlag) ?? null,
    ObsoleteTaxonFlag: booleanToBit(requestBody.obsoleteTaxonFlag) ?? null,
    Authority: requestBody.authority ?? null,
    InfraSpecificLevel: requestBody.infraSpecificLevel ?? null,
  };
}

// New function to extract environment variables
export function getSchema() {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  return schema;
}

export type ValidationResponse = {
  expectedRows: number;
  insertedRows: number;
  updatedRows: number;
  message: string;
}