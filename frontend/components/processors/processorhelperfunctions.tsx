import {PoolConnection, RowDataPacket} from "mysql2/promise";
import {fileMappings, getConn, runQuery, ValidationResponse} from "@/components/processors/processormacros";
import {RowDataStructure} from "@/config/macros";

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
  coreMeasurementIDConnected: number // Assuming these are coreMeasurementIDs
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
    // Prepare the query to insert code into CMAttributes
    const insertCMAttributeQuery = `
      INSERT INTO ${schema}.CMAttributes (CoreMeasurementID, Code)
      VALUES (?, ?);
    `;

    // Iterate over each coreMeasurementID
    // For each coreMeasurementID, iterate over the codesArray
    for (const code of codesArray) {
      const [attributeResult] = await connection.query<RowDataPacket[]>(attributeExistsQuery, [code]);
      if (attributeResult.length === 0) {
        throw new Error(`The attribute code '${code}' does not exist in SQL`);
      }
      // Insert each combination of coreMeasurementID and code into CMAttributes
      await connection.query(insertCMAttributeQuery, [coreMeasurementIDConnected, code]);
    }
    // Commit the transaction
    await connection.commit();
  } catch (error: any) {
    console.error('Error processing code:', error.message);
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
  subSpeciesID: number | null
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

    // Execute the query
    const upsertTreesResult = await runQuery(connection, query, [treeTag, speciesID, subSpeciesID]);
    return upsertTreesResult.insertId;
  } catch (error: any) {
    console.error('Error processing trees:', error.message);
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
  stemQuadX: any,
  stemQuadY: any
) {
  const schema = process.env.AZURE_SQL_SCHEMA; // Adjust to your MySQL schema environment variable
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // Prepare the query
    const query = `
      INSERT INTO ${schema}.Stems (TreeID, QuadratID, StemTag, StemQuadX, StemQuadY)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        TreeID = VALUES(TreeID),
        QuadratID = VALUES(QuadratID),
        StemTag = VALUES(StemTag),
        StemQuadX = VALUES(StemQuadX),
        StemQuadY = VALUES(StemQuadY);
    `;
    // Execute the query
    const results = await runQuery(connection, query, [treeID, quadratID, stemTag, stemQuadX, stemQuadY]);
    return results.insertId;
  } catch (error: any) {
    console.error('Error processing stems:', error.message);
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
    const rows = await runQuery(connection, query, [firstName.trim(), lastName.trim()]);

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

export async function insertOrUpdate(
  connection: PoolConnection, // Change the parameter type to PoolConnection
  fileType: string,
  rowData: RowDataStructure,
  plotKey: string,
  censusID: string,
  fullName: string
): Promise<number | null> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  const mapping = fileMappings[fileType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${fileType}`);
  }
  console.log('INSERT OR UPDATE: schema & mapping found');
  if (mapping.specialProcessing) {
    console.log('INSERT OR UPDATE: special processing found. Moving to subfunction:');
    try {
      return await mapping.specialProcessing(connection, rowData, plotKey, censusID, fullName);
    } catch (error) {
      throw error;
    }
  }
  console.log('INSERT OR UPDATE: no special processing found. Beginning manual insert:');
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
  console.log(`INSERT OR UPDATE: query constructed: ${query}`);

  try {
    // Execute the query using the provided connection
    await connection.beginTransaction();
    await connection.query(query, values);
    await connection.commit();
  } catch (error) {
    // Rollback the transaction in case of an error
    console.log(`INSERT OR UPDATE: error in query execution: ${error}. Rollback commencing and error rethrow: `);
    await connection.rollback();
    throw error; // Re-throw the error after rollback
  }
  console.log('INSERT OR UPDATE: default query completed. Exiting...');
  return null;
}

export async function runValidationProcedure(procedureName: string, plotID: number | null, censusID: number | null, min?: number, max?: number) {
  const conn = await getConn();
  let query, parameters;

  if (min !== undefined && max !== undefined) {
    // If minDBH and maxDBH are provided, call ValidateScreenMeasuredDiameterMinMax
    query = `CALL ${procedureName}(?, ?, ?, ?)`;
    parameters = [censusID, plotID, min, max];
  } else {
    // If minDBH and maxDBH are not provided, call ValidateDBHGrowthExceedsMax
    query = `CALL ${procedureName}(?, ?)`;
    parameters = [censusID, plotID];
  }

  try {
    await conn.beginTransaction();
    const result = await runQuery(conn, query, parameters);
    const validationResponse: ValidationResponse = {
      expectedRows: result[0].ExpectedRows,
      insertedRows: result[0].InsertedRows,
      message: result[0].Message
    };
    await conn.commit();
    return validationResponse;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
  }
}