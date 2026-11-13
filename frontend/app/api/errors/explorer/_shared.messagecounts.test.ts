import { describe, expect, it } from 'vitest';
import { buildErrorExplorerFacets, buildErrorMessageCounts } from './_shared';
import { DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';
import { ErrorTypeCatalogMismatchError } from './errorsetcounts';
import {
  CENSUS_LIST_SIZE,
  ERROR_EXPLORER_STATEMENT_LABELS,
  LIST_SEPARATOR,
  NO_LOG_ERROR_MESSAGE,
  NO_LOG_ERROR_TYPE_KEY,
  readStatementLabel,
  SQL_FALSE,
  SQL_TRUE,
  type ErrorSignatureRow,
  type ErrorTypeCatalogRow
} from './errorsetsql';
import { buildActiveMeasurementCountQuery } from '../../../../tests/oracles/errors-explorer-legacy-activecount';

const SCHEMA = 'forestgeo_testsite';
const PLOT_ID = 1;
const FIRST_CENSUS_ID = 11;
const SECOND_CENSUS_ID = 12;
const FIRST_CENSUS_PARAM_INDEX = 1;
const SHRINKAGE_MESSAGE = 'DBH shrank between censuses';
const MISSING_SPECIES_MESSAGE = 'Species code is not in the species list';
const SHRINKAGE_ERROR_ID = 1;
const MISSING_SPECIES_ERROR_ID = 2;
const MORE_CENSUSES_THAN_ONE_CHUNK = CENSUS_LIST_SIZE + 1;
const CHUNKS_FOR_MORE_CENSUSES_THAN_ONE_CHUNK = 2;
const UNUSED_CENSUS_ID_BASE = 100;
const ACTIVE_MEASUREMENTS = 77;
const ACTIVE_COUNT_LABEL = 'active-count';
const ACTIVE_COUNT_SQL_MARKER = 'SELECT COUNT(*) AS n';

const CATALOG_ROWS: ErrorTypeCatalogRow[] = [
  { ErrorID: SHRINKAGE_ERROR_ID, ErrorSource: 'ingestion', ErrorCode: 'S1', DisplayMessage: SHRINKAGE_MESSAGE, ValidationCriteria: '', ProcedureName: '' },
  {
    ErrorID: MISSING_SPECIES_ERROR_ID,
    ErrorSource: 'ingestion',
    ErrorCode: 'S2',
    DisplayMessage: MISSING_SPECIES_MESSAGE,
    ValidationCriteria: '',
    ProcedureName: ''
  }
];

interface FakeMeasurement {
  censusID: number;
  errorTypeKeys: number[];
  hasDuplicate: boolean;
  hasSameBatch: boolean;
  isFailedRow: boolean;
}

// Positions 1 and 2 share a tree tag and stem tag; positions 4 and 5 were uploaded in one batch under one tree tag with different species;
// position 3 is invalid without a log row; position 5 failed ingestion (its core stem is NULL).
const MEASUREMENTS: FakeMeasurement[] = [
  { censusID: FIRST_CENSUS_ID, errorTypeKeys: [SHRINKAGE_ERROR_ID, MISSING_SPECIES_ERROR_ID], hasDuplicate: true, hasSameBatch: false, isFailedRow: false },
  { censusID: FIRST_CENSUS_ID, errorTypeKeys: [SHRINKAGE_ERROR_ID], hasDuplicate: true, hasSameBatch: false, isFailedRow: false },
  { censusID: FIRST_CENSUS_ID, errorTypeKeys: [NO_LOG_ERROR_TYPE_KEY], hasDuplicate: false, hasSameBatch: false, isFailedRow: false },
  { censusID: SECOND_CENSUS_ID, errorTypeKeys: [SHRINKAGE_ERROR_ID], hasDuplicate: false, hasSameBatch: true, isFailedRow: false },
  { censusID: SECOND_CENSUS_ID, errorTypeKeys: [MISSING_SPECIES_ERROR_ID], hasDuplicate: false, hasSameBatch: true, isFailedRow: true }
];

function censusIDsOf(params: unknown[]): number[] {
  return params.slice(FIRST_CENSUS_PARAM_INDEX, FIRST_CENSUS_PARAM_INDEX + CENSUS_LIST_SIZE).filter((id): id is number => id !== null);
}

function histogramRows(censusIDs: number[], withFlags: boolean): ErrorSignatureRow[] {
  const countsBySignature = new Map<string, ErrorSignatureRow>();
  MEASUREMENTS.filter(measurement => censusIDs.includes(measurement.censusID)).forEach(measurement => {
    const hasDuplicate = withFlags && measurement.hasDuplicate;
    const hasSameBatch = withFlags && measurement.hasSameBatch;
    const isFailedRow = withFlags && measurement.isFailedRow;
    const errorTypeKeys = measurement.errorTypeKeys.join(LIST_SEPARATOR);
    const signature = [errorTypeKeys, hasDuplicate, hasSameBatch, isFailedRow].join('|');
    const existing = countsBySignature.get(signature);
    countsBySignature.set(signature, {
      ErrorTypeKeys: errorTypeKeys,
      SignatureComplete: SQL_TRUE,
      HasDuplicate: hasDuplicate ? SQL_TRUE : SQL_FALSE,
      HasSameBatch: hasSameBatch ? SQL_TRUE : SQL_FALSE,
      IsFailedRow: isFailedRow ? SQL_TRUE : SQL_FALSE,
      MeasurementCount: Number(existing?.MeasurementCount ?? 0) + 1
    });
  });
  return Array.from(countsBySignature.values());
}

const CATALOG_WITHOUT_MISSING_SPECIES: ErrorTypeCatalogRow[] = CATALOG_ROWS.filter(row => row.ErrorID !== MISSING_SPECIES_ERROR_ID);

/** The nth catalog statement is answered with catalogAnswers[n]; the last answer repeats for any later call. The active count has no label, so it is recorded under ACTIVE_COUNT_LABEL. */
function labelAnsweringConnection(catalogAnswers: ErrorTypeCatalogRow[][] = [CATALOG_ROWS]) {
  const executedLabels: Array<string | null> = [];
  const executedStatements: Array<{ sql: string; params: unknown[] }> = [];
  let catalogCalls = 0;
  const connection = {
    executeQuery: async (sql: string, params: unknown[]) => {
      const label = readStatementLabel(sql);
      const isActiveCount = label === null && sql.includes(ACTIVE_COUNT_SQL_MARKER);
      executedLabels.push(isActiveCount ? ACTIVE_COUNT_LABEL : label);
      executedStatements.push({ sql, params });
      if (isActiveCount) return [{ n: ACTIVE_MEASUREMENTS }];
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.catalog) return catalogAnswers[Math.min(catalogCalls++, catalogAnswers.length - 1)];
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags) return histogramRows(censusIDsOf(params), true);
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags) return histogramRows(censusIDsOf(params), false);
      throw new Error(`Unexpected statement in test (label ${label}): ${sql.slice(0, 80)}`);
    }
  };
  return { connection: connection as never, executedLabels, executedStatements };
}

