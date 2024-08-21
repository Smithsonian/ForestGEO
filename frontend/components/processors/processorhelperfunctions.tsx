import mysql, { PoolConnection } from 'mysql2/promise';
import { fileMappings, getConn, InsertUpdateProcessingProps, runQuery } from '@/components/processors/processormacros';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/tables/sitesrds';
import { processCensus } from '@/components/processors/processcensus';
import MapperFactory from '@/config/datamapper';

export async function insertOrUpdate(props: InsertUpdateProcessingProps): Promise<number | undefined> {
  const { formType, schema, ...subProps } = props;
  const { connection, rowData } = subProps;
  const mapping = fileMappings[formType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${formType}`);
  }
  if (formType === 'measurements') {
    return await processCensus({ ...subProps, schema });
  } else {
    if (mapping.specialProcessing) {
      await mapping.specialProcessing({ ...subProps, schema });
    } else {
      const columns = Object.keys(mapping.columnMappings);
      if (columns.includes('plotID')) rowData['plotID'] = subProps.plotID?.toString() ?? null;
      if (columns.includes('censusID')) rowData['censusID'] = subProps.censusID?.toString() ?? null;
      const tableColumns = columns.map(fileColumn => mapping.columnMappings[fileColumn]).join(', ');
      const placeholders = columns.map(() => '?').join(', '); // Use '?' for placeholders in MySQL
      const values = columns.map(fileColumn => rowData[fileColumn]);
      const query = `
        INSERT INTO ${schema}.${mapping.tableName} (${tableColumns})
        VALUES (${placeholders}) ON DUPLICATE KEY
        UPDATE
          ${tableColumns
            .split(', ')
            .map(column => `${column} = VALUES(${column})`)
            .join(', ')};
      `;

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
    }
    return undefined;
  }
}

/**
 * Runs a validation procedure on the database to validate data for a given schema, procedure name, plot ID, and census ID.
 * If the procedure name is 'ValidateScreenMeasuredDiameterMinMax' or 'ValidateHOMUpperAndLowerBounds', the function will also pass minimum and maximum values to the procedure.
 *
 * @param schema - The schema name where the validation procedure is located.
 * @param procedureName - The name of the validation procedure to execute.
 * @param plotID - The plot ID to use in the validation procedure.
 * @param censusID - The census ID to use in the validation procedure.
 * @param min - The minimum value to pass to the validation procedure (optional).
 * @param max - The maximum value to pass to the validation procedure (optional).
 * @returns A validation response object containing the total rows, failed rows, a message, and optionally the failed core measurement IDs.
 */
export async function runValidationProcedure(
  schema: string,
  procedureName: string,
  plotID: number | null,
  censusID: number | null,
  min?: number | null, // Adjusted type here
  max?: number | null // And here
) {
  const conn = await getConn();
  let query, parameters;

  // Since min and max are already either numbers or null, you don't need to convert them here
  if (procedureName === 'ValidateScreenMeasuredDiameterMinMax' || procedureName === 'ValidateHOMUpperAndLowerBounds') {
    // validation procedures have been updated to use new species limits tables
    query = `CALL ${schema}.${procedureName}(?, ?, ?, ?)`;
    parameters = [censusID, plotID, min, max];
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

    const validationResponse = {
      totalRows: validationSummary.TotalRows,
      failedRows: validationSummary.FailedRows,
      message: validationSummary.Message,
      ...(failedValidationIds.length > 0 && {
        failedCoreMeasurementIDs: failedValidationIds
      })
    };

    await conn.commit();
    return validationResponse;
  } catch (error: any) {
    if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
      // rollback should ONLY occur when the connection to MySQL is lost
      await conn.rollback();
      throw error;
    }
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Verifies the email address of a user in the database.
 *
 * @param email - The email address to verify.
 * @returns An object with two properties:
 *   - `emailVerified`: a boolean indicating whether the email address exists in the database.
 *   - `userStatus`: the status of the user associated with the email address.
 * @throws An error if there is a problem connecting to the database or executing the query.
 */
export async function verifyEmail(email: string): Promise<{ emailVerified: boolean; userStatus: string }> {
  const connection: PoolConnection | null = await getConn();
  try {
    const query = `SELECT UserStatus
                   FROM catalog.users
                   WHERE Email = ?
                   LIMIT 1`;
    const results = await runQuery(connection, query, [email]);

    // emailVerified is true if there is at least one result
    const emailVerified = results.length > 0;
    const userStatus = results[0].UserStatus;

    return { emailVerified, userStatus };
  } catch (error: any) {
    console.error('Error verifying email in database: ', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Retrieves all available sites from the database.
 *
 * @returns {Promise<SitesRDS[]>} An array of `SitesRDS` objects representing the available sites.
 * @throws {Error} If there is an error connecting to the database or executing the query.
 */
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
    console.log('getallschemas: ', sitesResults);

    return MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(sitesResults);
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Retrieves the list of sites that the user with the given email address is allowed to access.
 *
 * @param email - The email address of the user.
 * @returns {Promise<SitesRDS[]>} An array of `SitesRDS` objects representing the sites the user is allowed to access.
 * @throws {Error} If there is an error connecting to the database or executing the query, or if the user is not found.
 */
export async function getAllowedSchemas(email: string): Promise<SitesRDS[]> {
  const connection: PoolConnection | null = await getConn();
  try {
    // Query to get user ID
    const userQuery = `
      SELECT UserID
      FROM catalog.users
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

    return MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(sitesResults);
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (connection) connection.release();
  }
}

