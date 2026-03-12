import MapperFactory from '@/config/datamapper';
import { handleUpsert } from '@/config/utils';
import { AllTaxonomiesViewRDS, AllTaxonomiesViewResult } from '@/config/sqlrdsdefinitions/views';
import ConnectionManager from '@/config/connectionmanager';
import { fileMappings, InsertUpdateProcessingProps } from '@/config/macros';
import ailogger from '@/ailogger';
import { ensureMeasurementErrorDefinition, VALIDATION_ERROR_SOURCE } from '@/config/measurementerrors';

// need to try integrating this into validation system:

export async function insertOrUpdate(props: InsertUpdateProcessingProps): Promise<void> {
  const { formType, schema, ...subProps } = props;
  const { connectionManager, rowData } = subProps;
  const mapping = fileMappings[formType];
  if (!mapping) {
    throw new Error(`Mapping not found for file type: ${formType}`);
  }
  if (formType === 'measurements') {
    throw new Error('Individual measurements processing is no longer supported. Use bulk processing instead.');
  } else {
    if (mapping.specialProcessing) {
      await mapping.specialProcessing({ ...subProps, schema });
    } else {
      const columns = Object.keys(mapping.columnMappings);
      if (columns.includes('plotID')) rowData['plotID'] = subProps.plot?.plotID?.toString() ?? null;
      if (columns.includes('censusID')) rowData['censusID'] = subProps.census?.dateRanges?.[0]?.censusID?.toString() ?? null;
      const tableColumns = columns.map(fileColumn => mapping.columnMappings[fileColumn]).join(', ');
      const placeholders = columns.map(() => '?').join(', '); // Use '?' for placeholders in MySQL
      const values = columns.map(fileColumn => {
        const value = rowData[fileColumn];
        if (typeof value === 'string' && value === '') return null;
        return value;
      });
      const query = `
        INSERT INTO ${schema}.${mapping.tableName} (${tableColumns})
        VALUES (${placeholders})
        ON DUPLICATE KEY
          UPDATE ${tableColumns
            .split(', ')
            .map(column => `${column} = VALUES(${column})`)
            .join(', ')};
      `;

      try {
        // Execute the query using the provided connection
        await connectionManager.executeQuery(query, values);
      } catch (error: any) {
        // Rollback the transaction in case of an error
        ailogger.error(`INSERT OR UPDATE: error in query execution: ${error}. Returning error breaking row to user... `);
        throw error;
      }
    }
  }
}

type FieldList = string[];

interface UpdateQueryConfig {
  slices: Record<
    string,
    {
      range: [number, number];
      primaryKey: string;
    }
  >;
  fieldList: FieldList;
}

export async function handleUpsertForSlices<Result>(
  connectionManager: ConnectionManager,
  schema: string,
  newRow: Partial<Result>,
  config: UpdateQueryConfig
): Promise<Record<string, number>> {
  const insertedIds: Record<string, number> = {};

  // Get the correct mapper for the view you're working with
  const mapper = MapperFactory.getMapper<AllTaxonomiesViewRDS, AllTaxonomiesViewResult>('alltaxonomiesview');

  // Convert newRow from RDS to Result upfront
  const mappedNewRow = mapper.demapData([newRow as any])[0];

  for (const sliceKey in config.slices) {
    const { range, primaryKey } = config.slices[sliceKey];

    // Extract fields relevant to the current slice from the already transformed newRow
    const rowData: Partial<Result> = {};
    const fieldsInSlice = config.fieldList.slice(range[0], range[1]);

    fieldsInSlice.forEach(field => {
      // Explicitly cast field as keyof Result and check if the field exists in mappedNewRow
      if (field in mappedNewRow) {
        rowData[field as keyof Result] = mappedNewRow[field as keyof typeof mappedNewRow];
      }
    });
    ailogger.info('after fields in slice rowData: ', rowData);

    // Check if we need to propagate a foreign key from a prior slice
    const prevSlice = getPreviousSlice(sliceKey, config.slices);
    if (prevSlice && insertedIds[prevSlice]) {
      const prevPrimaryKey = config.slices[prevSlice].primaryKey; // Use the primary key from the config
      (rowData as any)[prevPrimaryKey] = insertedIds[prevSlice]; // Set the foreign key in the current row
    }

    if ((mappedNewRow as any)[primaryKey] !== undefined) (rowData as any)[primaryKey] = (mappedNewRow as any)[primaryKey];
    ailogger.info('inserting rowData: ', rowData);

    // Perform the upsert and store the resulting ID
    insertedIds[sliceKey] = (await handleUpsert<Result>(connectionManager, schema, sliceKey, rowData, primaryKey as keyof Result)).id;
  }

  return insertedIds;
}

