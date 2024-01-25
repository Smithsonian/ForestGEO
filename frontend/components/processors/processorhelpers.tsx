import mysql, {PoolConnection, RowDataPacket} from 'mysql2/promise';
import {booleanToBit, RowDataStructure} from "@/config/macros";

import {processSpecies} from "@/components/processors/processspecies";
import processCensus from "@/components/processors/processcensus";
import processNewPlantsForm from "@/components/processors/processnewplantsform";
import processOldTreeForm from "@/components/processors/processoldtreeform";
import processBigTreesForm from "@/components/processors/processbigtreesform";
import processMultipleStemsForm from "@/components/processors/processmultiplestemsform";
import * as fs from "fs";
import {NextRequest} from "next/server";


export async function insertOrUpdate(
  connection: PoolConnection, // Change the parameter type to PoolConnection
  fileType: string,
  rowData: RowDataStructure,
  plotKey: string,
  censusID: string,
  fullName: string
) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  const mapping = fileMappings[fileType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${fileType}`);
  }

  if (mapping.specialProcessing) {
    try {
      await mapping.specialProcessing(connection, rowData, plotKey, censusID, fullName);
    } catch (error) {
      throw error;
    }
    return;
  }

  const columns = Object.keys(mapping.columnMappings);
  const tableColumns = columns.map(fileColumn => mapping.columnMappings[fileColumn]).join(', ');
  const placeholders = columns.map(() => '?').join(', '); // Use '?' for placeholders in MySQL
  const values = columns.map(fileColumn => rowData[fileColumn]);

  let query = `
    INSERT INTO ${schema}.${mapping.tableName} (${tableColumns})
    VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE 
    ${tableColumns.split(', ').map(column => `${column} = VALUES(${column})`).join(', ')};
  `;

  try {
    // Execute the query using the provided connection
    await connection.query(query, values);
  } catch (error) {
    // Rollback the transaction in case of an error
    await connection.rollback();
    throw error; // Re-throw the error after rollback
  }
}


export async function getColumnValueByColumnName<T>(
  connection: PoolConnection,
  tableName: string,
  columnNameToExtract: string,
  columnNameToSearch: string,
  columnValueToSearch: T
): Promise<T | null> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    const query = `
      SELECT ${columnNameToExtract}
      FROM ${schema}.${tableName}
      WHERE ${columnNameToSearch} = ?
    `;

    const [rows] = await connection.query<RowDataPacket[]>(query, [columnValueToSearch]);
    const result = rows; // Type assertion

    if (result.length > 0) {
      return result[0][columnNameToExtract] as T;
    } else {
      return null;
    }
  } catch (error: any) {
    console.error(`Error retrieving ${columnNameToExtract} from ${tableName}:`, error.message);
    throw error;
  }
}

export async function getSubSpeciesID(
  connection: PoolConnection,
  speciesID: number
): Promise<number | null> {
  const schema = process.env.AZURE_SQL_SCHEMA; // Adjust to your MySQL schema environment variable
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // MySQL query with placeholder for speciesID
    const query = `
      SELECT SubSpeciesID
      FROM ${schema}.SubSpecies
      WHERE SpeciesID = ?
    `;

    // Execute the query with speciesID as the placeholder value
    const [rows] = await connection.query<RowDataPacket[]>(query, [speciesID]);

    // Check if any rows are returned and return the SubSpeciesID
    if (rows.length > 0) {
      return rows[0].SubSpeciesID as number;
    } else {
      return null;
    }
  } catch (error: any) {
    console.error(`Error retrieving SubSpeciesID: ${error.message}`);
    throw error;
  }
}

export async function processCode(
  connection: PoolConnection,
  codesArray: string[],
  collectedMeasurements: any[] // Assuming these are coreMeasurementIDs
) {
  const schema = process.env.AZURE_SQL_SCHEMA; // Adjust to your MySQL schema environment variable
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // Prepare the query to check if the attribute exists
    const attributeExistsQuery = `
      SELECT Code
      FROM ${schema}.Attributes
      WHERE Code = ?
    `;

    // Prepare the query to check if the core measurement exists
    const coreMeasurementExistsQuery = `
      SELECT CoreMeasurementID
      FROM ${schema}.CoreMeasurements
      WHERE CoreMeasurementID = ?
    `;

    // Prepare the query to insert code into CMAttributes
    const insertCMAttributeQuery = `
      INSERT INTO ${schema}.CMAttributes (CoreMeasurementID, Code)
      VALUES (?, ?);
    `;

    // Start a transaction
    await connection.beginTransaction();

    // Iterate over each coreMeasurementID
    for (const measurementID of collectedMeasurements) {
      const [coreMeasurementResult] = await connection.query<RowDataPacket[]>(coreMeasurementExistsQuery, [measurementID]);
      if (coreMeasurementResult.length === 0) {
        throw new Error(`The CoreMeasurementID '${measurementID}' does not exist in SQL`);
      }

      // For each coreMeasurementID, iterate over the codesArray
      for (const code of codesArray) {
        const [attributeResult] = await connection.query<RowDataPacket[]>(attributeExistsQuery, [code]);
        if (attributeResult.length === 0) {
          throw new Error(`The attribute code '${code}' does not exist in SQL`);
        }

        // Insert each combination of coreMeasurementID and code into CMAttributes
        await connection.query(insertCMAttributeQuery, [measurementID, code]);
      }
    }

    // Commit the transaction
    await connection.commit();
  } catch (error: any) {
    console.error('Error processing code:', error.message);
    // Rollback the transaction in case of an error
    await connection.rollback();
    throw error;
  } finally {
    // Release the connection back to the pool
    connection.release();
  }
}

export async function processTrees(
  connection: PoolConnection,
  treeTag: any,
  speciesID: any,
  subSpeciesID: any | null
) {
  const schema = process.env.AZURE_SQL_SCHEMA; // Adjust to your MySQL schema environment variable
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // Prepare the query
    const query = `
      INSERT INTO ${schema}.Trees (TreeTag, SpeciesID, SubSpeciesID)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE SpeciesID = VALUES(SpeciesID), SubSpeciesID = VALUES(SubSpeciesID);
    `;

    // Start a transaction
    await connection.beginTransaction();

    // Execute the query
    await connection.query(query, [treeTag, speciesID, subSpeciesID]);

    // Commit the transaction
    await connection.commit();
  } catch (error: any) {
    console.error('Error processing trees:', error.message);
    // Rollback the transaction in case of an error
    await connection.rollback();
    throw error;
  } finally {
    // Release the connection back to the pool
    connection.release();
  }
}

export async function processStems(
  connection: PoolConnection,
  stemTag: any,
  treeID: any,
  quadratID: any,
  stemX: any,
  stemY: any
) {
  const schema = process.env.AZURE_SQL_SCHEMA; // Adjust to your MySQL schema environment variable
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // Prepare the query
    const query = `
      INSERT INTO ${schema}.Stems (TreeID, QuadratID, StemTag, StemX, StemY)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        TreeID = VALUES(TreeID),
        QuadratID = VALUES(QuadratID),
        StemX = VALUES(StemX),
        StemY = VALUES(StemY);
    `;

    // Start a transaction
    await connection.beginTransaction();

    // Execute the query
    await connection.query(query, [treeID, quadratID, stemTag, stemX, stemY]);

    // Commit the transaction
    await connection.commit();
  } catch (error: any) {
    console.error('Error processing stems:', error.message);
    // Rollback the transaction in case of an error
    await connection.rollback();
    throw error;
  } finally {
    // Release the connection back to the pool
    connection.release();
  }
}

export async function getPersonnelIDByName(
  connection: PoolConnection,
  fullName: string
): Promise<number | null> {
  const schema = process.env.AZURE_SQL_SCHEMA; // Adjust to your MySQL schema environment variable
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  // Split the full name into first and last names
  const [firstName, lastName] = fullName.split(" ");
  if (!firstName || !lastName) {
    throw new Error("Full name must include both first and last names.");
  }

  try {
    // Prepare the query
    const query = `
      SELECT PersonnelID
      FROM ${schema}.Personnel
      WHERE FirstName = ? AND LastName = ?
    `;

    // Execute the query
    const [result] = await connection.execute(query, [
      firstName.trim(),
      lastName.trim(),
    ]);

    const rows: RowDataPacket[] = result as RowDataPacket[];

    if (rows.length > 0) {
      return rows[0].PersonnelID as number;
    }

    return null; // No matching personnel found
  } catch (error: any) {
    console.error('Error retrieving PersonnelID:', error.message);
    throw error;
  } finally {
    // Release the connection back to the pool
    connection.release();
  }
}


export type FileMapping = {
  tableName: string;
  columnMappings: { [fileColumn: string]: string };
  specialProcessing?: (connection: mysql.PoolConnection, rowData: RowDataStructure, plotKey: string, censusID: string, fullName: string) => Promise<void>;
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
      "lx": "Stems.StemX",
      "ly": "Stems.StemY",
      "dbh": "CoreMeasurements.Measurement",
      "codes": "Attributes.Code",
      "hom": "CoreMeasurement.Measurement",
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
      "dbh": "CoreMeasurements.Measurement",
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
      "olddbh": "CoreMeasurements.Measurement",
      "oldhom": "CoreMeasurements.Measurement",
      "dbh": "CoreMeasurements.Measurement",
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
      "dbh": "CoreMeasurements.Measurements",
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
      "species": "Species.SpeciesName",
      "dbh": "CoreMeasurements.Measurement",
      "hom": "CoreMeasurements.Measurement",
      "comments": "CoreMeasurements.Measurement"
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

export async function runQuery(connection: PoolConnection, query: string, params?: any[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(query, params);
    return rows;
  } catch (error: any) {
    console.error('Error executing query:', error.message);
    throw error;
  } finally {
    connection.release(); // Release the connection back to the pool
  }
}

export async function parseCoreMeasurementsRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST': {
      return {
        CensusID: requestBody.censusID ?? null,
        PlotID: requestBody.plotID ?? null,
        QuadratID: requestBody.quadratID ?? null,
        TreeID: requestBody.treeID ?? null,
        StemID: requestBody.stemID ?? null,
        PersonnelID: requestBody.personnelID ?? null,
        IsRemeasurement: booleanToBit(requestBody.isRemeasurement) ?? null,
        IsCurrent: booleanToBit(requestBody.isCurrent) ?? null,
        MeasurementDate: requestBody.measurementDate ? new Date(requestBody.measurementDate) : null,
        MeasuredDBH: requestBody.measuredDBH ?? null,
        MeasuredHOM: requestBody.measuredHOM ?? null,
        Description: requestBody.description ?? null,
        UserDefinedFields: requestBody.userDefinedFields ?? null,
      };
    }
    case 'PATCH': {
      const coreMeasurementID = requestBody.coreMeasurementID;
      const updateData = {
        CensusID: requestBody.censusID ?? null,
        PlotID: requestBody.plotID ?? null,
        QuadratID: requestBody.quadratID ?? null,
        TreeID: requestBody.treeID ?? null,
        StemID: requestBody.stemID ?? null,
        PersonnelID: requestBody.personnelID ?? null,
        IsRemeasurement: booleanToBit(requestBody.isRemeasurement) ?? null,
        IsCurrent: booleanToBit(requestBody.isCurrent) ?? null,
        MeasurementDate: requestBody.measurementDate ? new Date(requestBody.measurementDate) : null,
        MeasuredDBH: requestBody.measuredDBH ?? null,
        MeasuredHOM: requestBody.measuredHOM ?? null,
        Description: requestBody.description ?? null,
        UserDefinedFields: requestBody.userDefinedFields ?? null,
      };
      return {coreMeasurementID, updateData};
    }
    default:
      throw new Error(`invalid parse type -- coremeasurements`);
  }
}

export async function parseAttributeRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST':
      return {
        Code: requestBody.code,
        Description: requestBody.description ?? null,
        Status: requestBody.status ?? null,
      };
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

export async function parseCensusRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST':
      return {
        PlotID: requestBody.plotID ?? null,
        PlotCensusNumber: requestBody.plotCensusNumber ?? null,
        StartDate: new Date(requestBody.startDate ?? null),
        EndDate: new Date(requestBody.endDate ?? null),
        Description: requestBody.description ?? null,
      }
    case 'PATCH': {
      const censusID = requestBody.censusID;
      const updateData = {
        PlotID: requestBody.plotID ?? null,
        PlotCensusNumber: requestBody.plotCensusNumber ?? null,
        StartDate: new Date(requestBody.startDate ?? null),
        EndDate: new Date(requestBody.endDate ?? null),
        Description: requestBody.description ?? null,
      }
      return {censusID, updateData};
    }
    default:
      throw new Error('invalid parse type -- census');

  }
}

export async function parsePersonnelRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST':
      return {
        FirstName: requestBody.firstName ?? null,
        LastName: requestBody.lastName ?? null,
        Role: requestBody.role ?? null,
      };
    case 'PATCH': {
      const personnelID = requestBody.personnelID;
      const updateData = {
        FirstName: requestBody.firstName ?? null,
        LastName: requestBody.lastName ?? null,
        Role: requestBody.role ?? null,
      };
      return {personnelID, updateData};
    }
    default:
      throw new Error('invalid parse type -- personnel');
  }
}

export async function parseQuadratsRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST':
      return {
        PlotID: requestBody.plotID,
        QuadratName: requestBody.quadratName,
        QuadratX: requestBody.quadratX,
        QuadratY: requestBody.quadratY,
        QuadratZ: requestBody.quadratZ,
        DimensionX: requestBody.dimensionX,
        DimensionY: requestBody.dimensionY,
        Area: requestBody.area,
        QuadratShape: requestBody.quadratShape,
      }
    case 'PATCH': {
      const quadratID = requestBody.quadratID;
      const updateData = {
        PlotID: requestBody.plotID,
        QuadratName: requestBody.quadratName,
        QuadratX: requestBody.quadratX,
        QuadratY: requestBody.quadratY,
        QuadratZ: requestBody.quadratZ,
        DimensionX: requestBody.dimensionX,
        DimensionY: requestBody.dimensionY,
        Area: requestBody.area,
        QuadratShape: requestBody.quadratShape,
      }
      return {quadratID, updateData};
    }
    default:
      throw new Error('invalid parse type -- quadrat');
  }
}

export async function parseSpeciesRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST':
      return {
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
    case 'PATCH': {
      const speciesID = requestBody.speciesID;
      const updateData = {
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
      return {speciesID, updateData};
    }
    default:
      throw new Error('invalid parse type -- species');
  }
}

export async function parseSubSpeciesRequestBody(request: NextRequest, parseType: string) {
  const requestBody = await request.json();
  switch (parseType) {
    case 'POST':
      return {
        SpeciesID: requestBody.speciesID ?? null,
        SubSpeciesName: requestBody.subSpeciesName ?? null,
        SubSpeciesCode: requestBody.subSpeciesCode ?? null,
        CurrentTaxonFlag: booleanToBit(requestBody.currentTaxonFlag) ?? null,
        ObsoleteTaxonFlag: booleanToBit(requestBody.obsoleteTaxonFlag) ?? null,
        Authority: requestBody.authority ?? null,
        InfraSpecificLevel: requestBody.infraSpecificLevel ?? null,
      };
    case 'PATCH': {
      const subSpeciesID = requestBody.subSpeciesID;
      const updateData = {
        SpeciesID: requestBody.speciesID ?? null,
        SubSpeciesName: requestBody.subSpeciesName ?? null,
        SubSpeciesCode: requestBody.subSpeciesCode ?? null,
        CurrentTaxonFlag: booleanToBit(requestBody.currentTaxonFlag) ?? null,
        ObsoleteTaxonFlag: booleanToBit(requestBody.obsoleteTaxonFlag) ?? null,
        Authority: requestBody.authority ?? null,
        InfraSpecificLevel: requestBody.infraSpecificLevel ?? null,
      };
      return {subSpeciesID, updateData};
    }
    default:
      throw new Error('invalid parse type -- species');
  }
}

// New function to extract environment variables
export function getSchema() {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  return schema;
}