describe('buildErrorMessageCounts', () => {
  it('runs one catalog statement and one histogram statement for two censuses, and no group or raw-row statement', async () => {
    const { connection, executedLabels } = labelAnsweringConnection();

    await buildErrorMessageCounts(connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID] });

    console.log('[message counts] executed statement labels:', executedLabels);
    expect([...executedLabels].sort()).toEqual([ERROR_EXPLORER_STATEMENT_LABELS.catalog, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags].sort());
  });

  it('runs one catalog statement and one histogram statement per chunk of censuses', async () => {
    const { connection, executedLabels } = labelAnsweringConnection();
    const unusedCensusIDs = Array.from({ length: MORE_CENSUSES_THAN_ONE_CHUNK - 2 }, (_, index) => UNUSED_CENSUS_ID_BASE + index);

    const counts = await buildErrorMessageCounts(connection, {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID, ...unusedCensusIDs]
    });

    console.log(`[message counts] ${MORE_CENSUSES_THAN_ONE_CHUNK} censuses executed statement labels:`, executedLabels);
    expect(executedLabels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.catalog)).toHaveLength(1);
    expect(executedLabels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags)).toHaveLength(
      CHUNKS_FOR_MORE_CENSUSES_THAN_ONE_CHUNK
    );
    expect(executedLabels, 'nothing else runs').toHaveLength(1 + CHUNKS_FOR_MORE_CENSUSES_THAN_ONE_CHUNK);
    expect(counts.totalMeasurements, 'the chunks add up').toBe(MEASUREMENTS.length);
  });

  it("matches the facets builder's affected-measurement total even when contradictions and a failed row are present", async () => {
    const censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
    const facets = await buildErrorExplorerFacets(labelAnsweringConnection().connection, {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusID: FIRST_CENSUS_ID,
      censusIDs,
      filters: DEFAULT_ERROR_EXPLORER_FILTERS
    });
    const counts = await buildErrorMessageCounts(labelAnsweringConnection().connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs });

    console.log('[message counts] facets', JSON.stringify({ censusTotals: facets.censusTotals, errorTypes: facets.errorTypes }));
    console.log('[message counts] counts', JSON.stringify(counts));
    expect(facets.censusTotals.duplicateTagStem, 'the fixture must actually contain a duplicate-tag contradiction').toBeGreaterThan(0);
    expect(facets.censusTotals.sameBatchConflict, 'the fixture must actually contain a same-batch contradiction').toBeGreaterThan(0);
    expect(facets.censusTotals.failedMeasurements, 'the fixture must actually contain a failed row').toBeGreaterThan(0);
    expect(counts.totalMeasurements).toBe(facets.censusTotals.affectedMeasurements);
  });

  it('counts each measurement once per message and sorts by count then message', async () => {
    const { connection } = labelAnsweringConnection();

    const counts = await buildErrorMessageCounts(connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID] });

    expect(counts.totalMeasurements, 'the first measurement has two errors but is one measurement').toBe(5);
    expect(counts.messages).toEqual([
      { value: SHRINKAGE_MESSAGE, count: 3 },
      { value: MISSING_SPECIES_MESSAGE, count: 2 },
      { value: NO_LOG_ERROR_MESSAGE, count: 1 }
    ]);
  });

  it('returns nothing for an empty census list instead of querying', async () => {
    const { connection, executedLabels } = labelAnsweringConnection();

    const counts = await buildErrorMessageCounts(connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [] });

    expect(counts).toEqual({ totalMeasurements: 0, messages: [] });
    expect(executedLabels).toHaveLength(0);
  });
});

