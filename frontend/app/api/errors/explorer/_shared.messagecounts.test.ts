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
}

// Positions 1 and 2 share a tree tag and stem tag; positions 4 and 5 were uploaded in one batch under one tree tag with different species; position 3 is invalid without a log row.
const MEASUREMENTS: FakeMeasurement[] = [
  { censusID: FIRST_CENSUS_ID, errorTypeKeys: [SHRINKAGE_ERROR_ID, MISSING_SPECIES_ERROR_ID], hasDuplicate: true, hasSameBatch: false },
  { censusID: FIRST_CENSUS_ID, errorTypeKeys: [SHRINKAGE_ERROR_ID], hasDuplicate: true, hasSameBatch: false },
  { censusID: FIRST_CENSUS_ID, errorTypeKeys: [NO_LOG_ERROR_TYPE_KEY], hasDuplicate: false, hasSameBatch: false },
  { censusID: SECOND_CENSUS_ID, errorTypeKeys: [SHRINKAGE_ERROR_ID], hasDuplicate: false, hasSameBatch: true },
  { censusID: SECOND_CENSUS_ID, errorTypeKeys: [MISSING_SPECIES_ERROR_ID], hasDuplicate: false, hasSameBatch: true }
];

function censusIDsOf(params: unknown[]): number[] {
  return params.slice(FIRST_CENSUS_PARAM_INDEX, FIRST_CENSUS_PARAM_INDEX + CENSUS_LIST_SIZE).filter((id): id is number => id !== null);
}

function histogramRows(censusIDs: number[], withFlags: boolean): ErrorSignatureRow[] {
  const countsBySignature = new Map<string, ErrorSignatureRow>();
  MEASUREMENTS.filter(measurement => censusIDs.includes(measurement.censusID)).forEach(measurement => {
    const hasDuplicate = withFlags && measurement.hasDuplicate;
    const hasSameBatch = withFlags && measurement.hasSameBatch;
    const errorTypeKeys = measurement.errorTypeKeys.join(LIST_SEPARATOR);
    const signature = [errorTypeKeys, hasDuplicate, hasSameBatch].join('|');
    const existing = countsBySignature.get(signature);
    countsBySignature.set(signature, {
      ErrorTypeKeys: errorTypeKeys,
      SignatureComplete: SQL_TRUE,
      HasDuplicate: hasDuplicate ? SQL_TRUE : SQL_FALSE,
      HasSameBatch: hasSameBatch ? SQL_TRUE : SQL_FALSE,
      MeasurementCount: Number(existing?.MeasurementCount ?? 0) + 1
    });
  });
  return Array.from(countsBySignature.values());
}

const CATALOG_WITHOUT_MISSING_SPECIES: ErrorTypeCatalogRow[] = CATALOG_ROWS.filter(row => row.ErrorID !== MISSING_SPECIES_ERROR_ID);

/** The nth catalog statement is answered with catalogAnswers[n]; the last answer repeats for any later call. */
function labelAnsweringConnection(catalogAnswers: ErrorTypeCatalogRow[][] = [CATALOG_ROWS]) {
  const executedLabels: Array<string | null> = [];
  let catalogCalls = 0;
  const connection = {
    executeQuery: async (sql: string, params: unknown[]) => {
      const label = readStatementLabel(sql);
      executedLabels.push(label);
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.catalog) return catalogAnswers[Math.min(catalogCalls++, catalogAnswers.length - 1)];
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags) return histogramRows(censusIDsOf(params), true);
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags) return histogramRows(censusIDsOf(params), false);
      throw new Error(`Unexpected statement in test (label ${label}): ${sql.slice(0, 80)}`);
    }
  };
  return { connection: connection as never, executedLabels };
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

  it('returns the facets builder’s measurement total and message list even when contradictions are present', async () => {
    const censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
    const facetsConnection = labelAnsweringConnection();
    const countsConnection = labelAnsweringConnection();

    const facets = await buildErrorExplorerFacets(facetsConnection.connection, {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusID: FIRST_CENSUS_ID,
      censusIDs,
      filters: DEFAULT_ERROR_EXPLORER_FILTERS
    });
    const counts = await buildErrorMessageCounts(countsConnection.connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs });

    console.log(
      '[message counts] facets',
      JSON.stringify({ total: facets.totalMeasurements, messages: facets.messages, contradictions: facets.contradictionCounts })
    );
    console.log('[message counts] counts', JSON.stringify(counts));
    expect(facets.contradictionCounts.duplicateTagStem, 'the fixture must actually contain a duplicate-tag contradiction').toBeGreaterThan(0);
    expect(facets.contradictionCounts.sameBatchConflict, 'the fixture must actually contain a same-batch contradiction').toBeGreaterThan(0);
    expect(facetsConnection.executedLabels, 'facets read the catalog and the histogram with flags').toEqual([
      ERROR_EXPLORER_STATEMENT_LABELS.catalog,
      ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags
    ]);
    expect(counts.totalMeasurements).toBe(facets.totalMeasurements);
    expect(counts.messages).toEqual(facets.messages);
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

  describe('when the histogram names an error type the first catalog read lacks', () => {
    const censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
    const countCatalogStatements = (labels: Array<string | null>) => labels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.catalog).length;
    const countsRequest = { schema: SCHEMA, plotID: PLOT_ID, censusIDs };
    const facetsRequest = { schema: SCHEMA, plotID: PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs, filters: DEFAULT_ERROR_EXPLORER_FILTERS };
    const labelsOtherThanCatalogAndHistogram = (labels: Array<string | null>) =>
      labels.filter(
        label =>
          label !== ERROR_EXPLORER_STATEMENT_LABELS.catalog &&
          label !== ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags &&
          label !== ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags
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

      console.log('[catalog re-read] facets labels:', executedLabels, 'messages:', JSON.stringify(facets.messages));
      expect(countCatalogStatements(executedLabels), 'the catalog is read, then read again').toBe(2);
      expect(
        facets.messages.map(option => option.value),
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
      expect(labelsOtherThanCatalogAndHistogram(executedLabels), 'no Node-path statement ran').toEqual([]);
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
      expect(labelsOtherThanCatalogAndHistogram(executedLabels), 'no Node-path statement ran').toEqual([]);
    });
  });
});
