import { PoolConnection } from 'mysql2/promise';
import { fileMappings, getConn, InsertUpdateProcessingProps, runQuery } from '@/components/processors/processormacros';
import { processCensus } from '@/components/processors/processcensus';
import MapperFactory from '@/config/datamapper';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';
import { handleUpsert } from '@/config/utils';

// need to try integrating this into validation system:

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
    console.log('results: ', results);

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

type FieldList = string[];

interface UpdateQueryConfig {
  slices: {
    [key: string]: {
      range: [number, number];
      primaryKey: string;
      foreignKeys?: string[];
    };
  };
  fieldList: FieldList;
}

export async function handleUpsertForSlices<Result>(
  connection: PoolConnection,
  schema: string,
  newRow: Partial<Result>,
  config: UpdateQueryConfig
): Promise<{ [key: string]: number }> {
  const insertedIds: { [key: string]: number } = {};
  console.log('Initial newRow data:', newRow);

  for (const sliceKey in config.slices) {
    console.log('sliceKey: ', sliceKey);
    const { range, primaryKey } = config.slices[sliceKey];
    console.log('range: ', range);
    console.log('primaryKey: ', primaryKey);

    // Extract fields relevant to the current slice
    const fieldsInSlice = config.fieldList.slice(range[0], range[1]);
    console.log('fieldsInSlice: ', fieldsInSlice);

    // Build rowData for the current slice
    const rowData: Partial<Result> = {};
    fieldsInSlice.forEach(field => {
      console.log('field in slice: ', field);
      rowData[field as keyof Result] = newRow[field as keyof Result];
      console.log('updated rowData: ', rowData);
    });

    // Check if we need to propagate a foreign key from a prior slice
    const prevSlice = getPreviousSlice(sliceKey, config.slices);
    if (prevSlice && insertedIds[prevSlice]) {
      const prevPrimaryKey = config.slices[prevSlice].primaryKey; // Use the primary key from the config
      (rowData as any)[prevPrimaryKey] = insertedIds[prevSlice]; // Set the foreign key in the current row
      console.log(`Propagated foreign key ${String(prevPrimaryKey)}: `, insertedIds[prevSlice]);
    }

    // Perform the upsert and store the resulting ID
    insertedIds[sliceKey] = await handleUpsert<Result>(connection, schema, sliceKey, rowData, primaryKey as keyof Result);
  }

  return insertedIds;
}

// Helper function to get the immediate previous slice based on dependencies
function getPreviousSlice(currentSlice: string, slices: { [key: string]: any }): string | null {
  const dependencyOrder = ['family', 'genus', 'species', 'trees', 'stems']; // Order based on dependencies
  const currentIndex = dependencyOrder.indexOf(currentSlice);

  if (currentIndex > 0) {
    return dependencyOrder[currentIndex - 1]; // Return the slice that comes immediately before the current one
  }

  return null; // No previous slice if it's the first one
}

