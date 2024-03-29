import {PoolConnection} from "mysql2/promise";
import {
  fileMappings,
  getConn,
  InsertUpdateProcessingProps,
  runQuery,
  SitesResult,
  ValidationResponse
} from "@/components/processors/processormacros";
import {processCensus} from "@/components/processors/processcensus";
import {bitToBoolean} from "@/config/macros";
import {SitesRDS} from "@/config/sqlmacros";

export async function getColumnValueByColumnName<T>(
  connection: PoolConnection,
  schema: string,
  tableName: string,
  columnNameToExtract: string,
  columnNameToSearch: string,
  columnValueToSearch: T
): Promise<T | null> {
  if (!columnNameToExtract || !columnNameToSearch || !columnValueToSearch) throw new Error('accidentally handed undefined value in parameter');

  try {
    const query = `
      SELECT ${columnNameToExtract}
      FROM ${schema}.${tableName}
      WHERE ${columnNameToSearch} = ?
    `;

    const result = await runQuery(connection, query, [columnValueToSearch]); // Type assertion

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
  schema: string,
  speciesID: number
): Promise<number | null> {
  if (!speciesID) throw new Error('received undefined species ID in getSubSpeciesID');

  try {
    // MySQL query with placeholder for speciesID
    const query = `
      SELECT SubSpeciesID
      FROM ${schema}.subspecies
      WHERE SpeciesID = ?
    `;

    // Execute the query with speciesID as the placeholder value
    const rows = await runQuery(connection, query, [speciesID]);

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
  schema: string,
  codesArray: string[],
  coreMeasurementIDConnected: number
) {
  if (!codesArray || !coreMeasurementIDConnected) throw new Error('undefined codes array OR coremeasurementID received in processCode');

  try {
    // Prepare the query to check if the attribute exists
    const attributeExistsQuery = `
      SELECT Code
      FROM ${schema}.attributes
      WHERE Code = ?
    `;
    // Prepare the query to insert code into CMAttributes
    const insertCMAttributeQuery = `
      INSERT INTO ${schema}.cmattributes (CoreMeasurementID, Code)
      VALUES (?, ?);
    `;

    // Iterate over each coreMeasurementID
    // For each coreMeasurementID, iterate over the codesArray
    for (const code of codesArray) {
      const attributeResult = await runQuery(connection, attributeExistsQuery, [code]);
      if (attributeResult.length === 0) {
        throw new Error(`The attribute code '${code}' does not exist in SQL`);
      }
      // Insert each combination of coreMeasurementID and code into CMAttributes
      await runQuery(connection, insertCMAttributeQuery, [coreMeasurementIDConnected, code]);
    }
    // Commit the transaction
    await connection.commit();
  } catch (error: any) {
    console.error('Error processing code:', error.message);
    throw error;
  }
}

export async function processTrees(
  connection: PoolConnection,
  schema: string,
  treeTag: any,
  speciesID: any,
  subSpeciesID: any
): Promise<number | null> {
  if (!treeTag || !speciesID) throw new Error('undefined treetag or speciesid passed to processTrees');

  try {
    // Prepare the query with the new alias method
    const query = `
    INSERT INTO ${schema}.trees (TreeTag, SpeciesID, SubSpeciesID)
    VALUES (?, ?, ?) AS new_data
    ON DUPLICATE KEY UPDATE 
      SpeciesID = new_data.SpeciesID, 
      SubSpeciesID = new_data.SubSpeciesID;
  `;

    // Execute the query
    const upsertTreesResult = await runQuery(connection, query, [
      treeTag,
      speciesID,
      subSpeciesID ?? null
    ]);
    return upsertTreesResult.insertId;
  } catch (error: any) {
    console.error('Error processing trees:', error.message);
    throw error;
  }
}

export async function processStems(
  connection: PoolConnection,
  schema: string,
  stemTag: any,
  treeID: any,
  quadratID: any,
  stemQuadX: any,
  stemQuadY: any
): Promise<number | null> {
  if (!stemTag || !treeID || !quadratID || !stemQuadX || !stemQuadY) throw new Error('process stems: 1 or more undefined parameters received');

  try {
    // Prepare the query
    const query = `
      INSERT INTO ${schema}.stems (TreeID, QuadratID, StemTag, StemQuadX, StemQuadY)
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
  }
}

export async function getPersonnelIDByName(
  connection: PoolConnection,
  schema: string,
  fullName: string
): Promise<number | null> {
  // Split the full name into first and last names
  const [firstName, lastName] = fullName.split(" ");
  if (!firstName || !lastName) {
    throw new Error("Full name must include both first and last names.");
  }

  try {
    // Prepare the query
    const query = `
      SELECT PersonnelID
      FROM ${schema}.personnel
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
  }
}

export async function insertOrUpdate(props: InsertUpdateProcessingProps): Promise<number | null> {
  const {formType, schema, ...subProps} = props;
  const {connection, rowData} = subProps;
  const mapping = fileMappings[formType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${formType}`);
  }
  console.log('INSERT OR UPDATE: schema & mapping found');
  if (formType === 'measurements') {
    return await processCensus({...subProps, schema});
  } else {
    if (mapping.specialProcessing) {
      console.log('INSERT OR UPDATE: special processing found. Moving to subfunction:');
      await mapping.specialProcessing({...subProps, schema});
    } else {
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
    }
    return null;
  }
}

export async function runValidationProcedure(schema: string, procedureName: string, plotID: number | null, censusID: number | null, min?: number, max?: number) {
  const conn = await getConn();
  let query, parameters;

  if (procedureName === "ValidateScreenMeasuredDiameterMinMax" || procedureName === "ValidateHOMUpperAndLowerBounds") {
    query = `CALL ${schema}.${procedureName}(?, ?, ?, ?)`;
    // Pass JavaScript null for SQL NULL
    parameters = [censusID, plotID, min !== undefined ? min : null, max !== undefined ? max : null];
  } else {
    query = `CALL ${schema}.${procedureName}(?, ?)`;
    parameters = [censusID, plotID];
  }


  try {
    await conn.beginTransaction();
    const resultSets = await runQuery(conn, query, parameters);

    // The first result set contains the expectedRows, insertedRows, and message
    const validationSummary = resultSets[0][0];

    // The second result set contains the failedValidationIds (if present)
    const failedValidationIds = resultSets.length > 1 ? resultSets[1].map((row: any) => row.CoreMeasurementID) : [];

    const validationResponse: ValidationResponse = {
      totalRows: validationSummary.TotalRows,
      failedRows: validationSummary.FailedRows,
      message: validationSummary.Message,
      ...(failedValidationIds.length > 0 && {failedCoreMeasurementIDs: failedValidationIds})
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

export async function verifyEmail(email: string): Promise<{ emailVerified: boolean, isAdmin: boolean }> {
  const connection: PoolConnection | null = await getConn();
  try {
    // Query to fetch the IsAdmin field for a given email
    const query = `SELECT IsAdmin FROM catalog.users WHERE Email = ? LIMIT 1`;
    const results = await runQuery(connection, query, [email]);

    // emailVerified is true if there is at least one result
    const emailVerified = results.length > 0;
    // isAdmin is determined based on the IsAdmin field if email is verified
    const isAdmin = emailVerified && bitToBoolean(results[0]?.IsAdmin);

    return {emailVerified, isAdmin};
  } catch (error: any) {
    console.error('Error verifying email in database: ', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

export async function getAllSchemas(): Promise<SitesRDS[]> {
  const connection: PoolConnection | null = await getConn();
  try {
    // Query to get sites
    const sitesQuery = `
      SELECT *
      FROM catalog.sites
    `;
    const sitesParams: any[] | undefined = [];
    const sitesResults = await runQuery(connection, sitesQuery, sitesParams);

    return sitesResults.map((row: SitesResult) => ({
      siteID: row.SiteID,
      siteName: row.SiteName,
      schemaName: row.SchemaName,
    }));
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function getAllowedSchemas(email: string): Promise<SitesRDS[]> {
  const connection: PoolConnection | null = await getConn();
  try {
    // Query to get user ID
    const userQuery = `
      SELECT UserID FROM catalog.users
      WHERE Email = ?
    `;
    const userParams = [email];
    const userResults = await runQuery(connection, userQuery, userParams);

    if (userResults.length === 0) {
      throw new Error('User not found');
    }
    const userID = userResults[0].UserID;

    // Query to get sites
    const sitesQuery = `
      SELECT s.*
      FROM catalog.sites AS s
      JOIN catalog.usersiterelations AS usr ON s.SiteID = usr.SiteID
      WHERE usr.UserID = ?
    `;
    const sitesParams = [userID];
    const sitesResults = await runQuery(connection, sitesQuery, sitesParams);

    return sitesResults.map((row: SitesResult) => ({
      siteID: row.SiteID,
      siteName: row.SiteName,
      schemaName: row.SchemaName,
    }));
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (connection) connection.release();
  }
}

