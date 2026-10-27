import { describe, expect, it } from 'vitest';
import { buildErrorExplorerFacets, buildErrorMessageCounts, type RawErrorOccurrenceRow } from './_shared';
import { DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';

const SCHEMA = 'forestgeo_testsite';
const PLOT_ID = 1;
const FIRST_CENSUS_ID = 11;
const SECOND_CENSUS_ID = 12;
const SECOND_PARAM_INDEX = 1;
const RAW_ERRORS_QUERY_MARKER = 'SELECT ms.CoreMeasurementID';
const DUPLICATE_GROUPS_QUERY_MARKER = 'GROUP_CONCAT(DISTINCT ms.CoreMeasurementID';
const SAME_BATCH_QUERY_MARKER = 'GROUP_CONCAT(DISTINCT cm.CoreMeasurementID';
const FALLBACK_INVALID_MESSAGE = 'Measurement is marked invalid but has no unresolved error log entry.';
const SHRINKAGE_MESSAGE = 'DBH shrank between censuses';
const MISSING_SPECIES_MESSAGE = 'Species code is not in the species list';

function occurrence(coreMeasurementID: number, censusID: number, message: string, errorCode: string): RawErrorOccurrenceRow {
  return {
    CoreMeasurementID: coreMeasurementID,
    PlotID: PLOT_ID,
    CensusID: censusID,
    CoreStemGUID: coreMeasurementID,
    TreeTag: `T${coreMeasurementID}`,
    StemTag: '1',
    ErrorSource: 'ingestion',
    ErrorCode: errorCode,
    DisplayMessage: message,
    ValidationCriteria: ''
  };
}

const RAW_ROWS_BY_CENSUS: Record<number, RawErrorOccurrenceRow[]> = {
  [FIRST_CENSUS_ID]: [
    occurrence(101, FIRST_CENSUS_ID, SHRINKAGE_MESSAGE, 'S1'),
    occurrence(101, FIRST_CENSUS_ID, MISSING_SPECIES_MESSAGE, 'S2'),
    occurrence(102, FIRST_CENSUS_ID, SHRINKAGE_MESSAGE, 'S1'),
    occurrence(103, FIRST_CENSUS_ID, FALLBACK_INVALID_MESSAGE, 'failed_no_log')
  ],
  [SECOND_CENSUS_ID]: [occurrence(201, SECOND_CENSUS_ID, SHRINKAGE_MESSAGE, 'S1'), occurrence(202, SECOND_CENSUS_ID, MISSING_SPECIES_MESSAGE, 'S2')]
};

// Measurements 101 and 102 share a tree tag and stem tag; 201 and 202 were uploaded in one batch under one tree tag with different species.
const DUPLICATE_GROUPS_BY_CENSUS: Record<number, Array<{ TreeTag: string; StemTag: string; MeasurementIDs: string }>> = {
  [FIRST_CENSUS_ID]: [{ TreeTag: 'T101', StemTag: '1', MeasurementIDs: '101,102' }],
  [SECOND_CENSUS_ID]: []
};
const SAME_BATCH_GROUPS_BY_CENSUS: Record<number, Array<{ UploadFileID: string; UploadBatchID: string; TreeTag: string; MeasurementIDs: string }>> = {
  [FIRST_CENSUS_ID]: [],
  [SECOND_CENSUS_ID]: [{ UploadFileID: 'file-1', UploadBatchID: 'batch-1', TreeTag: 'T201', MeasurementIDs: '201,202' }]
};

function recordingConnection() {
  const executedQueries: string[] = [];
  const connection = {
    executeQuery: async (sql: string, params: number[]) => {
      executedQueries.push(sql);
      const censusID = params[SECOND_PARAM_INDEX];
      if (sql.includes(DUPLICATE_GROUPS_QUERY_MARKER)) return DUPLICATE_GROUPS_BY_CENSUS[censusID];
      if (sql.includes(SAME_BATCH_QUERY_MARKER)) return SAME_BATCH_GROUPS_BY_CENSUS[censusID];
      if (sql.includes(RAW_ERRORS_QUERY_MARKER)) return RAW_ROWS_BY_CENSUS[censusID];
      throw new Error(`Unexpected query in test: ${sql.slice(0, 80)}`);
    }
  };
  return { connection: connection as never, executedQueries };
}

describe('buildErrorMessageCounts', () => {
  it('runs one raw-errors query per census and neither contradiction query', async () => {
    const { connection, executedQueries } = recordingConnection();

    await buildErrorMessageCounts(connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID] });

    console.log(
      `[message counts] executed ${executedQueries.length} queries:`,
      executedQueries.map(sql => sql.slice(0, 40))
    );
    expect(executedQueries).toHaveLength(2);
    expect(executedQueries.every(sql => sql.includes(RAW_ERRORS_QUERY_MARKER))).toBe(true);
  });

  it('returns the facets builder’s measurement total and message list even when contradictions are present', async () => {
    const censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
    const facetsConnection = recordingConnection();
    const countsConnection = recordingConnection();

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
    expect(counts.totalMeasurements).toBe(facets.totalMeasurements);
    expect(counts.messages).toEqual(facets.messages);
  });

  it('counts each measurement once per message and sorts by count then message', async () => {
    const { connection } = recordingConnection();

    const counts = await buildErrorMessageCounts(connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID] });

    expect(counts.totalMeasurements, 'measurement 101 has two errors but is one measurement').toBe(5);
    expect(counts.messages).toEqual([
      { value: SHRINKAGE_MESSAGE, count: 3 },
      { value: MISSING_SPECIES_MESSAGE, count: 2 },
      { value: FALLBACK_INVALID_MESSAGE, count: 1 }
    ]);
  });

  it('returns nothing for an empty census list instead of querying', async () => {
    const { connection, executedQueries } = recordingConnection();

    const counts = await buildErrorMessageCounts(connection, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [] });

    expect(counts).toEqual({ totalMeasurements: 0, messages: [] });
    expect(executedQueries).toHaveLength(0);
  });
});
