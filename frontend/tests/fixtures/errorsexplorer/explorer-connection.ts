import type { RawErrorOccurrenceRow } from '@/app/api/errors/explorer/_shared';

export const EXPLORER_TEST_SCHEMA = 'forestgeo_testing';
export const EXPLORER_TEST_PLOT_ID = 1;
export const EXPLORER_TEST_CENSUS_ID = 5;
export const EXPLORER_TEST_SECOND_CENSUS_ID = 6;

const RAW_ERRORS_QUERY_MARKER = 'AS DisplayMessage';
const DUPLICATE_GROUPS_QUERY_MARKER = 'GROUP BY ms.TreeTag, ms.StemTag';
const SAME_BATCH_QUERY_MARKER = 'GROUP BY cm.UploadFileID, cm.UploadBatchID, ms.TreeTag';
const ACTIVE_COUNT_QUERY_MARKER = 'SELECT COUNT(*) AS n';
export const RELATED_ROWS_QUERY_MARKER = 'AS RelatedCoreMeasurementID';
const CENSUS_PARAM_INDEX = 1;
const TREE_ID_BASE = 1000;
const STEM_GUID_BASE = 2000;

export interface ContradictionGroupRow {
  TreeTag?: string | null;
  StemTag?: string | null;
  UploadFileID?: string | null;
  UploadBatchID?: string | null;
  MeasurementIDs: string;
}

export interface ExplorerConnectionFixture {
  rawRowsByCensus: Record<number, RawErrorOccurrenceRow[]>;
  duplicateGroupsByCensus?: Record<number, ContradictionGroupRow[]>;
  sameBatchGroupsByCensus?: Record<number, ContradictionGroupRow[]>;
  activeMeasurements?: number;
  relatedRowsOutsideErrorSet?: Array<Record<string, unknown>>;
}

export interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/** Dispatches by SQL text, not call order, so a new concurrent query cannot shift every answer. */
export function explorerConnection(fixture: ExplorerConnectionFixture) {
  const executedQueries: RecordedQuery[] = [];
  const connection = {
    executeQuery: async (sql: string, params: unknown[] = []) => {
      executedQueries.push({ sql, params });
      const censusID = Number(params[CENSUS_PARAM_INDEX]);
      if (sql.includes(RAW_ERRORS_QUERY_MARKER)) return fixture.rawRowsByCensus[censusID] ?? [];
      if (sql.includes(DUPLICATE_GROUPS_QUERY_MARKER)) return fixture.duplicateGroupsByCensus?.[censusID] ?? [];
      if (sql.includes(SAME_BATCH_QUERY_MARKER)) return fixture.sameBatchGroupsByCensus?.[censusID] ?? [];
      if (sql.includes(ACTIVE_COUNT_QUERY_MARKER)) return [{ n: fixture.activeMeasurements ?? 0 }];
      if (sql.includes(RELATED_ROWS_QUERY_MARKER)) return fixture.relatedRowsOutsideErrorSet ?? [];
      throw new Error(`Unexpected query in test: ${sql.slice(0, 120)}`);
    },
    closeConnection: async () => undefined
  };
  return { connection: connection as never, executedQueries };
}

type RequiredOccurrenceFields = Pick<RawErrorOccurrenceRow, 'CoreMeasurementID' | 'ErrorSource' | 'ErrorCode' | 'DisplayMessage'>;

export function rawOccurrence(overrides: Partial<RawErrorOccurrenceRow> & RequiredOccurrenceFields): RawErrorOccurrenceRow {
  const id = overrides.CoreMeasurementID;
  return {
    PlotID: EXPLORER_TEST_PLOT_ID,
    CensusID: EXPLORER_TEST_CENSUS_ID,
    QuadratID: 1,
    TreeID: TREE_ID_BASE + id,
    StemGUID: STEM_GUID_BASE + id,
    CoreStemGUID: STEM_GUID_BASE + id,
    SpeciesID: 1,
    TreeTag: `T${id}`,
    StemTag: '1',
    SpeciesName: 'Species one',
    SubspeciesName: null,
    SpeciesCode: 'SP1',
    QuadratName: 'Q1',
    StemLocalX: 1,
    StemLocalY: 2,
    StemPlotX: null,
    StemPlotY: null,
    MeasurementDate: '2024-06-01',
    MeasuredDBH: 10,
    MeasuredHOM: 1.3,
    IsValidated: false,
    MeasurementDescription: null,
    Attributes: null,
    RawCodes: null,
    UserDefinedFields: null,
    UploadFileID: 'file-1',
    UploadBatchID: 'batch-1',
    ValidationCriteria: '',
    ProcedureName: '',
    PriorCensusID: null,
    PriorDBH: null,
    PriorHOM: null,
    ...overrides
  };
}