describe('buildErrorExplorerFacets on the SQL path', () => {
  const censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
  const facetsRequest = { schema: SCHEMA, plotID: PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs, filters: DEFAULT_ERROR_EXPLORER_FILTERS };

  it('runs one catalog statement, one with-flags histogram statement and one active count, and no group or raw-row statement', async () => {
    const { connection, executedLabels } = labelAnsweringConnection();

    await buildErrorExplorerFacets(connection, facetsRequest);

    console.log('[facets] executed statement labels:', executedLabels);
    expect([...executedLabels].sort()).toEqual(
      [ERROR_EXPLORER_STATEMENT_LABELS.catalog, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags, ACTIVE_COUNT_LABEL].sort()
    );
  });

  it("runs dev's active-count statement, unchanged, over every census ID", async () => {
    const { connection, executedStatements } = labelAnsweringConnection();

    await buildErrorExplorerFacets(connection, facetsRequest);

    const expected = buildActiveMeasurementCountQuery(SCHEMA, PLOT_ID, censusIDs);
    const activeCountStatements = executedStatements.filter(statement => statement.sql.includes(ACTIVE_COUNT_SQL_MARKER));
    console.log('[facets] active count statements:', JSON.stringify(activeCountStatements));
    expect(activeCountStatements).toEqual([{ sql: expected.sql, params: expected.params }]);
  });

  it('runs one catalog statement and one active count, and one histogram statement per chunk of censuses', async () => {
    const { connection, executedLabels } = labelAnsweringConnection();
    const unusedCensusIDs = Array.from({ length: MORE_CENSUSES_THAN_ONE_CHUNK - 2 }, (_, index) => UNUSED_CENSUS_ID_BASE + index);

    const facets = await buildErrorExplorerFacets(connection, { ...facetsRequest, censusIDs: [...censusIDs, ...unusedCensusIDs] });

    console.log(`[facets] ${MORE_CENSUSES_THAN_ONE_CHUNK} censuses executed statement labels:`, executedLabels);
    expect(executedLabels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.catalog)).toHaveLength(1);
    expect(executedLabels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags)).toHaveLength(CHUNKS_FOR_MORE_CENSUSES_THAN_ONE_CHUNK);
    expect(executedLabels.filter(label => label === ACTIVE_COUNT_LABEL)).toHaveLength(1);
    expect(executedLabels, 'nothing else runs').toHaveLength(2 + CHUNKS_FOR_MORE_CENSUSES_THAN_ONE_CHUNK);
    expect(facets.censusTotals.affectedMeasurements, 'the chunks add up').toBe(MEASUREMENTS.length);
  });

  it('returns the error types ordered by count then message and the census totals, from the histogram rows', async () => {
    const { connection } = labelAnsweringConnection();

    const facets = await buildErrorExplorerFacets(connection, facetsRequest);

    console.log('[facets] response', JSON.stringify(facets));
    expect(facets.errorTypes).toEqual([
      { source: 'ingestion', code: 'S1', message: SHRINKAGE_MESSAGE, fields: [], count: 3, hasContradiction: true },
      { source: 'ingestion', code: 'S2', message: MISSING_SPECIES_MESSAGE, fields: [], count: 2, hasContradiction: true },
      { source: 'ingestion', code: 'failed_no_log', message: NO_LOG_ERROR_MESSAGE, fields: [], count: 1, hasContradiction: false }
    ]);
    expect(facets.censusTotals).toEqual({
      affectedMeasurements: 5,
      activeMeasurements: ACTIVE_MEASUREMENTS,
      errorTypeCount: 3,
      validation: 0,
      ingestion: 5,
      failedMeasurements: 1,
      contradictions: 4,
      duplicateTagStem: 2,
      sameBatchConflict: 2
    });
  });

  it('returns empty facets and runs no statement for an empty census list', async () => {
    const { connection, executedLabels } = labelAnsweringConnection();

    const facets = await buildErrorExplorerFacets(connection, { ...facetsRequest, censusID: 0, censusIDs: [] });

    expect(facets.errorTypes).toEqual([]);
    expect(facets.censusTotals.affectedMeasurements).toBe(0);
    expect(facets.censusTotals.activeMeasurements).toBe(0);
    expect(executedLabels).toHaveLength(0);
  });
});

