import sql, {ConnectionPool, Transaction} from "mssql";
import {RowDataStructure} from "@/config/macros";
import {processSpecies} from "@/components/processors/processspecies";
import processCensus from "@/components/processors/processcensus";
import processNewPlantsForm from "@/components/processors/processnewplantsform";
import processOldTreeForm from "@/components/processors/processoldtreeform";
import processBigTreesForm from "@/components/processors/processbigtreesform";
import processMultipleStemsForm from "@/components/processors/processmultiplestemsform";

export async function insertOrUpdate(conn: sql.ConnectionPool, fileType: string, rowData: RowDataStructure, plotKey: string, censusID: string, fullName: string) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  const mapping = fileMappings[fileType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${fileType}`);
  }

  if (mapping.specialProcessing) {
    await mapping.specialProcessing(conn, rowData, plotKey, censusID, fullName);
    return;
  }

  const request = new sql.Request(conn);
  const columns = Object.keys(mapping.columnMappings);
  const tableColumns = columns.map(fileColumn => mapping.columnMappings[fileColumn]).join(', ');
  const values = columns.map(fileColumn => `@${fileColumn}`);

  let query = `
    MERGE INTO ${schema}.${mapping.tableName} AS target
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
  transaction: sql.Transaction,
  tableName: string,
  columnNameToExtract: string,
  columnNameToSearch: string,
  columnValueToSearch: T
): Promise<T | null> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    const request = new sql.Request(transaction);
    const query = `
      SELECT ${columnNameToExtract}
      FROM ${schema}.${tableName}
      WHERE ${columnNameToSearch} = @columnValue
    `;

    request.input('columnValue', columnValueToSearch);
    const result = await request.query(query);

    if (result.recordset.length > 0) {
      return result.recordset[0][columnNameToExtract];
    } else {
      return null;
    }
  } catch (err: any) {
    console.error(`Error retrieving ${columnNameToExtract} from ${tableName}:`, err.message);
    throw err;
  }
}

export async function getMostRecentRowID(
  transaction: sql.Transaction, // Pass the transaction explicitly
  tableName: string,
  identityColumn: string
): Promise<number | null> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  try {
    const request = new sql.Request(transaction); // Use the provided transaction
    const query = `
      SELECT TOP 1 ${identityColumn}
      FROM ${schema}.${tableName}
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

export async function getSubSpeciesID(
  transaction: sql.Transaction,
  speciesID: number
): Promise<number | null> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  try {
    const request = new sql.Request(transaction);
    const query = `
      SELECT SubSpeciesID
      FROM ${schema}.SubSpecies
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
  codesArray: string[],
  collectedMeasurements: any[],
) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  try {
    const request = new sql.Request(transaction);

    const attributeExistsQuery = `
      SELECT Code
      FROM ${schema}.Attributes
      WHERE Code = @Code
    `;

    for (const measurementID of collectedMeasurements) {
      const coreMeasurementExistsQuery = `
      SELECT CoreMeasurementID
      FROM ${schema}.CoreMeasurements
      WHERE CoreMeasurementID = @CoreMeasurementID
    `;
      const coreMeasurementResult = await request
        .input('CoreMeasurementID', sql.Int, measurementID)
        .query(coreMeasurementExistsQuery);

      if (coreMeasurementResult.recordset.length === 0) {
        throw new Error("The CoreMeasurementID you are trying to use does not exist in SQL");
      }
    }

    // Insert the code into the CMAttributes table, linking it to the CoreMeasurement
    const insertCMAttributeQuery = `
      INSERT INTO ${schema}.CMAttributes (CoreMeasurementID, Code)
      VALUES ($CoreMeasurementID, @Code);
    `;
    // Check if the code exists in the Attributes table
    for (const code of codesArray) {
      const attributeResult = await request
        .input('Code', sql.VarChar, code)
        .query(attributeExistsQuery);

      if (attributeResult.recordset.length === 0) {
        throw new Error("The attribute you are trying to set does not exist in SQL")
      }

      for (const measurementID of collectedMeasurements) {
        await request
          .input('CoreMeasurementID', sql.Int, measurementID)
          .input('Code', sql.VarChar, code)
          .query(insertCMAttributeQuery);
      }
    }
  } catch (error: any) {
    console.error('Error processing code:', error.message);
    throw error;
  }
}