// helper functions for precise field changes
/**
 * Detects which fields have changed between two rows.
 * @param newRow The updated row data.
 * @param oldRow The original row data.
 * @param fieldList List of fields to check for changes.
 * @returns An array of fields that have changed.
 */
export function detectFieldChanges(newRow: any, oldRow: any, fieldList: string[]): string[] {
  return fieldList.filter(field => newRow[field] !== oldRow[field]);
}

export function generateUpdateQueries(schema: string, table: string, changedFields: string[], newRow: any, primaryKey: string): string[] {
  if (!newRow[primaryKey]) {
    // Skip queries where primary key is null
    return [];
  }

  return changedFields.map(field => {
    return mysql.format(`UPDATE ?? SET ?? = ? WHERE ?? = ?`, [`${schema}.${table}`, field, newRow[field], primaryKey, newRow[primaryKey]]);
  });
}

type FieldList = string[];

interface UpdateQueryConfig {
  slices: {
    [key: string]: {
      range: [number, number];
      primaryKey: string;
    };
  };
  fieldList: FieldList;
}

/**
 * Generates a set of SQL update queries based on the changes between a new row and an old row.
 *
 * @param schema - The database schema name.
 * @param newRow - The updated row data.
 * @param oldRow - The original row data.
 * @param config - An object containing configuration for the update queries, including field slices and primary keys.
 * @returns An array of SQL update queries.
 */
export function generateUpdateOperations(schema: string, newRow: any, oldRow: any, config: UpdateQueryConfig): string[] {
  const { fieldList, slices } = config;
  const changedFields = detectFieldChanges(newRow, oldRow, fieldList);

  const generateQueriesFromSlice = (type: keyof typeof slices): string[] => {
    const sliceConfig = slices[type];
    if (!sliceConfig) {
      return []; // Safety check in case of an undefined slice
    }
    const { range, primaryKey } = sliceConfig;
    const fieldsInSlice = fieldList.slice(range[0], range[1]);
    const changedInSlice = changedFields.filter(field => fieldsInSlice.includes(field));
    return generateUpdateQueries(schema, type as string, changedInSlice, newRow, primaryKey);
  };

  return Object.keys(slices)
    .reduce((acc, typeKey) => {
      const type = typeKey as keyof typeof slices; // Assert the correct type explicitly
      const queries = generateQueriesFromSlice(type);
      return [...acc, ...queries];
    }, [] as string[])
    .filter(query => query.length > 0);
}

export function generateInsertOperations(schema: string, newRow: any, config: UpdateQueryConfig): string[] {
  const { fieldList, slices } = config;

  const generateQueriesFromSlice = (type: keyof typeof slices): string => {
    const sliceConfig = slices[type];
    if (!sliceConfig) {
      return ''; // Safety check in case of an undefined slice
    }
    const { range } = sliceConfig;
    const fieldsInSlice = fieldList.slice(range[0], range[1]);
    return generateInsertQuery(schema, type as string, fieldsInSlice, newRow);
  };

  return Object.keys(slices)
    .map(typeKey => {
      const type = typeKey as keyof typeof slices;
      return generateQueriesFromSlice(type);
    })
    .filter(query => query.length > 0);
}

export function generateInsertQuery(schema: string, table: string, fields: string[], newRow: any): string {
  // Create an object containing only the fields in this slice
  const dataToInsert = fields.reduce(
    (obj, field) => {
      obj[field] = newRow[field];
      return obj;
    },
    {} as Record<string, any>
  );

  // Use mysql.format to safely construct the query
  return mysql.format(`INSERT INTO ?? SET ?`, [`${schema}.${table}`, dataToInsert]);
}

// Field definitions and configurations

export const allTaxonomiesFields = [
  'family',
  'genus',
  'genusAuthority',
  'speciesCode',
  'speciesName',
  'subspeciesName',
  'speciesAuthority',
  'currentTaxonFlag',
  'obsoleteTaxonFlag',
  'fieldFamily',
  'speciesDescription'
];

const stemTaxonomiesViewFields = [
  'stemTag',
  'treeTag',
  'speciesCode',
  'family',
  'genus',
  'speciesName',
  'subspeciesName',
  'validCode',
  'genusAuthority',
  'speciesAuthority',
  'subspeciesAuthority',
  'speciesIDLevel',
  'speciesFieldFamily'
];

export const AllTaxonomiesViewQueryConfig: UpdateQueryConfig = {
  fieldList: allTaxonomiesFields,
  slices: {
    family: { range: [0, 1], primaryKey: 'FamilyID' },
    genus: { range: [1, 3], primaryKey: 'GenusID' },
    species: { range: [3, 11], primaryKey: 'SpeciesID' },
    reference: {
      range: [11, allTaxonomiesFields.length],
      primaryKey: 'ReferenceID'
    }
  }
};

export const StemTaxonomiesViewQueryConfig: UpdateQueryConfig = {
  fieldList: stemTaxonomiesViewFields,
  slices: {
    trees: { range: [0, 1], primaryKey: 'TreeID' },
    stems: { range: [1, 2], primaryKey: 'StemID' },
    family: { range: [2, 3], primaryKey: 'FamilyID' },
    genus: { range: [3, 5], primaryKey: 'GenusID' },
    species: {
      range: [5, stemTaxonomiesViewFields.length],
      primaryKey: 'SpeciesID'
    }
  }
};
