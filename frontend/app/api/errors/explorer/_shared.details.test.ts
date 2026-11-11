import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_EXPLORER_FILTERS, type ErrorTypeIdentity } from '@/config/errorsexplorer';
import { buildErrorExplorerDetails, buildErrorExplorerFacets } from './_shared';
import {
  EXPLORER_TEST_CENSUS_ID,
  EXPLORER_TEST_PLOT_ID,
  EXPLORER_TEST_SCHEMA,
  explorerConnection,
  rawOccurrence,
  RELATED_ROWS_QUERY_MARKER,
  type ExplorerConnectionFixture
} from '@/tests/fixtures/errorsexplorer/explorer-connection';

const SAME_BATCH: ErrorTypeIdentity = { source: 'validation', code: '21', message: 'Same-batch species conflict' };
const FLAGGED_ROW_ID = 302;
const CLEAN_FIRST_ROW_ID = 301;
const SCOPE = { schema: EXPLORER_TEST_SCHEMA, plotID: EXPLORER_TEST_PLOT_ID, censusID: EXPLORER_TEST_CENSUS_ID };

const FIXTURE: ExplorerConnectionFixture = {
  activeMeasurements: 10,
  rawRowsByCensus: {
    [EXPLORER_TEST_CENSUS_ID]: [
      rawOccurrence({
        CoreMeasurementID: FLAGGED_ROW_ID,
        ErrorSource: SAME_BATCH.source,
        ErrorCode: SAME_BATCH.code,
        DisplayMessage: SAME_BATCH.message,
        TreeTag: 'SB-1'
      })
    ]
  },
  sameBatchGroupsByCensus: {
    [EXPLORER_TEST_CENSUS_ID]: [
      { UploadFileID: 'file-1', UploadBatchID: 'batch-1', TreeTag: 'SB-1', MeasurementIDs: `${CLEAN_FIRST_ROW_ID},${FLAGGED_ROW_ID}` }
    ]
  },
  relatedRowsOutsideErrorSet: [
    {
      RelatedCoreMeasurementID: CLEAN_FIRST_ROW_ID,
      TreeTag: 'SB-1',
      StemTag: '1',
      SpeciesCode: 'AAA',
      QuadratName: 'Q1',
      MeasurementDate: '2024-06-01',
      MeasuredDBH: '10.000000',
      MeasuredHOM: '1.300000',
      StemLocalX: '1.000000',
      StemLocalY: '2.000000',
      MeasurementDescription: null,
      UploadFileID: 'file-1',
      UploadBatchID: 'batch-1'
    }
  ]
};

describe('details related rows outside the error set (P2-7)', () => {
  it("returns validation 21's clean first row as a related row outside the error set", async () => {
    const { connection, executedQueries } = explorerConnection(FIXTURE);
    const details = await buildErrorExplorerDetails(connection, SCOPE, FLAGGED_ROW_ID);
    const lookup = executedQueries.find(entry => entry.sql.includes(RELATED_ROWS_QUERY_MARKER));
    console.log('[view-errors details related]', JSON.stringify({ relatedRows: details.relatedRows, lookup }));
    expect(details.relatedRows).toEqual([
      expect.objectContaining({
        coreMeasurementID: CLEAN_FIRST_ROW_ID,
        inErrorSet: false,
        errorCount: 0,
        errorMessages: [],
        measuredDBH: 10,
        speciesCode: 'AAA'
      })
    ]);
    expect(lookup?.params).toEqual([EXPLORER_TEST_PLOT_ID, EXPLORER_TEST_CENSUS_ID, CLEAN_FIRST_ROW_ID]);
    expect(lookup?.sql).toMatch(/IsActive/);
  });

  it('keeps the clean row out of every count and group', async () => {
    const { connection } = explorerConnection(FIXTURE);
    const facets = await buildErrorExplorerFacets(connection, { ...SCOPE, censusIDs: [EXPLORER_TEST_CENSUS_ID], filters: DEFAULT_ERROR_EXPLORER_FILTERS });
    expect(facets.censusTotals.affectedMeasurements).toBe(1);
    expect(facets.errorTypes.map(type => type.count)).toEqual([1]);
  });

  it('runs no lookup when every related row is in the error set, and marks those rows inErrorSet', async () => {
    const both: ExplorerConnectionFixture = {
      ...FIXTURE,
      rawRowsByCensus: {
        [EXPLORER_TEST_CENSUS_ID]: [
          ...FIXTURE.rawRowsByCensus[EXPLORER_TEST_CENSUS_ID],
          rawOccurrence({
            CoreMeasurementID: CLEAN_FIRST_ROW_ID,
            ErrorSource: 'validation',
            ErrorCode: '14',
            DisplayMessage: 'Attribute code does not exist in attributes table',
            TreeTag: 'SB-1'
          })
        ]
      }
    };
    const { connection, executedQueries } = explorerConnection(both);
    const details = await buildErrorExplorerDetails(connection, SCOPE, FLAGGED_ROW_ID);
    expect(details.relatedRows.map(row => [row.coreMeasurementID, row.inErrorSet])).toEqual([[CLEAN_FIRST_ROW_ID, true]]);
    expect(executedQueries.some(entry => entry.sql.includes(RELATED_ROWS_QUERY_MARKER))).toBe(false);
  });
});
