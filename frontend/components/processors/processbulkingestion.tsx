import * as moment from 'moment';
import { buildBulkUpsertQuery, createError } from '@/config/utils';
import { StemResult, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { CMAttributesResult, CoreMeasurementsResult, FailedMeasurementsResult } from '@/config/sqlrdsdefinitions/core';
import { SpecialBulkProcessingProps } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export interface TemporaryMeasurement {
  id: number;
  FileID: string;
  BatchID: string;
  PlotID: number;
  CensusID: number;
  TreeTag: string;
  StemTag?: string;
  SpeciesCode: string;
  QuadratName: string;
  LocalX?: number;
  LocalY?: number;
  DBH?: number;
  HOM?: number;
  MeasurementDate: Date;
  Codes?: string;
  Comments?: string;
}

export interface FilteredMeasurement extends TemporaryMeasurement {
  Valid: boolean;
  invalid_count: number;
}

export interface TreeStemState {
  TreeTag: string;
  StemTag: string;
  QuadratName: string;
  LocalX?: number;
  LocalY?: number;
  CensusID: number;
  SpeciesCode: string;
  MeasurementDate: Date;
  DBH?: number;
  HOM?: number;
  Comments?: string;
  Codes?: string;
  state: 'old tree' | 'multi stem' | 'new recruit';
}

/**
 * Client-side implementation of the bulkingestioncollapser stored procedure
 * Handles orphaned trees and cleans up measurements
 */
export async function processBulkIngestionCollapser(connectionManager: ConnectionManager, schema: string, censusID: number): Promise<void> {
  try {
    // Handle orphaned trees rows - version them per specifications
    const orphanedTreesQuery = `
      SELECT t.TreeID 
      FROM ${schema}.trees t 
      WHERE t.CensusID IS NULL
    `;

    const orphanedTrees = await connectionManager.executeQuery(orphanedTreesQuery);

    if (orphanedTrees.length > 0) {
      const treeIDs = orphanedTrees.map((tree: any) => tree.TreeID);
      const updateOrphanedQuery = `
        UPDATE ${schema}.trees 
        SET CensusID = ? 
        WHERE TreeID IN (${treeIDs.map(() => '?').join(',')})
      `;
      await connectionManager.executeQuery(updateOrphanedQuery, [censusID, ...treeIDs]);
    }

    // Clean up measurements - set 0 values to null
    await connectionManager.executeQuery(`UPDATE ${schema}.coremeasurements SET MeasuredDBH = NULL WHERE MeasuredDBH = 0`);
    await connectionManager.executeQuery(`UPDATE ${schema}.coremeasurements SET MeasuredHOM = NULL WHERE MeasuredHOM = 0`);
  } catch (error: any) {
    throw createError(`Bulk ingestion collapser failed: ${error.message}`, error);
  }
}

/**
 * Client-side implementation of the bulkingestionprocess stored procedure
 * CORRECTED VERSION - matches stored procedure logic exactly
 */
export async function processBulkIngestionProcessor(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  temporaryMeasurements: TemporaryMeasurement[]
): Promise<void> {
  try {
    if (temporaryMeasurements.length === 0) {
      console.log('No temporary measurements provided for processing');
      return;
    }

    const currentCensusID = temporaryMeasurements[0].CensusID;

    // Step 1: Initial duplicate filter - remove exact duplicates
    const uniqueMeasurements = temporaryMeasurements.filter(
      (measurement, index, array) =>
        index ===
        array.findIndex(
          m =>
            m.TreeTag === measurement.TreeTag &&
            m.StemTag === measurement.StemTag &&
            m.SpeciesCode === measurement.SpeciesCode &&
            m.QuadratName === measurement.QuadratName
        )
    );

    // Step 2: Create filter_validity table (replicating stored procedure logic)
    const filteredMeasurements: FilteredMeasurement[] = [];
    const validMeasurements: FilteredMeasurement[] = [];
    const failedMeasurements: FailedMeasurementsResult[] = [];

    for (const measurement of uniqueMeasurements) {
      // Validate quadrat and species joins
      const hasValidQuadrat = await validateQuadrat(connectionManager, schema, measurement.QuadratName);
      const hasValidSpecies = await validateSpecies(connectionManager, schema, measurement.SpeciesCode);

      // Skip if basic validation fails
      if (!measurement.TreeTag || !hasValidQuadrat || !hasValidSpecies || !measurement.MeasurementDate) {
        // Add to failed measurements (Condition 2 from stored procedure)
        failedMeasurements.push({
          PlotID: measurement.PlotID,
          CensusID: measurement.CensusID,
          Tag: measurement.TreeTag || '',
          StemTag: measurement.StemTag || '',
          SpCode: measurement.SpeciesCode,
          Quadrat: measurement.QuadratName,
          X: measurement.LocalX || -1,
          Y: measurement.LocalY || -1,
          DBH: measurement.DBH || -1,
          HOM: measurement.HOM || -1,
          Date: measurement.MeasurementDate,
          Codes: measurement.Codes || '',
          Description: measurement.Comments || ''
        });
        continue;
      }

      // Validate attribute codes
      let invalidCodeCount = 0;
      if (measurement.Codes && measurement.Codes.trim()) {
        const codes = measurement.Codes.split(';')
          .map(c => c.trim())
          .filter(Boolean);
        invalidCodeCount = await validateAttributeCodes(connectionManager, schema, codes);
      }

      // CORRECTED validation logic from stored procedure:
      // Valid = false ONLY if ((DBH=0 OR HOM=0) AND no codes)
      const dbh = measurement.DBH || 0;
      const hom = measurement.HOM || 0;
      const codes = measurement.Codes?.trim() || '';
      const isValid = !((dbh === 0 || hom === 0) && codes === '');

      const filteredMeasurement: FilteredMeasurement = {
        ...measurement,
        StemTag: measurement.StemTag || '',
        LocalX: measurement.LocalX || 0,
        LocalY: measurement.LocalY || 0,
        DBH: dbh,
        HOM: hom,
        Valid: isValid,
        invalid_count: invalidCodeCount
      };

      filteredMeasurements.push(filteredMeasurement);

      // Only add to valid if passes all validation
      if (isValid && invalidCodeCount === 0) {
        validMeasurements.push(filteredMeasurement);
      } else {
        // Add to failed measurements (Condition 1 from stored procedure)
        failedMeasurements.push({
          PlotID: measurement.PlotID,
          CensusID: measurement.CensusID,
          Tag: measurement.TreeTag,
          StemTag: measurement.StemTag || '',
          SpCode: measurement.SpeciesCode,
          Quadrat: measurement.QuadratName,
          X: measurement.LocalX || 0,
          Y: measurement.LocalY || 0,
          DBH: dbh,
          HOM: hom,
          Date: measurement.MeasurementDate,
          Codes: measurement.Codes || '',
          Description: measurement.Comments || ''
        });
      }
    }

    // Insert failed measurements if any
    if (failedMeasurements.length > 0) {
      await insertFailedMeasurements(connectionManager, schema, failedMeasurements);
    }

    if (validMeasurements.length === 0) {
      return; // No valid measurements to process
    }

    // Step 3: Categorize measurements CORRECTLY using stored procedure logic
    const treeStates = await categorizeMeasurements(connectionManager, schema, validMeasurements, currentCensusID);

    // Step 4: Process trees, stems, core measurements, and attributes
    await processTreeInsertions(connectionManager, schema, treeStates, currentCensusID);
    await processStemInsertions(connectionManager, schema, treeStates, currentCensusID);
    await processCoreMeasurementInsertions(connectionManager, schema, treeStates, currentCensusID);
    await processCMAttributeInsertions(connectionManager, schema, treeStates);
  } catch (error: any) {
    throw createError(`Bulk ingestion processor failed: ${error.message}`, error);
  }
}

/**
 * Main export function that combines both procedures
 */
export async function processBulkIngestion(props: Readonly<SpecialBulkProcessingProps>): Promise<void> {
  const { connectionManager, rowDataSet, schema, plot, census } = props;

  if (!plot || !census || !census.dateRanges?.length) {
    throw new Error('Process Bulk Ingestion: Missing plotID, censusID, or census date ranges');
  }

  const currentCensusID = census.dateRanges[0].censusID;
  const fileID = `bulk-${Date.now()}`;
  const batchID = `batch-${Date.now()}`;

  // Convert FileRowSet to TemporaryMeasurement format
  const temporaryMeasurements: TemporaryMeasurement[] = Object.values(rowDataSet).map((row: any, index) => ({
    id: index + 1,
    FileID: fileID,
    BatchID: batchID,
    PlotID: plot.plotID || 0,
    CensusID: currentCensusID,
    TreeTag: row.tag || '',
    StemTag: row.stemtag || '',
    SpeciesCode: row.spcode || '',
    QuadratName: row.quadrat || '',
    LocalX: row.lx ? parseFloat(row.lx) : undefined,
    LocalY: row.ly ? parseFloat(row.ly) : undefined,
    DBH: row.dbh ? parseFloat(row.dbh) : undefined,
    HOM: row.hom ? parseFloat(row.hom) : undefined,
    MeasurementDate: row.date && moment.utc(row.date).isValid() ? moment.utc(row.date).toDate() : new Date(),
    Codes: row.codes || '',
    Comments: row.comments || ''
  }));

  try {
    // Set current census for any triggers
    await connectionManager.executeQuery('SET @CURRENT_CENSUS_ID = ?', [currentCensusID]);

    // Process measurements
    await processBulkIngestionProcessor(connectionManager, schema, fileID, batchID, temporaryMeasurements);

    // Clean up and collapse
    await processBulkIngestionCollapser(connectionManager, schema, currentCensusID);
  } catch (error: any) {
    throw createError(`Bulk ingestion failed: ${error.message}`, error);
  }
}

// Helper functions

async function validateQuadrat(connectionManager: ConnectionManager, schema: string, quadratName: string): Promise<boolean> {
  const result = await connectionManager.executeQuery(`SELECT COUNT(*) as count FROM ${schema}.quadrats WHERE QuadratName = ?`, [quadratName]);
  return result[0].count > 0;
}

async function validateSpecies(connectionManager: ConnectionManager, schema: string, speciesCode: string): Promise<boolean> {
  const result = await connectionManager.executeQuery(`SELECT COUNT(*) as count FROM ${schema}.species WHERE SpeciesCode = ?`, [speciesCode]);
  return result[0].count > 0;
}

async function validateAttributeCodes(connectionManager: ConnectionManager, schema: string, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;

  const placeholders = codes.map(() => '?').join(',');
  const result = await connectionManager.executeQuery(
    `SELECT COUNT(*) as invalid FROM (${codes.map(() => 'SELECT ? as code').join(' UNION ')}) temp 
     LEFT JOIN ${schema}.attributes a ON a.Code = temp.code
     WHERE a.Code IS NULL`,
    codes
  );

  return result[0].invalid || 0;
}

async function insertFailedMeasurements(connectionManager: ConnectionManager, schema: string, failedMeasurements: FailedMeasurementsResult[]): Promise<void> {
  const { sql, params } = buildBulkUpsertQuery(schema, 'failedmeasurements', failedMeasurements, 'FailedMeasurementID');
  await connectionManager.executeQuery(sql, params);
}

/**
 * CORRECTED categorization - matches stored procedure logic exactly
 */
async function categorizeMeasurements(
  connectionManager: ConnectionManager,
  schema: string,
  measurements: FilteredMeasurement[],
  currentCensusID: number
): Promise<TreeStemState[]> {
  const treeStates: TreeStemState[] = [];

  for (const measurement of measurements) {
    // CORRECTED: old_trees logic - tree exists AND stem with SAME tag exists in SAME census
    const oldTreeQuery = `
      SELECT 1 
      FROM ${schema}.trees t 
      JOIN ${schema}.stems s ON s.StemTag = ? AND s.CensusID < ? AND t.CensusID = s.CensusID
      WHERE t.TreeTag = ? AND t.CensusID < ?
    `;
    const isOldTree = await connectionManager.executeQuery(oldTreeQuery, [measurement.StemTag, currentCensusID, measurement.TreeTag, currentCensusID]);

    // CORRECTED: multi_stems logic - tree exists but stem with DIFFERENT tag exists
    const multiStemQuery = `
      SELECT 1 
      FROM ${schema}.trees t 
      JOIN ${schema}.stems s ON s.StemTag <> ? AND s.CensusID < ? AND t.CensusID = s.CensusID
      WHERE t.TreeTag = ? AND t.CensusID < ?
    `;
    const isMultiStem = await connectionManager.executeQuery(multiStemQuery, [measurement.StemTag, currentCensusID, measurement.TreeTag, currentCensusID]);

    let state: 'old tree' | 'multi stem' | 'new recruit';

    if (isOldTree.length > 0) {
      state = 'old tree';
    } else if (isMultiStem.length > 0) {
      state = 'multi stem';
    } else {
      state = 'new recruit';
    }

    treeStates.push({
      TreeTag: measurement.TreeTag,
      StemTag: measurement.StemTag || '',
      QuadratName: measurement.QuadratName,
      LocalX: measurement.LocalX,
      LocalY: measurement.LocalY,
      CensusID: currentCensusID,
      SpeciesCode: measurement.SpeciesCode,
      MeasurementDate: measurement.MeasurementDate,
      DBH: measurement.DBH,
      HOM: measurement.HOM,
      Comments: measurement.Comments,
      Codes: measurement.Codes,
      state
    });
  }

  return treeStates;
}

async function processTreeInsertions(
  connectionManager: ConnectionManager,
  schema: string,
  treeStates: TreeStemState[],
  currentCensusID: number
): Promise<void> {
  // Get species IDs for all species codes
  const speciesCodes = Array.from(new Set(treeStates.map(ts => ts.SpeciesCode)));
  const speciesQuery = `
    SELECT SpeciesCode, SpeciesID 
    FROM ${schema}.species 
    WHERE SpeciesCode IN (${speciesCodes.map(() => '?').join(',')})
  `;
  const speciesResults = await connectionManager.executeQuery(speciesQuery, speciesCodes);
  const speciesMap = new Map(speciesResults.map((s: any) => [s.SpeciesCode, s.SpeciesID]));

  // Prepare tree data for bulk insertion
  const treeData: Partial<TreeResult>[] = treeStates.map(ts => ({
    TreeTag: ts.TreeTag,
    SpeciesID: speciesMap.get(ts.SpeciesCode),
    CensusID: currentCensusID
  }));

  // Remove duplicates
  const uniqueTreeData = treeData.filter((tree, index, array) => index === array.findIndex(t => t.TreeTag === tree.TreeTag && t.SpeciesID === tree.SpeciesID));

  if (uniqueTreeData.length > 0) {
    const { sql, params } = buildBulkUpsertQuery(schema, 'trees', uniqueTreeData, 'TreeID');
    await connectionManager.executeQuery(sql, params);
  }
}

async function processStemInsertions(
  connectionManager: ConnectionManager,
  schema: string,
  treeStates: TreeStemState[],
  currentCensusID: number
): Promise<void> {
  // Get tree IDs and quadrat IDs
  const treeQuery = `
    SELECT TreeTag, TreeID 
    FROM ${schema}.trees 
    WHERE CensusID = ?
  `;
  const treeResults = await connectionManager.executeQuery(treeQuery, [currentCensusID]);
  const treeMap = new Map(treeResults.map((t: any) => [t.TreeTag, t.TreeID]));

  const quadratNames = Array.from(new Set(treeStates.map(ts => ts.QuadratName)));
  const quadratQuery = `
    SELECT QuadratName, QuadratID 
    FROM ${schema}.quadrats 
    WHERE QuadratName IN (${quadratNames.map(() => '?').join(',')})
  `;
  const quadratResults = await connectionManager.executeQuery(quadratQuery, quadratNames);
  const quadratMap = new Map(quadratResults.map((q: any) => [q.QuadratName, q.QuadratID]));

  // Prepare stem data - CORRECTED to include IsActive
  const stemData: Partial<StemResult>[] = treeStates.map(ts => ({
    TreeID: treeMap.get(ts.TreeTag),
    QuadratID: quadratMap.get(ts.QuadratName),
    CensusID: currentCensusID,
    StemCrossID: -1,
    StemTag: ts.StemTag || '',
    LocalX: ts.LocalX || -1,
    LocalY: ts.LocalY || -1,
    Moved: false,
    StemDescription: '',
    IsActive: true // ADDED: Missing IsActive field
  }));

  if (stemData.length > 0) {
    const { sql, params } = buildBulkUpsertQuery(schema, 'stems', stemData, 'StemGUID');
    await connectionManager.executeQuery(sql, params);

    // Clean up null values
    await connectionManager.executeQuery(
      `
      UPDATE ${schema}.stems 
      SET StemTag = NULLIF(StemTag, ' '),
          LocalX = NULLIF(LocalX, -1),
          LocalY = NULLIF(LocalY, -1),
          StemDescription = NULLIF(StemDescription, ' ')
      WHERE CensusID = ?
    `,
      [currentCensusID]
    );
  }
}

async function processCoreMeasurementInsertions(
  connectionManager: ConnectionManager,
  schema: string,
  treeStates: TreeStemState[],
  currentCensusID: number
): Promise<void> {
  // Get stem IDs
  const stemQuery = `
    SELECT s.StemGUID, s.StemTag, t.TreeTag, q.QuadratName
    FROM ${schema}.stems s
    JOIN ${schema}.trees t ON s.TreeID = t.TreeID
    JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
    WHERE s.CensusID = ?
  `;
  const stemResults = await connectionManager.executeQuery(stemQuery, [currentCensusID]);
  const stemMap = new Map(stemResults.map((s: any) => [`${s.TreeTag}-${s.StemTag}-${s.QuadratName}`, s.StemGUID]));

  // Prepare core measurement data - CORRECTED to match stored procedure format
  const cmData: Partial<CoreMeasurementsResult>[] = treeStates.map(ts => {
    const stemKey = `${ts.TreeTag}-${ts.StemTag}-${ts.QuadratName}`;
    return {
      CensusID: currentCensusID,
      StemGUID: stemMap.get(stemKey),
      IsValidated: null,
      MeasurementDate: moment.utc(ts.MeasurementDate).format('YYYY-MM-DD'),
      MeasuredDBH: ts.DBH || -1,
      MeasuredHOM: ts.HOM || -1,
      Description: ts.Comments || ' ',
      UserDefinedFields: JSON.stringify({ treestemstate: ts.state }), // CORRECTED: matches stored procedure format
      IsActive: true // ADDED: Missing IsActive field
    };
  });

  if (cmData.length > 0) {
    const { sql, params } = buildBulkUpsertQuery(schema, 'coremeasurements', cmData, 'CoreMeasurementID');
    await connectionManager.executeQuery(sql, params);

    // Clean up null values
    await connectionManager.executeQuery(
      `
      UPDATE ${schema}.coremeasurements 
      SET MeasurementDate = NULLIF(MeasurementDate, '1900-01-01'),
          MeasuredDBH = NULLIF(MeasuredDBH, -1),
          MeasuredHOM = NULLIF(MeasuredHOM, -1),
          Description = NULLIF(Description, ' ')
      WHERE CensusID = ?
    `,
      [currentCensusID]
    );
  }
}

async function processCMAttributeInsertions(connectionManager: ConnectionManager, schema: string, treeStates: TreeStemState[]): Promise<void> {
  // Get core measurement IDs
  const cmQuery = `
    SELECT cm.CoreMeasurementID, s.StemTag, t.TreeTag, q.QuadratName, cm.MeasurementDate, cm.MeasuredDBH, cm.MeasuredHOM
    FROM ${schema}.coremeasurements cm
    JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
    JOIN ${schema}.trees t ON s.TreeID = t.TreeID
    JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
    WHERE cm.CensusID = ?
  `;
  const cmResults = await connectionManager.executeQuery(cmQuery, [treeStates[0].CensusID]);

  // Prepare attributes data
  const attributeData: Partial<CMAttributesResult>[] = [];

  for (const ts of treeStates) {
    if (!ts.Codes?.trim()) continue;

    const codes = ts.Codes.split(';')
      .map((c: string) => c.trim())
      .filter(Boolean);
    const matchingCM = cmResults.find((cm: any) => cm.TreeTag === ts.TreeTag && cm.StemTag === ts.StemTag && cm.QuadratName === ts.QuadratName);

    if (matchingCM) {
      for (const code of codes) {
        attributeData.push({
          CoreMeasurementID: matchingCM.CoreMeasurementID,
          Code: code
        });
      }
    }
  }

  if (attributeData.length > 0) {
    const { sql, params } = buildBulkUpsertQuery(schema, 'cmattributes', attributeData, 'CMAID');
    await connectionManager.executeQuery(sql, params);
  }
}