// Helper function to get the immediate previous slice based on dependencies
function getPreviousSlice(currentSlice: string, _slices: Record<string, any>): string | null {
  const dependencyOrder = ['family', 'genus', 'species', 'trees', 'stems']; // Order based on dependencies
  const currentIndex = dependencyOrder.indexOf(currentSlice);

  if (currentIndex > 0) {
    return dependencyOrder[currentIndex - 1]; // Return the slice that comes immediately before the current one
  }

  return null; // No previous slice if it's the first one
}

// Helper function to get the immediate previous slice based on dependencies
export async function handleDeleteForSlices<Result>(
  connectionManager: ConnectionManager,
  schema: string,
  rowData: Partial<Result>,
  config: UpdateQueryConfig
): Promise<void> {
  // Iterate over the slices in reverse order to handle foreign key constraints
  const sliceKeys = Object.keys(config.slices).reverse();

  for (const sliceKey of sliceKeys) {
    const { range, primaryKey } = config.slices[sliceKey];

    const fieldsInSlice = config.fieldList.slice(range[0], range[1]);

    // Build the row data for this slice
    const deleteConditions: Partial<Result> = {};
    fieldsInSlice.forEach(field => {
      deleteConditions[field as keyof Result] = rowData[field as keyof Result];
    });

    // Ensure that a primary key is present for deletion
    const primaryKeyValue = rowData[primaryKey as keyof Result];
    if (!primaryKeyValue) {
      ailogger.error(`Primary key ${primaryKey} is missing in rowData for slice: ${sliceKey}`);
      throw new Error(`Primary key ${primaryKey} is required for deletion in ${sliceKey}.`);
    }

    // If the slice is 'species', check for foreign key constraints in related tables (e.g., 'trees')
    if (sliceKey === 'species') {
      const deleteFromRelatedTableQuery = `
        DELETE FROM \`${schema}\`.trees
        WHERE \`SpeciesID\` = ?;
      `;
      try {
        await connectionManager.executeQuery(deleteFromRelatedTableQuery, [primaryKeyValue]);
      } catch (error: any) {
        ailogger.error(`Error deleting related rows from trees for SpeciesID ${primaryKeyValue}:`, error);
        throw new Error(`Failed to delete related rows from trees for SpeciesID ${primaryKeyValue}.`);
      }
    }

    // Perform the deletion based on the primary key
    const deleteQuery = `
      DELETE FROM \`${schema}\`.\`${sliceKey}\`
      WHERE \`${primaryKey}\` = ?;
    `;

    try {
      // Use runQuery helper for executing the delete query
      await connectionManager.executeQuery(deleteQuery, [primaryKeyValue]);
    } catch (error: any) {
      ailogger.error(`Error during deletion in ${sliceKey}:`, error);
      throw new Error(`Failed to delete from ${sliceKey}. Please check the logs for details.`);
    }
  }
  ailogger.info('Deletion completed successfully.');
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

const _stemTaxonomiesViewFields = [
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

const _measurementSummaryViewFields = [
  'PlotID',
  'CensusID',
  'QuadratName', // needs custom handling -- context values plot/census needed
  'SpeciesName',
  'SubspeciesName',
  'SpeciesCode',
  'TreeTag',
  'StemTag',
  'LocalX',
  'LocalY',
  'MeasurementDate',
  'MeasuredDBH',
  'MeasuredHOM',
  'Description',
  'Attributes'
];

// UNUSED: MeasurementsSummaryViewQueryConfig - removed to reduce bundle size
// export const MeasurementsSummaryViewQueryConfig: UpdateQueryConfig = {
//   fieldList: measurementSummaryViewFields,
//   slices: {
//     quadrats: { range: [0, 1], primaryKey: 'QuadratID' },
//     species: { range: [1, 4], primaryKey: 'SpeciesID' },
//     trees: { range: [4, 5], primaryKey: 'TreeID' },
//     stems: { range: [5, 9], primaryKey: 'StemGUID' },
//     coremeasurements: { range: [9, measurementSummaryViewFields.length - 1], primaryKey: 'CoreMeasurementID' },
//     cmattributes: { range: [measurementSummaryViewFields.length - 1, measurementSummaryViewFields.length], primaryKey: 'CMAID' }
//   }
// };

export const AllTaxonomiesViewQueryConfig: UpdateQueryConfig = {
  fieldList: allTaxonomiesFields,
  slices: {
    family: { range: [0, 1], primaryKey: 'FamilyID' },
    genus: { range: [1, 3], primaryKey: 'GenusID' },
    species: { range: [3, allTaxonomiesFields.length], primaryKey: 'SpeciesID' }
  }
};

// UNUSED: StemTaxonomiesViewQueryConfig - removed to reduce bundle size
// export const StemTaxonomiesViewQueryConfig: UpdateQueryConfig = {
//   fieldList: stemTaxonomiesViewFields,
//   slices: {
//     family: { range: [2, 3], primaryKey: 'FamilyID' },
//     genus: { range: [3, 5], primaryKey: 'GenusID' },
//     species: {
//       range: [5, stemTaxonomiesViewFields.length],
//       primaryKey: 'SpeciesID'
//     },
//     trees: { range: [0, 1], primaryKey: 'TreeID' },
//     stems: { range: [1, 2], primaryKey: 'StemGUID' }
//   }
// };

function isRetryableValidationLockError(error: any) {
  return (
    error?.code === 'ER_LOCK_DEADLOCK' ||
    error?.errno === 1213 ||
    error?.code === 'ER_LOCK_WAIT_TIMEOUT' ||
    error?.errno === 1205
  );
}

type ValidationExecutionParams = {
  p_CensusID?: number | null;
  p_PlotID?: number | null;
};

type CombinedDBHValidationResult = {
  success: boolean;
  ranGrowth: boolean;
  ranShrinkage: boolean;
  error?: string;
};

type CombinedCrossCensusLocationValidationResult = {
  success: boolean;
  ranQuadratMismatch: boolean;
  ranCoordinateDrift: boolean;
  error?: string;
};

function mysqlBoolToBoolean(value: any): boolean {
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

async function prepareValidationRun(
  connectionManager: ConnectionManager,
  schema: string,
  validationProcedureID: number,
  validationProcedureName: string,
  transactionID: string,
  params: ValidationExecutionParams
): Promise<void> {
  // Ensure error definition exists OUTSIDE the transaction (auto-commit) so
  // the INSERT ON DUPLICATE KEY UPDATE lock is released immediately rather
  // than being held for the duration of the potentially long-running
  // validation stored procedure.  This prevents lock-wait timeouts when
  // multiple validations run in parallel.
  await ensureMeasurementErrorDefinition(
    connectionManager,
    schema,
    VALIDATION_ERROR_SOURCE,
    String(validationProcedureID),
    `Validation ${validationProcedureName}`
  );

  const cleanupQuery = `
    DELETE cme FROM ${schema}.measurement_error_log cme
    JOIN ${schema}.measurement_errors me ON me.ErrorID = cme.ErrorID
    JOIN ${schema}.coremeasurements cm ON cme.MeasurementID = cm.CoreMeasurementID
    JOIN ${schema}.census c ON cm.CensusID = c.CensusID
    WHERE me.ErrorSource = ?
      AND me.ErrorCode = ?
      AND cm.IsValidated IS NULL
      AND cm.IsActive = TRUE
      AND (? IS NULL OR cm.CensusID = ?)
      AND (? IS NULL OR c.PlotID = ?)
  `;
  const censusID = params.p_CensusID ?? null;
  const plotID = params.p_PlotID ?? null;
  await connectionManager.executeQuery(
    cleanupQuery,
    [VALIDATION_ERROR_SOURCE, String(validationProcedureID), censusID, censusID, plotID, plotID],
    transactionID
  );

  ailogger.info(`[${validationProcedureName}] Cleared stale errors before re-validation`);
}

function formatValidationQuery(
  schema: string,
  cursorQuery: string,
  validationProcedureID: number,
  params: ValidationExecutionParams
): string {
  return cursorQuery
    .replace(/@p_CensusID/g, params.p_CensusID !== null && params.p_CensusID !== undefined ? params.p_CensusID.toString() : 'NULL')
    .replace(/@p_PlotID/g, params.p_PlotID !== null && params.p_PlotID !== undefined ? params.p_PlotID.toString() : 'NULL')
    .replace(/@validationProcedureID/g, validationProcedureID.toString())
    .replace(/\bCALL\s+(?![\w]*\.)(\w+)\s*\(/gi, `CALL ${schema}.$1(`)
    .replace(/(?<!\w\.)cmattributes\b/g, 'TEMP_CMATTRIBUTES_PLACEHOLDER')
    .replace(/(?<!\w\.)specieslimits\b/g, `${schema}.specieslimits`)
    .replace(/(?<!\w\.)coremeasurements\b/g, `${schema}.coremeasurements`)
    .replace(/(?<!\w\.)stems\b/g, `${schema}.stems`)
    .replace(/(?<!\w\.)trees\b/g, `${schema}.trees`)
    .replace(/(?<!\w\.)quadrats\b/g, `${schema}.quadrats`)
    .replace(/insert\s+into\s+cmverrors\s*\(\s*CoreMeasurementID\s*,\s*ValidationErrorID\s*\)/gi, `INSERT INTO ${schema}.measurement_error_log (MeasurementID, ErrorID)`)
    .replace(/(?<!\w\.)cmverrors\b/gi, `${schema}.measurement_error_log`)
    .replace(/\be\.CoreMeasurementID\b/gi, 'e.MeasurementID')
    .replace(/\be\.ValidationErrorID\b/gi, 'e.ErrorID')
    .replace(/(?<!\w\.)species\b/g, `${schema}.species`)
    .replace(/(?<!\w\.)genus\b/g, `${schema}.genus`)
    .replace(/(?<!\w\.)family\b/g, `${schema}.family`)
    .replace(/(?<!\w\.)plots\b/g, `${schema}.plots`)
    .replace(/(?<!\w\.)census\b/g, `${schema}.census`)
    .replace(/(?<!\w\.)personnel\b/g, `${schema}.personnel`)
    .replace(/(?<!\w\.)attributes\b/g, `${schema}.attributes`)
    .replace(/TEMP_CMATTRIBUTES_PLACEHOLDER/g, `${schema}.cmattributes`);
}

// Generalized runValidation function
export async function runValidation(
  validationProcedureID: number,
  validationProcedureName: string,
  schema: string,
  cursorQuery: string,
  params: ValidationExecutionParams = {}
): Promise<boolean> {
  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;
  const MAX_ATTEMPTS = 10; // CRITICAL FIX: Prevent infinite retry loop

  while (attempt < MAX_ATTEMPTS) {
    let transactionID: string = '';

    try {
      attempt++;
      transactionID = await connectionManager.beginTransaction();

      await prepareValidationRun(connectionManager, schema, validationProcedureID, validationProcedureName, transactionID, params);

      // STEP 2: Dynamically replace SQL variables with actual TypeScript input values
      const formattedCursorQuery = formatValidationQuery(schema, cursorQuery, validationProcedureID, params);

      // STEP 3: Execute the validation query to insert new errors
      const finalCursorQuery =
        /insert\s+into\s+.*measurement_error_log/gi.test(formattedCursorQuery) && !/on\s+duplicate\s+key/gi.test(formattedCursorQuery)
          ? formattedCursorQuery.replace(/;?\s*$/, ' ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;')
          : formattedCursorQuery;

      await connectionManager.executeQuery(finalCursorQuery, [], transactionID);
      await connectionManager.commitTransaction(transactionID ?? '');
      return true;
    } catch (e: any) {
      if (isRetryableValidationLockError(e)) {
        if (attempt >= MAX_ATTEMPTS) {
          ailogger.error(`Validation failed after ${MAX_ATTEMPTS} attempts due to persistent lock contention/timeouts`);
          try {
            await connectionManager.rollbackTransaction(transactionID);
          } catch (rollbackError: any) {
            ailogger.error('Rollback error:', rollbackError);
          }
          return false;
        }

        ailogger.info(`Validation attempt ${attempt}: retryable lock error encountered (error code: ${e.code || e.errno}). Retrying after ${delay}ms...`);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: any) {
          ailogger.error('Rollback error:', rollbackError);
        }
        // Wait for an exponentially increasing delay before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 5000); // Exponential backoff capped at 5 seconds
      } else {
        ailogger.error(`Validation ${validationProcedureName} (ID ${validationProcedureID}) failed with non-deadlock error:`, e.message, e.code);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: any) {
          ailogger.error('Rollback error:', rollbackError);
        }
        return false;
      }
    }
  }

  // If we exit the loop without success, max retries exceeded
  ailogger.error(`Validation failed: max retry limit (${MAX_ATTEMPTS}) exceeded`);
  return false;
}

export async function runCombinedDBHValidations(
  schema: string,
  params: ValidationExecutionParams = {}
): Promise<CombinedDBHValidationResult> {
  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;
  const MAX_ATTEMPTS = 10;

  while (attempt < MAX_ATTEMPTS) {
    let transactionID = '';

    try {
      attempt++;
      transactionID = await connectionManager.beginTransaction();

      const validationRows = await connectionManager.executeQuery(
        `
          SELECT ValidationID, ProcedureName, IsEnabled
          FROM ${schema}.sitespecificvalidations
          WHERE ValidationID IN (1, 2)
        `,
        [],
        transactionID
      );

      const growthValidation = validationRows.find((row: any) => Number(row.ValidationID) === 1);
      const shrinkageValidation = validationRows.find((row: any) => Number(row.ValidationID) === 2);

      const ranGrowth = mysqlBoolToBoolean(growthValidation?.IsEnabled);
      const ranShrinkage = mysqlBoolToBoolean(shrinkageValidation?.IsEnabled);

      if (ranGrowth) {
        await prepareValidationRun(
          connectionManager,
          schema,
          1,
          growthValidation?.ProcedureName ?? 'ValidateDBHGrowthExceedsMax',
          transactionID,
          params
        );
      }

      if (ranShrinkage) {
        await prepareValidationRun(
          connectionManager,
          schema,
          2,
          shrinkageValidation?.ProcedureName ?? 'ValidateDBHShrinkageExceedsMax',
          transactionID,
          params
        );
      }

      if (ranGrowth || ranShrinkage) {
        await connectionManager.executeQuery(
          `CALL ${schema}.RunSharedDBHChangeValidations(?, ?, ?, ?)`,
          [params.p_CensusID ?? null, params.p_PlotID ?? null, ranGrowth ? 1 : 0, ranShrinkage ? 1 : 0],
          transactionID
        );
      }

      await connectionManager.commitTransaction(transactionID);
      return { success: true, ranGrowth, ranShrinkage };
    } catch (e: any) {
      if (isRetryableValidationLockError(e)) {
        if (attempt >= MAX_ATTEMPTS) {
          ailogger.error(`Combined DBH validations failed after ${MAX_ATTEMPTS} attempts due to persistent lock contention/timeouts`);
          try {
            await connectionManager.rollbackTransaction(transactionID);
          } catch (rollbackError: any) {
            ailogger.error('Rollback error:', rollbackError);
          }
          return {
            success: false,
            ranGrowth: false,
            ranShrinkage: false,
            error: `Combined DBH validations failed after ${MAX_ATTEMPTS} attempts due to lock contention/timeouts`
          };
        }

        ailogger.info(`Combined DBH validation attempt ${attempt}: retryable lock error encountered. Retrying after ${delay}ms...`);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: any) {
          ailogger.error('Rollback error:', rollbackError);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 5000);
      } else {
        ailogger.error(`Combined DBH validations failed with non-deadlock error:`, e.message, e.code);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: any) {
          ailogger.error('Rollback error:', rollbackError);
        }
        return { success: false, ranGrowth: false, ranShrinkage: false, error: e.message };
      }
    }
  }

  ailogger.error(`Combined DBH validations failed: max retry limit (${MAX_ATTEMPTS}) exceeded`);
  return {
    success: false,
    ranGrowth: false,
    ranShrinkage: false,
    error: `Combined DBH validations failed: max retry limit (${MAX_ATTEMPTS}) exceeded`
  };
}