// Helper function to get the immediate previous slice based on dependencies
export async function handleDeleteForSlices<Result>(
  connection: PoolConnection,
  schema: string,
  rowData: Partial<Result>,
  config: UpdateQueryConfig
): Promise<void> {
  // Iterate over the slices in reverse order to handle foreign key constraints
  const sliceKeys = Object.keys(config.slices).reverse();

  for (const sliceKey of sliceKeys) {
    console.log('Deleting sliceKey: ', sliceKey);
    const { range, primaryKey } = config.slices[sliceKey];
    console.log('range: ', range);
    console.log('primaryKey: ', primaryKey);

    const fieldsInSlice = config.fieldList.slice(range[0], range[1]);
    console.log('fieldsInSlice: ', fieldsInSlice);

    // Build the row data for this slice
    const deleteConditions: Partial<Result> = {};
    fieldsInSlice.forEach(field => {
      deleteConditions[field as keyof Result] = rowData[field as keyof Result];
    });

    // Ensure that a primary key is present for deletion
    const primaryKeyValue = rowData[primaryKey as keyof Result];
    if (!primaryKeyValue) {
      console.error(`Primary key ${primaryKey} is missing in rowData for slice: ${sliceKey}`);
      throw new Error(`Primary key ${primaryKey} is required for deletion in ${sliceKey}.`);
    }

    // If the slice is 'species', check for foreign key constraints in related tables (e.g., 'trees')
    if (sliceKey === 'species') {
      const deleteFromRelatedTableQuery = `
        DELETE FROM \`${schema}\`.trees
        WHERE \`SpeciesID\` = ?;
      `;
      try {
        console.log('Deleting related rows from trees for SpeciesID:', primaryKeyValue);
        await runQuery(connection, deleteFromRelatedTableQuery, [primaryKeyValue]);
      } catch (error) {
        console.error(`Error deleting related rows from trees for SpeciesID ${primaryKeyValue}:`, error);
        throw new Error(`Failed to delete related rows from trees for SpeciesID ${primaryKeyValue}.`);
      }
    }

    // Perform the deletion based on the primary key
    const deleteQuery = `
      DELETE FROM \`${schema}\`.\`${sliceKey}\`
      WHERE \`${primaryKey}\` = ?;
    `;

    try {
      console.log('Executing delete query for slice:', sliceKey);
      console.log('Delete query:', deleteQuery);

      // Use runQuery helper for executing the delete query
      await runQuery(connection, deleteQuery, [primaryKeyValue]);
    } catch (error) {
      console.error(`Error during deletion in ${sliceKey}:`, error);
      throw new Error(`Failed to delete from ${sliceKey}. Please check the logs for details.`);
    }
  }
  console.log('Deletion completed successfully.');
}

// Field definitions and configurations
export const allTaxonomiesFields = [
  'Family',
  'Genus',
  'GenusAuthority',
  'SpeciesCode',
  'SpeciesName',
  'SubspeciesName',
  'IDLevel',
  'SpeciesAuthority',
  'ValidCode',
  'SubspeciesAuthority',
  'FieldFamily',
  'Description'
];

const stemTaxonomiesViewFields = [
  'StemTag',
  'TreeTag',
  'SpeciesCode',
  'Family',
  'Genus',
  'SpeciesName',
  'SubspeciesName',
  'ValidCode',
  'GenusAuthority',
  'SpeciesAuthority',
  'SubspeciesAuthority',
  'IDLevel',
  'FieldFamily'
];

const measurementSummaryStagingFields = [
  'QuadratName',
  'SpeciesName',
  'SubspeciesName',
  'SpeciesCode',
  'TreeTag',
  'StemTag',
  'LocalX',
  'LocalY',
  'CoordinateUnits',
  'MeasurementDate',
  'MeasuredDBH',
  'DBHUnits',
  'MeasuredHOM',
  'HOMUnits',
  'Description',
  'Attributes'
];

export const AllTaxonomiesViewQueryConfig: UpdateQueryConfig = {
  fieldList: allTaxonomiesFields,
  slices: {
    family: { range: [0, 1], primaryKey: 'FamilyID' },
    genus: { range: [1, 3], primaryKey: 'GenusID' },
    species: { range: [3, allTaxonomiesFields.length], primaryKey: 'SpeciesID' }
  }
};

export const StemTaxonomiesViewQueryConfig: UpdateQueryConfig = {
  fieldList: stemTaxonomiesViewFields,
  slices: {
    family: { range: [2, 3], primaryKey: 'FamilyID' },
    genus: { range: [3, 5], primaryKey: 'GenusID' },
    species: {
      range: [5, stemTaxonomiesViewFields.length],
      primaryKey: 'SpeciesID'
    },
    trees: { range: [0, 1], primaryKey: 'TreeID' },
    stems: { range: [1, 2], primaryKey: 'StemID' }
  }
};

