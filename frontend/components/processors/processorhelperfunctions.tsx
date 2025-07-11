import { processCensus } from '@/components/processors/processcensus';
import MapperFactory from '@/config/datamapper';
import { handleUpsert } from '@/config/utils';
import { AllTaxonomiesViewRDS, AllTaxonomiesViewResult } from '@/config/sqlrdsdefinitions/views';
import ConnectionManager from '@/config/connectionmanager';
import { fileMappings, InsertUpdateProcessingProps } from '@/config/macros';

// need to try integrating this into validation system:

export async function insertOrUpdate(props: InsertUpdateProcessingProps): Promise<void> {
  const { formType, schema, ...subProps } = props;
  const { connectionManager, rowData } = subProps;
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
      if (columns.includes('plotID')) rowData['plotID'] = subProps.plot?.plotID?.toString() ?? null;
      if (columns.includes('censusID')) rowData['censusID'] = subProps.census?.dateRanges[0]?.censusID?.toString() ?? null;
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
      } catch (error) {
        // Rollback the transaction in case of an error
        console.error(`INSERT OR UPDATE: error in query execution: ${error}. Returning error breaking row to user... `);
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
  console.log('mappedNewRow: ', mappedNewRow);

  for (const sliceKey in config.slices) {
    const { range, primaryKey } = config.slices[sliceKey];
    console.log('range: ', range, ' primaryKey: ', primaryKey);

    // Extract fields relevant to the current slice from the already transformed newRow
    const rowData: Partial<Result> = {};
    const fieldsInSlice = config.fieldList.slice(range[0], range[1]);

    fieldsInSlice.forEach(field => {
      // Explicitly cast field as keyof Result and check if the field exists in mappedNewRow
      if (field in mappedNewRow) {
        rowData[field as keyof Result] = mappedNewRow[field as keyof typeof mappedNewRow];
      }
    });
    console.log('after fields in slice rowData: ', rowData);

    // Check if we need to propagate a foreign key from a prior slice
    const prevSlice = getPreviousSlice(sliceKey, config.slices);
    console.log('prevSlice: ', prevSlice);
    if (prevSlice && insertedIds[prevSlice]) {
      const prevPrimaryKey = config.slices[prevSlice].primaryKey; // Use the primary key from the config
      console.log('prevPrimaryKey: ', prevPrimaryKey);
      (rowData as any)[prevPrimaryKey] = insertedIds[prevSlice]; // Set the foreign key in the current row
      console.log('updated rowdata: ', rowData);
    }

    if ((mappedNewRow as any)[primaryKey] !== undefined) (rowData as any)[primaryKey] = (mappedNewRow as any)[primaryKey];
    console.log('inserting rowData: ', rowData);

    // Perform the upsert and store the resulting ID
    insertedIds[sliceKey] = (await handleUpsert<Result>(connectionManager, schema, sliceKey, rowData, primaryKey as keyof Result)).id;
    console.log(insertedIds[sliceKey]);
  }

  return insertedIds;
}