describe('when the histogram names an error type the first catalog read lacks', () => {
  const censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
  const countCatalogStatements = (labels: Array<string | null>) => labels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.catalog).length;
  const countsRequest = { schema: SCHEMA, plotID: PLOT_ID, censusIDs };
  const facetsRequest = { schema: SCHEMA, plotID: PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs, filters: DEFAULT_ERROR_EXPLORER_FILTERS };
  const labelsOtherThanCatalogHistogramAndActiveCount = (labels: Array<string | null>) =>
    labels.filter(
      label =>
        label !== ERROR_EXPLORER_STATEMENT_LABELS.catalog &&
        label !== ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags &&
        label !== ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags &&
        label !== ACTIVE_COUNT_LABEL
    );

  it('message counts re-read the catalog once and return the full-catalog result', async () => {
    const expected = await buildErrorMessageCounts(labelAnsweringConnection().connection, countsRequest);
    const { connection, executedLabels } = labelAnsweringConnection([CATALOG_WITHOUT_MISSING_SPECIES, CATALOG_ROWS]);

    const counts = await buildErrorMessageCounts(connection, countsRequest);

    console.log('[catalog re-read] message counts labels:', executedLabels, 'counts:', JSON.stringify(counts));
    expect(countCatalogStatements(executedLabels), 'the catalog is read, then read again').toBe(2);
    expect(
      counts.messages.map(option => option.value),
      'the type the first read lacked is named'
    ).toContain(MISSING_SPECIES_MESSAGE);
    expect(counts).toEqual(expected);
  });

  it('facets re-read the catalog once and return the full-catalog result', async () => {
    const expected = await buildErrorExplorerFacets(labelAnsweringConnection().connection, facetsRequest);
    const { connection, executedLabels } = labelAnsweringConnection([CATALOG_WITHOUT_MISSING_SPECIES, CATALOG_ROWS]);

    const facets = await buildErrorExplorerFacets(connection, facetsRequest);

    console.log('[catalog re-read] facets labels:', executedLabels, 'errorTypes:', JSON.stringify(facets.errorTypes));
    expect(countCatalogStatements(executedLabels), 'the catalog is read, then read again').toBe(2);
    expect(
      facets.errorTypes.map(errorType => errorType.message),
      'the type the first read lacked is named'
    ).toContain(MISSING_SPECIES_MESSAGE);
    expect(facets).toEqual(expected);
  });

  it('message counts reject with ErrorTypeCatalogMismatchError when the type is still missing after the re-read, without a Node-path fallback', async () => {
    const { connection, executedLabels } = labelAnsweringConnection([CATALOG_WITHOUT_MISSING_SPECIES]);

    const outcome = await buildErrorMessageCounts(connection, countsRequest).then(
      () => null,
      (error: unknown) => error
    );

    console.log('[catalog mismatch] message counts labels:', executedLabels, 'error:', String(outcome));
    expect(outcome).toBeInstanceOf(ErrorTypeCatalogMismatchError);
    expect((outcome as ErrorTypeCatalogMismatchError).errorTypeKeys).toEqual([MISSING_SPECIES_ERROR_ID]);
    expect(countCatalogStatements(executedLabels), 'one re-read, no more').toBe(2);
    expect(labelsOtherThanCatalogHistogramAndActiveCount(executedLabels), 'no Node-path statement ran').toEqual([]);
  });

  it('facets reject with ErrorTypeCatalogMismatchError when the type is still missing after the re-read, without a Node-path fallback', async () => {
    const { connection, executedLabels } = labelAnsweringConnection([CATALOG_WITHOUT_MISSING_SPECIES]);

    const outcome = await buildErrorExplorerFacets(connection, facetsRequest).then(
      () => null,
      (error: unknown) => error
    );

    console.log('[catalog mismatch] facets labels:', executedLabels, 'error:', String(outcome));
    expect(outcome).toBeInstanceOf(ErrorTypeCatalogMismatchError);
    expect((outcome as ErrorTypeCatalogMismatchError).errorTypeKeys).toEqual([MISSING_SPECIES_ERROR_ID]);
    expect(countCatalogStatements(executedLabels), 'one re-read, no more').toBe(2);
    expect(labelsOtherThanCatalogHistogramAndActiveCount(executedLabels), 'no Node-path statement ran').toEqual([]);
  });
});