// Generalized runValidation function
export async function runValidation(
  validationProcedureID: number,
  validationProcedureName: string,
  schema: string,
  cursorQuery: string,
  params: {
    p_CensusID?: number | null;
    p_PlotID?: number | null;
    minDBH?: number | null;
    maxDBH?: number | null;
    minHOM?: number | null;
    maxHOM?: number | null;
  } = {}
) {
  const conn = await getConn();

  try {
    await conn.beginTransaction();

    // Dynamically replace SQL variables with actual TypeScript input values
    const formattedCursorQuery = cursorQuery
      .replace(/@p_CensusID/g, params.p_CensusID !== null && params.p_CensusID !== undefined ? params.p_CensusID.toString() : 'NULL')
      .replace(/@p_PlotID/g, params.p_PlotID !== null && params.p_PlotID !== undefined ? params.p_PlotID.toString() : 'NULL')
      .replace(/@minDBH/g, params.minDBH !== null && params.minDBH !== undefined ? params.minDBH.toString() : 'NULL')
      .replace(/@maxDBH/g, params.maxDBH !== null && params.maxDBH !== undefined ? params.maxDBH.toString() : 'NULL')
      .replace(/@minHOM/g, params.minHOM !== null && params.minHOM !== undefined ? params.minHOM.toString() : 'NULL')
      .replace(/@maxHOM/g, params.maxHOM !== null && params.maxHOM !== undefined ? params.maxHOM.toString() : 'NULL')
      .replace(/cmattributes/g, 'TEMP_CMATTRIBUTES_PLACEHOLDER')
      .replace(/coremeasurements/g, `${schema}.coremeasurements`) // Fully qualify table names
      .replace(/stems/g, `${schema}.stems`)
      .replace(/trees/g, `${schema}.trees`)
      .replace(/quadrats/g, `${schema}.quadrats`)
      .replace(/cmverrors/g, `${schema}.cmverrors`)
      .replace(/species/g, `${schema}.species`)
      .replace(/genus/g, `${schema}.genus`)
      .replace(/family/g, `${schema}.family`)
      .replace(/plots/g, `${schema}.plots`)
      .replace(/census/g, `${schema}.census`)
      .replace(/personnel/g, `${schema}.personnel`)
      .replace(/attributes/g, `${schema}.attributes`)
      .replace(/TEMP_CMATTRIBUTES_PLACEHOLDER/g, `${schema}.cmattributes`);

    // Advanced handling: If minDBH, maxDBH, minHOM, or maxHOM are null, dynamically fetch the species-specific limits.
    if (params.minDBH === null || params.maxDBH === null || params.minHOM === null || params.maxHOM === null) {
      const speciesLimitsQuery = `
        SELECT 
          sl.LimitType,
          COALESCE(${params.minDBH !== null && params.minDBH !== undefined ? params.minDBH.toString() : 'NULL'}, IF(sl.LimitType = 'DBH', sl.LowerBound, NULL)) AS minDBH,
          COALESCE(${params.maxDBH !== null && params.maxDBH !== undefined ? params.maxDBH.toString() : 'NULL'}, IF(sl.LimitType = 'DBH', sl.UpperBound, NULL)) AS maxDBH,
          COALESCE(${params.minHOM !== null && params.minHOM !== undefined ? params.minHOM.toString() : 'NULL'}, IF(sl.LimitType = 'HOM', sl.LowerBound, NULL)) AS minHOM,
          COALESCE(${params.maxHOM !== null && params.maxHOM !== undefined ? params.maxHOM.toString() : 'NULL'}, IF(sl.LimitType = 'HOM', sl.UpperBound, NULL)) AS maxHOM
        FROM 
          ${schema}.specieslimits sl
        JOIN 
          ${schema}.species sp ON sp.SpeciesID = sl.SpeciesID
        JOIN 
          ${schema}.trees t ON t.SpeciesID = sp.SpeciesID
        JOIN 
          ${schema}.stems st ON st.TreeID = t.TreeID
        JOIN
          ${schema}.quadrats q ON st.QuadratID = q.QuadratID
        JOIN 
          ${schema}.coremeasurements cm ON cm.StemID = st.StemID
        WHERE 
          cm.IsValidated IS NULL
          AND (${params.p_CensusID !== null ? `cm.CensusID = ${params.p_CensusID}` : 'TRUE'})
          AND (${params.p_PlotID !== null ? `q.PlotID = ${params.p_PlotID}` : 'TRUE'})
        LIMIT 1;
      `;
      const speciesLimits = await runQuery(conn, speciesLimitsQuery);

      if (speciesLimits.length > 0) {
        // If any species-specific limits were fetched, update the variables
        params.minDBH = speciesLimits[0].minDBH || params.minDBH;
        params.maxDBH = speciesLimits[0].maxDBH || params.maxDBH;
        params.minHOM = speciesLimits[0].minHOM || params.minHOM;
        params.maxHOM = speciesLimits[0].maxHOM || params.maxHOM;
      }
    }

    // Reformat the query after potentially updating the parameters with species-specific limits
    const reformattedCursorQuery = formattedCursorQuery
      .replace(/@minDBH/g, params.minDBH !== null && params.minDBH !== undefined ? params.minDBH.toString() : 'NULL')
      .replace(/@maxDBH/g, params.maxDBH !== null && params.maxDBH !== undefined ? params.maxDBH.toString() : 'NULL')
      .replace(/@minHOM/g, params.minHOM !== null && params.minHOM !== undefined ? params.minHOM.toString() : 'NULL')
      .replace(/@maxHOM/g, params.maxHOM !== null && params.maxHOM !== undefined ? params.maxHOM.toString() : 'NULL');

    // Execute the cursor query to get the rows that need validation
    const cursorResults = await runQuery(conn, reformattedCursorQuery);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO ${schema}.cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM ${schema}.cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;

      // Insert errors for all rows that matched the validation condition
      for (const row of cursorResults) {
        await runQuery(conn, insertErrorQuery, [row.CoreMeasurementID, validationProcedureID, row.CoreMeasurementID, validationProcedureID]);
      }
    }

    await conn.commit();
    return {
      TotalRows: cursorResults.length,
      Message: `Validation completed successfully. Total rows processed: ${cursorResults.length}`
    };
  } catch (error: any) {
    await conn.rollback();
    console.error(`Error during ${validationProcedureName} validation:`, error.message);
    throw new Error(`${validationProcedureName} validation failed. Please check the logs for more details.`);
  } finally {
    if (conn) conn.release();
  }
}

