import { describe, expect, it } from 'vitest';
import { fetchGroupedErrorRows, queryErrorExplorer, type RawErrorOccurrenceRow } from './_shared';
import { DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';
import {
  CENSUS_LIST_SIZE,
  ERROR_EXPLORER_STATEMENT_LABELS,
  ID_LIST_SIZE,
  readStatementLabel,
  SQL_FALSE,
  SQL_TRUE,
  type ContradictionFlagColumns,
  type ErrorTypeCatalogRow,
  type SelectedPageRow
} from './errorsetsql';

const SCHEMA = 'forestgeo_testsite';
const PLOT_ID = 1;
const FIRST_CENSUS_ID = 1;
const FIRST_CENSUS_PARAM_INDEX = 1;
const FIRST_ID_PARAM_INDEX = FIRST_CENSUS_PARAM_INDEX + CENSUS_LIST_SIZE;
const LIMIT_PARAM_FROM_END = 2;

// Bisected on Node 25.2.1: `array.push(...rows)` overflows past ~124,500 rows on the main thread and past ~494,900 inside a vitest worker thread (larger stack).
// The fixtures clear the worker limit; expectSpreadOverflows proves that in whichever runtime runs the test.
const ROWS_BEYOND_SPREAD_LIMIT = 600_000;
const ERROR_OCCURRENCES_PER_MEASUREMENT = 3;
const MEASUREMENTS_BEYOND_SPREAD_LIMIT = ROWS_BEYOND_SPREAD_LIMIT / ERROR_OCCURRENCES_PER_MEASUREMENT;
const MEASUREMENTS_PER_CHUNK = 173_400;
const CENSUS_COUNT_NEEDING_TWO_CHUNKS = CENSUS_LIST_SIZE + 1;
const SECOND_CHUNK_CENSUS_ID = CENSUS_LIST_SIZE + 1;

const SEARCH_HIT_SPECIES_CODE = 'HITSPECIES';
const SEARCH_MISS_SPECIES_CODE = 'OTHERSPECIES';
const SEARCH_HIT_EVERY = 2;
const DUPLICATE_FLAG_EVERY = 10;
const SEARCH_PAGE_SIZE = 25;
const SEARCH_PAGE = 1;

const VALIDATION_ERROR_ID = 1;
const INGESTION_ERROR_ID = 2;
const VALIDATION_CODE = '3';
const INGESTION_CODE = 'S2';
const VALIDATION_MESSAGE = 'Validation message';
const INGESTION_MESSAGE = 'Ingestion message';
const SECOND_INGESTION_CODE = 'S3';
const SECOND_INGESTION_MESSAGE = 'Second ingestion message';
const CATALOG_ROWS: ErrorTypeCatalogRow[] = [
  {
    ErrorID: VALIDATION_ERROR_ID,
    ErrorSource: 'validation',
    ErrorCode: VALIDATION_CODE,
    DisplayMessage: VALIDATION_MESSAGE,
    ValidationCriteria: '',
    ProcedureName: ''
  },
  {
    ErrorID: INGESTION_ERROR_ID,
    ErrorSource: 'ingestion',
    ErrorCode: INGESTION_CODE,
    DisplayMessage: INGESTION_MESSAGE,
    ValidationCriteria: '',
    ProcedureName: ''
  }
];

const DEEP_PAGE = 5_200;
const DEEP_PAGE_SIZE = 100;
const DEEP_PAGE_OFFSET = DEEP_PAGE * DEEP_PAGE_SIZE;
const DEEP_PAGE_ROWS_PER_CHUNK = DEEP_PAGE_OFFSET + DEEP_PAGE_SIZE;
const ROWS_AVAILABLE_PER_CHUNK = 600_000;
const CHUNK_COUNT = 2;

type FlaggedRawRow = RawErrorOccurrenceRow & ContradictionFlagColumns;

interface OccurrenceTemplate {
  source: RawErrorOccurrenceRow['ErrorSource'];
  code: string;
  message: string;
}

const OCCURRENCE_TEMPLATES: OccurrenceTemplate[] = [
  { source: 'validation', code: VALIDATION_CODE, message: VALIDATION_MESSAGE },
  { source: 'ingestion', code: INGESTION_CODE, message: INGESTION_MESSAGE },
  { source: 'ingestion', code: SECOND_INGESTION_CODE, message: SECOND_INGESTION_MESSAGE }
];

function rawRow(measurementID: number, censusID: number, template: OccurrenceTemplate, speciesCode: string, hasDuplicate: boolean): FlaggedRawRow {
  return {
    CoreMeasurementID: measurementID,
    PlotID: PLOT_ID,
    CensusID: censusID,
    CoreStemGUID: measurementID,
    SpeciesCode: speciesCode,
    TreeTag: `T${measurementID}`,
    StemTag: `S${measurementID}`,
    ErrorSource: template.source,
    ErrorCode: template.code,
    DisplayMessage: template.message,
    HasDuplicate: hasDuplicate ? SQL_TRUE : SQL_FALSE,
    HasSameBatch: SQL_FALSE
  };
}

function scopeRawRows(firstMeasurementID: number, measurementCount: number, censusID: number): FlaggedRawRow[] {
  const rows: FlaggedRawRow[] = [];
  for (let measurementID = firstMeasurementID; measurementID < firstMeasurementID + measurementCount; measurementID++) {
    const speciesCode = measurementID % SEARCH_HIT_EVERY === 0 ? SEARCH_HIT_SPECIES_CODE : SEARCH_MISS_SPECIES_CODE;
    const hasDuplicate = measurementID % DUPLICATE_FLAG_EVERY === 0;
    for (const template of OCCURRENCE_TEMPLATES) rows.push(rawRow(measurementID, censusID, template, speciesCode, hasDuplicate));
  }
  return rows;
}

function censusIDsOf(params: unknown[]): number[] {
  return params.slice(FIRST_CENSUS_PARAM_INDEX, FIRST_CENSUS_PARAM_INDEX + CENSUS_LIST_SIZE).filter((id): id is number => id !== null);
}

function idsOf(params: unknown[]): number[] {
  return params.slice(FIRST_ID_PARAM_INDEX, FIRST_ID_PARAM_INDEX + ID_LIST_SIZE).filter((id): id is number => id !== null);
}

function expectSpreadOverflows(rowCount: number) {
  console.log(`[large row sets] checking that spreading ${rowCount} rows into push() overflows the stack in this runtime`);
  const sink: object[] = [];
  expect(() => sink.push(...new Array<object>(rowCount).fill({})), 'the fixture must be big enough that spreading it into push() throws').toThrow(RangeError);
}

function connectionAnswering(answer: (label: string | null, sql: string, params: unknown[]) => unknown[]) {
  const executedLabels: Array<string | null> = [];
  const connection = {
    executeQuery: async (sql: string, params: unknown[]) => {
      const label = readStatementLabel(sql);
      executedLabels.push(label);
      return answer(label, sql, params);
    }
  };
  return { connection: connection as never, executedLabels };
}

describe('error explorer row sets larger than push() can spread', () => {
  describe('fetchGroupedErrorRows (the scope-raw-rows append)', () => {
    it('groups every row of one statement answer that is past the spread limit', async () => {
      const answered = scopeRawRows(1, MEASUREMENTS_BEYOND_SPREAD_LIMIT, FIRST_CENSUS_ID);
      expectSpreadOverflows(answered.length);
      const { connection, executedLabels } = connectionAnswering(label => {
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows) return answered;
        throw new Error(`Unexpected statement in test: ${label}`);
      });

      const grouped = await fetchGroupedErrorRows(connection, SCHEMA, PLOT_ID, FIRST_CENSUS_ID);

      const errorOccurrences = Array.from(grouped.values()).reduce((total, row) => total + row.allErrors.length, 0);
      console.log(`[large row sets] statements ${JSON.stringify(executedLabels)}; groups ${grouped.size}; occurrences ${errorOccurrences}`);
      expect(executedLabels).toEqual([ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows]);
      expect(grouped.size, 'one group per measurement').toBe(MEASUREMENTS_BEYOND_SPREAD_LIMIT);
      expect(errorOccurrences, 'no occurrence lost').toBe(answered.length);
      expect(Array.from(grouped.keys()).slice(0, 2)).toEqual([1, 2]);
      expect(Array.from(grouped.keys()).at(-1)).toBe(MEASUREMENTS_BEYOND_SPREAD_LIMIT);
    });

    it('keeps census-chunk order when each of two chunks answers past the spread limit', async () => {
      const censusIDs = Array.from({ length: CENSUS_COUNT_NEEDING_TWO_CHUNKS }, (_, index) => FIRST_CENSUS_ID + index);
      const firstChunkRows = scopeRawRows(1, MEASUREMENTS_PER_CHUNK, FIRST_CENSUS_ID);
      const secondChunkRows = scopeRawRows(MEASUREMENTS_PER_CHUNK + 1, MEASUREMENTS_PER_CHUNK, SECOND_CHUNK_CENSUS_ID);
      expectSpreadOverflows(firstChunkRows.length);
      const { connection, executedLabels } = connectionAnswering((label, _sql, params) => {
        if (label !== ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows) throw new Error(`Unexpected statement in test: ${label}`);
        return censusIDsOf(params).includes(SECOND_CHUNK_CENSUS_ID) ? secondChunkRows : firstChunkRows;
      });

      const grouped = await fetchGroupedErrorRows(connection, SCHEMA, PLOT_ID, censusIDs);

      const measurementIDs = Array.from(grouped.keys());
      console.log(
        `[large row sets] statements ${JSON.stringify(executedLabels)}; groups ${grouped.size}; first ${measurementIDs[0]}; last ${measurementIDs.at(-1)}`
      );
      expect(executedLabels).toHaveLength(CHUNK_COUNT);
      expect(grouped.size).toBe(MEASUREMENTS_PER_CHUNK * CHUNK_COUNT);
      expect(measurementIDs[MEASUREMENTS_PER_CHUNK - 1], 'last measurement of the first chunk').toBe(MEASUREMENTS_PER_CHUNK);
      expect(measurementIDs[MEASUREMENTS_PER_CHUNK], 'first measurement of the second chunk follows it').toBe(MEASUREMENTS_PER_CHUNK + 1);
    });
  });

  describe('queryErrorExplorer with a quick search (the Node path that crashed)', () => {
    it('filters, counts and pages a scope whose raw rows are past the spread limit', async () => {
      const answered = scopeRawRows(1, MEASUREMENTS_BEYOND_SPREAD_LIMIT, FIRST_CENSUS_ID);
      expectSpreadOverflows(answered.length);
      const { connection, executedLabels } = connectionAnswering(label => {
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows) return answered;
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups || label === ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups) return [];
        throw new Error(`Unexpected statement in test: ${label}`);
      });
      const hitCount = MEASUREMENTS_BEYOND_SPREAD_LIMIT / SEARCH_HIT_EVERY;
      const duplicateHitCount = MEASUREMENTS_BEYOND_SPREAD_LIMIT / DUPLICATE_FLAG_EVERY;

      const response = await queryErrorExplorer(connection, {
        schema: SCHEMA,
        plotID: PLOT_ID,
        censusID: FIRST_CENSUS_ID,
        page: SEARCH_PAGE,
        pageSize: SEARCH_PAGE_SIZE,
        filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, quickSearch: SEARCH_HIT_SPECIES_CODE.toLowerCase() }
      });

      const pageIDs = response.rows.map(row => row.coreMeasurementID);
      console.log(`[large row sets] quick search total ${response.totalRows}; summary ${JSON.stringify(response.summary)}; page IDs ${pageIDs.join(',')}`);
      expect(response.totalRows, 'every even measurement matches').toBe(hitCount);
      expect(response.summary).toEqual({
        total: hitCount,
        validation: hitCount,
        ingestion: hitCount,
        contradictions: duplicateHitCount,
        duplicateTagStem: duplicateHitCount,
        sameBatchConflict: 0
      });
      const firstIDOnPage = SEARCH_PAGE * SEARCH_PAGE_SIZE * DUPLICATE_FLAG_EVERY + DUPLICATE_FLAG_EVERY;
      expect(pageIDs, 'contradiction rows sort first, then ascending ID: page 1 is the second 25 multiples of ten').toEqual(
        Array.from({ length: SEARCH_PAGE_SIZE }, (_, index) => firstIDOnPage + index * DUPLICATE_FLAG_EVERY)
      );
      expect(executedLabels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows)).toHaveLength(1);
    });
  });

  describe('queryErrorExplorer without a search across more than one census chunk (the candidates append)', () => {
    it('merges two chunks whose prefix windows are each past the spread limit', async () => {
      const censusIDs = Array.from({ length: CENSUS_COUNT_NEEDING_TWO_CHUNKS }, (_, index) => FIRST_CENSUS_ID + index);
      expectSpreadOverflows(DEEP_PAGE_ROWS_PER_CHUNK);
      const chunkIndexOf = (params: unknown[]) => (censusIDsOf(params).includes(SECOND_CHUNK_CENSUS_ID) ? 1 : 0);
      const { connection, executedLabels } = connectionAnswering((label, _sql, params) => {
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.catalog) return CATALOG_ROWS;
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.page) {
          const chunkIndex = chunkIndexOf(params);
          const requestedLimit = Number(params[params.length - LIMIT_PARAM_FROM_END]);
          const answeredRows = Math.min(requestedLimit, ROWS_AVAILABLE_PER_CHUNK);
          const censusID = chunkIndex === 0 ? FIRST_CENSUS_ID : SECOND_CHUNK_CENSUS_ID;
          return Array.from(
            { length: answeredRows },
            (_, position): SelectedPageRow => ({
              CoreMeasurementID: position * CHUNK_COUNT + chunkIndex + 1,
              CensusID: censusID,
              HasContradiction: SQL_FALSE,
              OccurrenceCount: 1,
              MeasurementDate: null,
              TotalRows: ROWS_AVAILABLE_PER_CHUNK,
              ValidationRows: ROWS_AVAILABLE_PER_CHUNK,
              IngestionRows: 0,
              ContradictionRows: 0,
              DuplicateTagStemRows: 0,
              SameBatchConflictRows: 0
            })
          );
        }
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.idRawRows) {
          const censusID = censusIDsOf(params)[0];
          return idsOf(params).map(measurementID => rawRow(measurementID, censusID, OCCURRENCE_TEMPLATES[0], SEARCH_MISS_SPECIES_CODE, false));
        }
        if (label === ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups || label === ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups) return [];
        throw new Error(`Unexpected statement in test: ${label}`);
      });

      const response = await queryErrorExplorer(connection, {
        schema: SCHEMA,
        plotID: PLOT_ID,
        censusID: FIRST_CENSUS_ID,
        censusIDs,
        page: DEEP_PAGE,
        pageSize: DEEP_PAGE_SIZE,
        filters: DEFAULT_ERROR_EXPLORER_FILTERS
      });

      const pageIDs = response.rows.map(row => row.coreMeasurementID);
      console.log(`[large row sets] deep page total ${response.totalRows}; first ${pageIDs[0]}; last ${pageIDs.at(-1)}; statements ${executedLabels.length}`);
      expect(response.totalRows, 'both chunks add up').toBe(ROWS_AVAILABLE_PER_CHUNK * CHUNK_COUNT);
      expect(pageIDs, 'the chunks interleave by ID, so the deep page is the IDs just past the offset').toEqual(
        Array.from({ length: DEEP_PAGE_SIZE }, (_, index) => DEEP_PAGE_OFFSET + index + 1)
      );
      expect(executedLabels.filter(label => label === ERROR_EXPLORER_STATEMENT_LABELS.page)).toHaveLength(CHUNK_COUNT);
    });
  });
});