export async function runCombinedCrossCensusLocationValidations(
  schema: string,
  params: ValidationExecutionParams = {}
): Promise<CombinedCrossCensusLocationValidationResult> {
  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;
  const MAX_ATTEMPTS = 10;

  while (attempt < MAX_ATTEMPTS) {
    let transactionID = '';

    try {
      attempt++;
      transactionID = await connectionManager.beginTransaction();

      const validationRows = await connectionManager.executeQuery(
        `
          SELECT ValidationID, ProcedureName, IsEnabled
          FROM ${schema}.sitespecificvalidations
          WHERE ValidationID IN (17, 18)
        `,
        [],
        transactionID
      );

      const quadratMismatchValidation = validationRows.find((row: any) => Number(row.ValidationID) === 17);
      const coordinateDriftValidation = validationRows.find((row: any) => Number(row.ValidationID) === 18);

      const ranQuadratMismatch = mysqlBoolToBoolean(quadratMismatchValidation?.IsEnabled);
      const ranCoordinateDrift = mysqlBoolToBoolean(coordinateDriftValidation?.IsEnabled);

      if (ranQuadratMismatch) {
        await prepareValidationRun(
          connectionManager,
          schema,
          17,
          quadratMismatchValidation?.ProcedureName ?? 'ValidateQuadratMismatchAcrossCensuses',
          transactionID,
          params
        );
      }

      if (ranCoordinateDrift) {
        await prepareValidationRun(
          connectionManager,
          schema,
          18,
          coordinateDriftValidation?.ProcedureName ?? 'ValidateCoordinateDriftAcrossCensuses',
          transactionID,
          params
        );
      }

      if (ranQuadratMismatch || ranCoordinateDrift) {
        // Set a 10-minute MySQL statement timeout so an unoptimised query
        // cannot run for 54+ minutes and orphan a connection.  10 minutes
        // is needed for large cross-census comparisons (e.g. 212K × 192K rows).
        const CROSS_CENSUS_TIMEOUT_MS = 10 * 60 * 1000;
        await connectionManager.executeQuery(
          `SET SESSION MAX_EXECUTION_TIME = ${CROSS_CENSUS_TIMEOUT_MS}`,
          [],
          transactionID
        );

        try {
          await connectionManager.executeQuery(
            `CALL ${schema}.RunSharedCrossCensusLocationValidations(?, ?, ?, ?)`,
            [params.p_CensusID ?? null, params.p_PlotID ?? null, ranQuadratMismatch ? 1 : 0, ranCoordinateDrift ? 1 : 0],
            transactionID
          );
        } finally {
          // Always reset MAX_EXECUTION_TIME so it doesn't leak to other queries
          // that reuse this pooled connection after rollback.
          try {
            await connectionManager.executeQuery(
              'SET SESSION MAX_EXECUTION_TIME = 0',
              [],
              transactionID
            );
          } catch {
            // Connection may already be dead after a timeout — swallow safely.
          }
        }
      }

      await connectionManager.commitTransaction(transactionID);
      return { success: true, ranQuadratMismatch, ranCoordinateDrift };
    } catch (e: any) {
      if (isRetryableValidationLockError(e)) {
        if (attempt >= MAX_ATTEMPTS) {
          ailogger.error(`Combined cross-census location validations failed after ${MAX_ATTEMPTS} attempts due to persistent lock contention/timeouts`);
          try {
            await connectionManager.rollbackTransaction(transactionID);
          } catch (rollbackError: any) {
            ailogger.error('Rollback error:', rollbackError);
          }
          return {
            success: false,
            ranQuadratMismatch: false,
            ranCoordinateDrift: false,
            error: `Combined cross-census location validations failed after ${MAX_ATTEMPTS} attempts due to lock contention/timeouts`
          };
        }

        ailogger.info(`Combined cross-census location validation attempt ${attempt}: retryable lock error encountered. Retrying after ${delay}ms...`);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: any) {
          ailogger.error('Rollback error:', rollbackError);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 5000);
      } else {
        ailogger.error(`Combined cross-census location validations failed with non-deadlock error:`, e.message, e.code);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: any) {
          ailogger.error('Rollback error:', rollbackError);
        }
        return {
          success: false,
          ranQuadratMismatch: false,
          ranCoordinateDrift: false,
          error: e.message
        };
      }
    }
  }

  ailogger.error(`Combined cross-census location validations failed: max retry limit (${MAX_ATTEMPTS}) exceeded`);
  return {
    success: false,
    ranQuadratMismatch: false,
    ranCoordinateDrift: false,
    error: `Combined cross-census location validations failed: max retry limit (${MAX_ATTEMPTS}) exceeded`
  };
}