export async function updateValidatedRows(schema: string, params: { p_CensusID?: number | null; p_PlotID?: number | null }) {
  const conn = await getConn();
  const setVariables = `SET @p_CensusID = ?, @p_PlotID = ?;`;
  const tempTable = `CREATE TEMPORARY TABLE UpdatedRows (CoreMeasurementID INT);`;
  const insertTemp = `
    INSERT INTO UpdatedRows (CoreMeasurementID)
    SELECT cm.CoreMeasurementID
    FROM ${schema}.coremeasurements cm
    LEFT JOIN ${schema}.cmverrors cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
    JOIN ${schema}.census c ON cm.CensusID = c.CensusID
    WHERE cm.IsValidated IS NULL
    AND (@p_CensusID IS NULL OR c.CensusID = @p_CensusID)
    AND (@p_PlotID IS NULL OR c.PlotID = @p_PlotID);`;
  const query = `
    UPDATE ${schema}.coremeasurements cm
    LEFT JOIN ${schema}.cmverrors cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
    JOIN ${schema}.census c ON cm.CensusID = c.CensusID
    SET cm.IsValidated = CASE 
        WHEN cme.CMVErrorID IS NULL THEN TRUE
        WHEN cme.CMVErrorID IS NOT NULL THEN FALSE
        ELSE cm.IsValidated  
    END
    WHERE cm.IsValidated IS NULL
    AND cm.CoreMeasurementID IN (SELECT CoreMeasurementID FROM UpdatedRows);`;
  const getUpdatedRows = `
    SELECT cm.*
    FROM ${schema}.coremeasurements cm
    JOIN UpdatedRows ur ON cm.CoreMeasurementID = ur.CoreMeasurementID;`;
  const dropTemp = `DROP TEMPORARY TABLE UpdatedRows;`;
  try {
    await conn.beginTransaction();
    await runQuery(conn, setVariables, [params.p_CensusID || null, params.p_PlotID || null]);
    await runQuery(conn, tempTable);
    await runQuery(conn, insertTemp);
    await runQuery(conn, query);
    const results = await runQuery(conn, getUpdatedRows);
    await runQuery(conn, dropTemp);
    await conn.commit();
    return MapperFactory.getMapper<any, any>('coremeasurements').mapData(results);
  } catch (error: any) {
    await conn.rollback();
    console.error(`Error during updateValidatedRows:`, error.message);
    throw new Error(`updateValidatedRows failed. Please check the logs for more details.`);
  } finally {
    if (conn) conn.release();
  }
}
