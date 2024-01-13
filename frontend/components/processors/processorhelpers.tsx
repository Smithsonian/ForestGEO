import sql from "mssql";
import {RowDataStructure} from "@/config/macros";
import {processSpecies} from "@/components/processors/processspecies";
import processCensus from "@/components/processors/processcensus";

export async function insertOrUpdate(conn: sql.ConnectionPool, fileType: string, rowData: RowDataStructure, plotKey: string) {
  const mapping = fileMappings[fileType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${fileType}`);
  }

  if (mapping.specialProcessing) {
    await mapping.specialProcessing(conn, rowData, plotKey);
    return;
  }

  const request = new sql.Request(conn);
  const columns = Object.keys(mapping.columnMappings);
  const tableColumns = columns.map(fileColumn => mapping.columnMappings[fileColumn]).join(', ');
  const values = columns.map(fileColumn => `@${fileColumn}`);

  let query = `
    MERGE INTO ${mapping.tableName} AS target
    USING (VALUES (${values.join(', ')})) AS source (${tableColumns})
    ON target.UniqueIdentifierColumn = source.UniqueIdentifierColumn
    WHEN MATCHED THEN
      UPDATE SET ${tableColumns.split(', ').map(column => `${column} = source.${column}`).join(', ')}
    WHEN NOT MATCHED THEN
      INSERT (${tableColumns})
      VALUES (${values.join(', ')});
  `;

  columns.forEach(column => {
    request.input(column, sql.VarChar, rowData[column]); // Adjust data types based on your schema
  });

  await request.query(query);
}

export async function getColumnValueByColumnName<T>(
  transaction: sql.Transaction, // Pass the transaction explicitly
  tableName: string,
  columnNameToExtract: string,
  columnNameToSearch: string,
  columnValueToSearch: T
): Promise<T | null> {
  try {
    const request = new sql.Request(transaction); // Use the provided transaction
    const query = `
      SELECT ${columnNameToExtract}
      FROM ${tableName}
      WHERE ${columnNameToSearch} = @columnValue
    `;

    // Provide the parameter value
    request.input('columnValue', columnValueToSearch);

    const result = await request.query(query);

    if (result.recordset.length > 0) {
      // Return the extracted column value if found
      return result.recordset[0][columnNameToExtract];
    } else {
      // Return null if no matching record found
      return null;
    }
  } catch (err: any) {
    console.error(`Error retrieving ${columnNameToExtract}:`, err.message);
    throw err;
  }
}

export async function getMostRecentRowID(
  transaction: sql.Transaction, // Pass the transaction explicitly
  tableName: string,
  identityColumn: string
): Promise<number | null> {
  try {
    const request = new sql.Request(transaction); // Use the provided transaction
    const query = `
      SELECT TOP 1 ${identityColumn}
      FROM ${tableName}
      ORDER BY ${identityColumn} DESC
    `;

    const result = await request.query(query);

    if (result.recordset.length > 0) {
      // Return the ID of the most recent row
      return result.recordset[0][identityColumn];
    } else {
      // Return null if the table is empty
      return null;
    }
  } catch (err: any) {
    console.error(`Error retrieving most recent ${identityColumn}:`, err.message);
    throw err;
  }
}


export async function getCoreMeasurementID(
  transaction: sql.Transaction, // Pass the transaction explicitly
  treeID: number,
  measurementTypeID: number,
  measurementDate: Date
): Promise<number | null> {
  const tableName = 'forestgeo.CoreMeasurements';
  const identityColumn = 'CoreMeasurementID';

  try {
    const mostRecentCoreMeasurementID = await getMostRecentRowID(
      transaction,
      tableName,
      identityColumn
    );

    if (mostRecentCoreMeasurementID === null) {
      return null;
    }

    // Check if the retrieved CoreMeasurement corresponds to the specific measurement criteria
    const request = new sql.Request(transaction);
    const query = `
      SELECT ${identityColumn}
      FROM ${tableName}
      WHERE ${identityColumn} = @coreMeasurementID
      AND TreeID = @treeID
      AND MeasurementTypeID = @measurementTypeID
      AND MeasurementDate = @measurementDate
    `;

    const result = await request
      .input('coreMeasurementID', mostRecentCoreMeasurementID)
      .input('treeID', treeID)
      .input('measurementTypeID', measurementTypeID)
      .input('measurementDate', sql.Date, measurementDate)
      .query(query);

    if (result.recordset.length > 0) {
      return mostRecentCoreMeasurementID;
    } else {
      return null;
    }
  } catch (error: any) {
    console.error('Error retrieving CoreMeasurementID:', error.message);
    throw error;
  }
}

export async function getSubSpeciesID(
  transaction: sql.Transaction,
  speciesID: number
): Promise<number | null> {
  try {
    const request = new sql.Request(transaction);
    const query = `
      SELECT SubSpeciesID
      FROM forestgeo.SubSpecies
      WHERE SpeciesID = @speciesID
    `;

    const result = await request
      .input('speciesID', speciesID)
      .query(query);

    if (result.recordset.length > 0) {
      return result.recordset[0].SubSpeciesID;
    } else {
      return null;
    }
  } catch (error: any) {
    console.error(`Error retrieving SubSpeciesID: ${error.message}`);
    throw error;
  }
}

export async function processCode(
  transaction: sql.Transaction,
  code: string,
  treeID: number,
  measurementTypeID: number,
  measurementDate: Date
) {
  try {
    const request = new sql.Request(transaction);

    // Check if the code exists in the Attributes table
    const attributeExistsQuery = `
      SELECT Code
      FROM forestgeo.Attributes
      WHERE Code = @Code
    `;

    const attributeResult = await request
      .input('Code', sql.VarChar, code)
      .query(attributeExistsQuery);

    if (attributeResult.recordset.length === 0) {
      // If the code doesn't exist, insert it into the Attributes table
      const insertAttributeQuery = `
        INSERT INTO forestgeo.Attributes (Code)
        VALUES (@Code)
      `;

      await request.query(insertAttributeQuery);
    }

    // Insert the code into the CMAttributes table, linking it to the CoreMeasurement
    const insertCMAttributeQuery = `
      INSERT INTO forestgeo.CMAttributes (CoreMeasurementID, Code)
      SELECT CM.CoreMeasurementID, @Code
      FROM forestgeo.CoreMeasurements CM
      WHERE CM.TreeID = @TreeID
        AND CM.MeasurementTypeID = @MeasurementTypeID
        AND CM.MeasurementDate = @MeasurementDate
    `;

    await request
      .input('Code', sql.VarChar, code)
      .input('TreeID', sql.Int, treeID)
      .input('MeasurementTypeID', sql.Int, measurementTypeID)
      .input('MeasurementDate', sql.Date, measurementDate)
      .query(insertCMAttributeQuery);
  } catch (error: any) {
    console.error('Error processing code:', error.message);
    throw error;
  }
}

export const sqlConfig: any = {
  user: process.env.AZURE_SQL_USER!, // better stored in an app setting such as process.env.DB_USER
  password: process.env.AZURE_SQL_PASSWORD!, // better stored in an app setting such as process.env.DB_PASSWORD
  server: process.env.AZURE_SQL_SERVER!, // better stored in an app setting such as process.env.DB_SERVER
  port: parseInt(process.env.AZURE_SQL_PORT!), // optional, defaults to 1433, better stored in an app setting such as process.env.DB_PORT
  database: process.env.AZURE_SQL_DATABASE!, // better stored in an app setting such as process.env.DB_NAME
  authentication: {
    type: 'default'
  },
  options: {
    encrypt: true
  }
}

export async function getSqlConnection(tries: number) {
  return await sql.connect(sqlConfig).catch((err) => {
    console.error(err);
    if (tries == 5) {
      throw new Error("Connection failure");
    }
    console.log("conn failed --> trying again!");
    getSqlConnection(tries + 1);
  });
}

export type FileMapping = {
  tableName: string;
  columnMappings: { [fileColumn: string]: string };
  specialProcessing?: (conn: sql.ConnectionPool, rowData: RowDataStructure, plotKey: string) => Promise<void>;
};

// Define the mappings for each file type
export const fileMappings: Record<string, FileMapping> = {
  "codes.txt": {
    tableName: "Attributes",
    columnMappings: {
      "code": "Code",
      "description": "Description",
      "status": "Status"
    }
  },
  "personnel.txt": {
    tableName: "Personnel",
    columnMappings: {
      "firstname": "FirstName",
      "lastname": "LastName",
      "role": "Role"
    }
  },
  "species.txt": {
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
  "quadrat.txt": {
    tableName: "Quadrats",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "startx": "Quadrats.QuadratX",
      "starty": "Quadrats.QuadratY",
      "dimx": "Quadrats.DimensionX",
      "dimy": "Quadrats.DimensionY"
    }
  },
  // ...other mappings...
  "census.txt": {
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
  }
  // ...add other file types...
};

export async function runQuery(conn: sql.ConnectionPool, query: string) {
  if (!conn) {
    throw new Error("invalid ConnectionPool object. check connection string settings.")
  }
  return await conn.request().query(query);
}