export async function updateValidatedRows(schema: string, params: { p_CensusID?: number | null; p_PlotID?: number | null }) {
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;

  // Use parameterized query to prevent SQL injection
  const censusID = params.p_CensusID ?? null;
  const plotID = params.p_PlotID ?? null;

  const updateQuery = `
  UPDATE ${schema}.coremeasurements cm
  JOIN ${schema}.census c ON cm.CensusID = c.CensusID
  SET cm.IsValidated = CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM ${schema}.measurement_error_log cme
      JOIN ${schema}.measurement_errors me ON me.ErrorID = cme.ErrorID
      WHERE cme.MeasurementID = cm.CoreMeasurementID
        AND cme.IsResolved = FALSE
        AND me.ErrorSource = 'validation'
    ) THEN TRUE
    ELSE FALSE
  END
  WHERE cm.IsValidated IS NULL
    AND (? IS NULL OR c.CensusID = ?)
    AND (? IS NULL OR c.PlotID = ?);
    `;

  try {
    // Begin transaction
    transactionID = await connectionManager.beginTransaction();

    await connectionManager.executeQuery(updateQuery, [censusID, censusID, plotID, plotID]);

    await connectionManager.commitTransaction(transactionID ?? '');
  } catch (error: any) {
    // Roll back on error
    await connectionManager.rollbackTransaction(transactionID ?? '');
    ailogger.error(`Error during updateValidatedRows:`, error.message);
    throw new Error(`updateValidatedRows failed for validation: Please check the logs for more details.`);
  } finally {
    // Close the connection
    await connectionManager.closeConnection();
  }
}