// Helper function to get the immediate previous slice based on dependencies
function getPreviousSlice(currentSlice: string, slices: Record<string, any>): string | null {
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
        await connectionManager.executeQuery(deleteFromRelatedTableQuery, [primaryKeyValue]);
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
      // Use runQuery helper for executing the delete query
      await connectionManager.executeQuery(deleteQuery, [primaryKeyValue]);
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

const measurementSummaryViewFields = [
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

export const MeasurementsSummaryViewQueryConfig: UpdateQueryConfig = {
  fieldList: measurementSummaryViewFields,
  slices: {
    quadrats: { range: [0, 1], primaryKey: 'QuadratID' },
    species: { range: [1, 4], primaryKey: 'SpeciesID' },
    trees: { range: [4, 5], primaryKey: 'TreeID' },
    stems: { range: [5, 9], primaryKey: 'StemID' },
    coremeasurements: { range: [9, measurementSummaryViewFields.length - 1], primaryKey: 'CoreMeasurementID' },
    cmattributes: { range: [measurementSummaryViewFields.length - 1, measurementSummaryViewFields.length], primaryKey: 'CMAID' }
  }
};

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

function isDeadlockError(error: any) {
  return error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213;
}

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
  } = {}
): Promise<boolean> {
  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;

  while (true) {
    let transactionID: string = '';

    try {
      attempt++;
      transactionID = await connectionManager.beginTransaction();

      // Dynamically replace SQL variables with actual TypeScript input values
      const formattedCursorQuery = cursorQuery
        .replace(/@p_CensusID/g, params.p_CensusID !== null && params.p_CensusID !== undefined ? params.p_CensusID.toString() : 'NULL')
        .replace(/@p_PlotID/g, params.p_PlotID !== null && params.p_PlotID !== undefined ? params.p_PlotID.toString() : 'NULL')
        // .replace(/@minDBH/g, params.minDBH !== null && params.minDBH !== undefined ? params.minDBH.toString() : 'NULL')
        // .replace(/@maxDBH/g, params.maxDBH !== null && params.maxDBH !== undefined ? params.maxDBH.toString() : 'NULL')
        .replace(/@validationProcedureID/g, validationProcedureID.toString())
        .replace(/cmattributes/g, 'TEMP_CMATTRIBUTES_PLACEHOLDER')
        .replace(/censusquadrats/g, 'TEMP_CQ_PLACEHOLDER')
        .replace(/censusspecies/g, 'TEMP_CS_PLACEHOLDER')
        .replace(/censusattributes/g, 'TEMP_CA_PLACEHOLDER')
        .replace(/censuspersonnel/g, 'TEMP_CP_PLACEHOLDER')
        .replace(/coremeasurements/g, `${schema}.coremeasurements`)
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
        .replace(/TEMP_CMATTRIBUTES_PLACEHOLDER/g, `${schema}.cmattributes`)
        .replace(/TEMP_CQ_PLACEHOLDER/g, `${schema}.censusquadrats`)
        .replace(/TEMP_CS_PLACEHOLDER/g, `${schema}.censusspecies`)
        .replace(/TEMP_CA_PLACEHOLDER/g, `${schema}.censusattributes`)
        .replace(/TEMP_CP_PLACEHOLDER/g, `${schema}.censuspersonnel`);

      // Advanced handling: If minDBH, maxDBH, minHOM, or maxHOM are null, dynamically fetch the species-specific limits.
      if (params.minDBH === null || params.maxDBH === null) {
        const speciesLimitsQuery = `
        SELECT sp.SpeciesID, sl.LimitType,
          IF(sl.LimitType = 'DBH', sl.LowerBound, NULL) AS minDBH,
          IF(sl.LimitType = 'DBH', sl.UpperBound, NULL) AS maxDBH
        FROM ${schema}.specieslimits sl
               JOIN
             ${schema}.species sp ON sp.SpeciesID = sl.SpeciesID
               JOIN
             ${schema}.trees t ON t.SpeciesID = sp.SpeciesID
               JOIN
             ${schema}.stems st ON st.TreeID = t.TreeID
               JOIN
             ${schema}.quadrats q ON st.QuadratID = q.QuadratID AND q.IsActive IS TRUE
               JOIN
             ${schema}.coremeasurements cm ON cm.StemID = st.StemID
        WHERE cm.IsValidated IS NULL
          AND (${params.p_CensusID !== null ? `sl.CensusID = ${params.p_CensusID}` : '1 = 1'})
          AND (${params.p_PlotID !== null ? `sl.PlotID = ${params.p_PlotID}` : '1 = 1'})
        LIMIT 1;
      `;
        const speciesLimits = await connectionManager.executeQuery(speciesLimitsQuery);
        if (speciesLimits.length > 0) {
          // If any species-specific limits were fetched, update the variables
          params.minDBH = speciesLimits[0].minDBH || params.minDBH;
          params.maxDBH = speciesLimits[0].maxDBH || params.maxDBH;
        }
      }

      // Reformat the query after potentially updating the parameters with species-specific limits
      const reformattedCursorQuery = formattedCursorQuery
        .replace(/@minDBH/g, params.minDBH !== null && params.minDBH !== undefined ? params.minDBH.toString() : 'NULL')
        .replace(/@maxDBH/g, params.maxDBH !== null && params.maxDBH !== undefined ? params.maxDBH.toString() : 'NULL');

      // Execute the cursor query to get the rows that need validation
      console.log('running validation: ', validationProcedureName);
      await connectionManager.executeQuery(reformattedCursorQuery);
      await connectionManager.commitTransaction(transactionID ?? '');
      console.log('validation executed.');
      return true;
    } catch (e: any) {
      if (isDeadlockError(e)) {
        console.log(`Validation Attempt ${attempt}: Deadlock encountered (error code: ${e.code || e.errno}). Retrying after ${delay}ms...`);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
        // Wait for an exponentially increasing delay before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
      } else {
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
        return false;
      }
    }
  }
}

export async function updateValidatedRows(schema: string, params: { p_CensusID?: number | null; p_PlotID?: number | null }) {
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  const updateQuery = `
  UPDATE ${schema}.coremeasurements cm
  JOIN ${schema}.census c ON cm.CensusID = c.CensusID
  SET cm.IsValidated = CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM ${schema}.cmverrors cme
      WHERE cme.CoreMeasurementID = cm.CoreMeasurementID
    ) THEN TRUE
    ELSE FALSE
  END
  WHERE cm.IsValidated IS NULL
    AND (${params.p_CensusID} IS NULL OR c.CensusID = ${params.p_CensusID})
    AND (${params.p_PlotID} IS NULL OR c.PlotID = ${params.p_PlotID});
    `;

  try {
    // Begin transaction
    transactionID = await connectionManager.beginTransaction();

    await connectionManager.executeQuery(updateQuery);

    await connectionManager.commitTransaction(transactionID ?? '');
  } catch (error: any) {
    // Roll back on error
    await connectionManager.rollbackTransaction(transactionID ?? '');
    console.error(`Error during updateValidatedRows:`, error.message);
    throw new Error(`updateValidatedRows failed for validation: Please check the logs for more details.`);
  } finally {
    // Close the connection
    await connectionManager.closeConnection();
  }
}