export async function processTrees(transaction: Transaction, treeTag: any, speciesID: any, subSpeciesID: any | null) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");

  try {
    const request = new sql.Request(transaction);

    // Insert or update Trees with SpeciesID and SubSpeciesID
    await request
      .input('TreeTag', sql.VarChar, treeTag)
      .input('SpeciesID', sql.Int, speciesID)
      .input('SubSpeciesID', sql.Int, subSpeciesID) // Handle null if no SubSpecies
      .query(`
        MERGE INTO ${schema}.Trees AS target
        USING (VALUES (@TreeTag, @SpeciesID, @SubSpeciesID)) AS source (TreeTag, SpeciesID, SubSpeciesID)
        ON target.TreeTag = source.TreeTag
        WHEN NOT MATCHED THEN
          INSERT (TreeTag, SpeciesID, SubSpeciesID) VALUES (@TreeTag, @SpeciesID, @SubSpeciesID);
      `);
  } catch (error: any) {
    console.error('Error processing code:', error.message);
    throw error;
  }
}

export async function processStems(transaction: Transaction, stemTag: any, treeID: any, quadratID: any, stemX: any, stemY: any) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");

  try {
    const request = new sql.Request(transaction);

    // Insert or update Stems
    await request
      .input('TreeID', sql.Int, treeID)
      .input('QuadratID', sql.Int, quadratID)
      .input('StemTag', sql.VarChar, stemTag)
      .input('StemX', sql.Float, stemX)
      .input('StemY', sql.Float, stemY)
      .query(`
        MERGE INTO ${schema}.Stems AS target
        USING (VALUES (@TreeID, @QuadratID, @StemTag, @StemX, @StemY)) AS source (TreeID, QuadratID, StemTag, StemX, StemY)
        ON target.StemTag = source.StemTag
        WHEN NOT MATCHED THEN
          INSERT (TreeID, QuadratID, StemTag, StemX, StemY) VALUES (@TreeID, @QuadratID, @StemTag, @StemX, @StemY);
      `);
  } catch (error: any) {
    console.error('Error processing code:', error.message);
    throw error;
  }
}
export async function getPersonnelIDByName(transaction: sql.Transaction, fullName: string): Promise<number | null> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  // Split the full name into first and last names
  const [firstName, lastName] = fullName.split(" ");
  if (!firstName || !lastName) {
    throw new Error("Full name must include both first and last names.");
  }

  try {
    const request = new sql.Request(transaction);
    const query = `
      SELECT PersonnelID
      FROM ${schema}.Personnel
      WHERE FirstName = @FirstName AND LastName = @LastName
    `;

    request.input('FirstName', sql.VarChar, firstName.trim());
    request.input('LastName', sql.VarChar, lastName.trim());

    const result = await request.query(query);

    if (result.recordset.length > 0) {
      return result.recordset[0].PersonnelID;
    } else {
      return null; // No matching personnel found
    }
  } catch (err: any) {
    console.error('Error retrieving PersonnelID:', err.message);
    throw err;
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
  specialProcessing?: (conn: ConnectionPool, rowData: RowDataStructure, plotKey: string, censusID: string, fullName: string) => Promise<void>;
};

// Define the mappings for each file type
export const fileMappings: Record<string, FileMapping> = {
  "fixeddata_codes.txt": {
    tableName: "Attributes",
    columnMappings: {
      "code": "Code",
      "description": "Description",
      "status": "Status"
    }
  },
  "fixeddata_personnel.txt": {
    tableName: "Personnel",
    columnMappings: {
      "firstname": "FirstName",
      "lastname": "LastName",
      "role": "Role"
    }
  },
  "fixeddata_species.txt": {
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
  "fixeddata_quadrat.txt": {
    tableName: "Quadrats",
    columnMappings: {
      "quadrat": "Quadrats.QuadratName",
      "startx": "Quadrats.QuadratX",
      "starty": "Quadrats.QuadratY",
      "dimx": "Quadrats.DimensionX",
      "dimy": "Quadrats.DimensionY"
    }
  },
  "fixeddata_census.txt": {
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

export async function runQuery(conn: sql.ConnectionPool, query: string) {
  if (!conn) {
    throw new Error("invalid ConnectionPool object. check connection string settings.")
  }
  return await conn.request().query(query);
}
