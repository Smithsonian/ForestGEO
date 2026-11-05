import { describe, expect, it } from 'vitest';
import { EmptyInListError } from '@/lib/db/sqlsecurity';
import {
  buildCatalogStatement,
  buildDuplicateMemberGroupsStatement,
  buildHistogramWithFlagsStatement,
  buildHistogramWithoutFlagsStatement,
  buildIDRawRowsStatement,
  buildPageStatement,
  buildSameBatchMemberGroupsStatement,
  buildScopeRawRowsStatement,
  buildTotalsStatement,
  CENSUS_LIST_SIZE,
  chunkCensusIDs,
  chunkMeasurementIDs,
  compareSelectedRows,
  ERROR_EXPLORER_STATEMENT_LABELS,
  ErrorSetListSizeError,
  ID_LIST_SIZE,
  InvalidPageWindowError,
  readStatementLabel,
  type BuiltStatement,
  type ErrorSetScope,
  type ErrorTypeKeyFilter,
  type FlagCombinations
} from './errorsetsql';

const SCHEMA = 'forestgeo_testsite';
const INVALID_SCHEMA = 'not a schema!';
const PLOT_ID = 3;
const KEY_FILTER: ErrorTypeKeyFilter = { allKeysMatch: false, matchingKeys: [1, 7], matchingValidationKeys: [1], matchingIngestionKeys: [7] };
const ALL_FLAGS: FlagCombinations = { none: true, sameBatchOnly: true, duplicateOnly: true, both: true };
const WINDOW = { limit: 25, offset: 50 };
const MAX_CENSUS_LIST_LENGTH = 40;
const MAX_ID_LIST_LENGTH = 300;
const ID_LIST_LENGTHS = [1, 2, 127, 128, 129, 200, 256, 257, 300];
const EXPECTED_STATEMENT_SHAPES = 9;
const FIRST_TABLE_REFERENCE = /\b(?:FROM|JOIN)\s+(\S+)/i;
const SQL_PREVIEW_LENGTH = 120;
const QUALIFIED_SCHEMA_PREFIX = `\`${SCHEMA}\`.`;
const PLACEHOLDER = /\?/g;
const THREE_CENSUS_IDS = [11, 12, 13];
const OVERSIZED_ID_LIST_LENGTH = ID_LIST_SIZE + 1;
const OVERSIZED_CENSUS_LIST_LENGTH = CENSUS_LIST_SIZE + 1;
const KEY_SET_PARAM_COUNT = 3;
const FLAG_PARAM_COUNT = 5;
const PAGE_WINDOW_PARAM_COUNT = 2;
const CENSUS_CHUNKED_LENGTH = 26;
const EXPECTED_CENSUS_CHUNK_LENGTHS = [8, 8, 8, 2];
const EXPECTED_ID_CHUNK_LENGTHS = [128, 128, 44];

const range = (count: number, start = 1) => Array.from({ length: count }, (_, index) => start + index);
const scopeFor = (censusIDs: number[]): ErrorSetScope => ({ schema: SCHEMA, plotID: PLOT_ID, censusIDs });
const preview = (sql: string) => sql.slice(0, SQL_PREVIEW_LENGTH);
const placeholderCount = (sql: string) => sql.match(PLACEHOLDER)?.length ?? 0;

function everyStatementFor(censusIDs: number[], measurementIDs: number[]): BuiltStatement[] {
  return chunkCensusIDs(censusIDs).flatMap(censusChunk => {
    const scope = scopeFor(censusChunk);
    return [
      buildCatalogStatement(SCHEMA),
      buildPageStatement(scope, KEY_FILTER, ALL_FLAGS, WINDOW),
      buildTotalsStatement(scope, KEY_FILTER, ALL_FLAGS),
      buildHistogramWithFlagsStatement(scope),
      buildHistogramWithoutFlagsStatement(scope),
      buildScopeRawRowsStatement(scope),
      ...chunkMeasurementIDs(measurementIDs).flatMap(idChunk => [
        buildIDRawRowsStatement(scope, idChunk),
        buildDuplicateMemberGroupsStatement(scope, idChunk),
        buildSameBatchMemberGroupsStatement(scope, idChunk)
      ])
    ];
  });
}

function everyBuilderWithSchema(schema: string): Array<[string, () => BuiltStatement]> {
  const scope: ErrorSetScope = { schema, plotID: PLOT_ID, censusIDs: [2] };
  return [
    ['catalog', () => buildCatalogStatement(schema)],
    ['page', () => buildPageStatement(scope, KEY_FILTER, ALL_FLAGS, WINDOW)],
    ['totals', () => buildTotalsStatement(scope, KEY_FILTER, ALL_FLAGS)],
    ['histogramWithFlags', () => buildHistogramWithFlagsStatement(scope)],
    ['histogramWithoutFlags', () => buildHistogramWithoutFlagsStatement(scope)],
    ['scopeRawRows', () => buildScopeRawRowsStatement(scope)],
    ['idRawRows', () => buildIDRawRowsStatement(scope, [10])],
    ['duplicateMemberGroups', () => buildDuplicateMemberGroupsStatement(scope, [10])],
    ['sameBatchMemberGroups', () => buildSameBatchMemberGroupsStatement(scope, [10])]
  ];
}

describe('errorsetsql statement builders', () => {
  it('starts every statement with a known label and a schema-qualified first table', () => {
    const labels = Object.values(ERROR_EXPLORER_STATEMENT_LABELS) as string[];
    const statements = everyStatementFor([2], [10]);
    expect(statements).toHaveLength(EXPECTED_STATEMENT_SHAPES);

    for (const { sql } of statements) {
      const label = readStatementLabel(sql);
      console.log(`label=${label} first table=${FIRST_TABLE_REFERENCE.exec(sql)?.[1]}`);
      expect(labels, `unlabelled statement: ${preview(sql)}`).toContain(label);
      const firstTable = FIRST_TABLE_REFERENCE.exec(sql)?.[1];
      expect(firstTable, `no table reference: ${preview(sql)}`).toBeDefined();
      expect(firstTable!.startsWith(QUALIFIED_SCHEMA_PREFIX), `first table not schema-qualified: ${preview(sql)}`).toBe(true);
    }
    expect(new Set(statements.map(statement => readStatementLabel(statement.sql))).size).toBe(labels.length);
  });

  it('throws for an invalid schema in every builder before returning any SQL', () => {
    for (const [name, build] of everyBuilderWithSchema(INVALID_SCHEMA)) {
      console.log(`builder ${name} with schema ${INVALID_SCHEMA}`);
      expect(build, name).toThrow(/Invalid or unauthorized schema/);
    }
  });

  it('refuses empty and oversized lists with ErrorSetListSizeError, never the placeholder helper error', () => {
    const attempts: Array<[string, () => unknown]> = [
      ['empty id list', () => buildIDRawRowsStatement(scopeFor([2]), [])],
      ['empty census list', () => buildScopeRawRowsStatement(scopeFor([]))],
      ['9-census scope', () => buildScopeRawRowsStatement(scopeFor(range(OVERSIZED_CENSUS_LIST_LENGTH)))],
      ['129-id list', () => buildIDRawRowsStatement(scopeFor([2]), range(OVERSIZED_ID_LIST_LENGTH))],
      ['129-id duplicate list', () => buildDuplicateMemberGroupsStatement(scopeFor([2]), range(OVERSIZED_ID_LIST_LENGTH))]
    ];
    for (const [name, attempt] of attempts) {
      let thrown: unknown;
      try {
        attempt();
      } catch (error) {
        thrown = error;
      }
      console.log(`${name} threw ${(thrown as Error | undefined)?.name}: ${(thrown as Error | undefined)?.message}`);
      expect(thrown, name).toBeInstanceOf(ErrorSetListSizeError);
      expect(thrown, name).not.toBeInstanceOf(EmptyInListError);
    }
  });

  it('produces exactly nine distinct statement texts across every census and id list length', () => {
    const textsByLabel = new Map<string, Set<string>>();
    const allTexts = new Set<string>();
    for (let censusCount = 1; censusCount <= MAX_CENSUS_LIST_LENGTH; censusCount++) {
      for (const idCount of ID_LIST_LENGTHS) {
        expect(idCount).toBeLessThanOrEqual(MAX_ID_LIST_LENGTH);
        for (const { sql } of everyStatementFor(range(censusCount), range(idCount))) {
          allTexts.add(sql);
          const label = readStatementLabel(sql) ?? 'unlabelled';
          textsByLabel.set(label, (textsByLabel.get(label) ?? new Set()).add(sql));
        }
      }
    }
    for (const [label, texts] of textsByLabel) console.log(`${label}: ${texts.size} distinct text(s)`);
    console.log(`distinct statement texts overall: ${allTexts.size}`);
    expect(allTexts.size).toBe(EXPECTED_STATEMENT_SHAPES);
  });

  it('keeps params aligned with placeholders and pads the census slot with nulls', () => {
    for (const { sql, params } of everyStatementFor(THREE_CENSUS_IDS, [10, 11])) {
      console.log(`${readStatementLabel(sql)}: ${placeholderCount(sql)} placeholders, ${params.length} params`);
      expect(params.length, preview(sql)).toBe(placeholderCount(sql));
    }
    const { params } = buildScopeRawRowsStatement(scopeFor(THREE_CENSUS_IDS));
    const firstCensusSlot = params.slice(params.indexOf(PLOT_ID) + 1, params.indexOf(PLOT_ID) + 1 + CENSUS_LIST_SIZE);
    console.log(`first census slot params: ${JSON.stringify(firstCensusSlot)}`);
    expect(firstCensusSlot).toEqual([...THREE_CENSUS_IDS, null, null, null, null, null]);
  });

  it('binds LIMIT and OFFSET as the last two decimal-string params and rejects unsafe windows', () => {
    const { params } = buildPageStatement(scopeFor([2]), KEY_FILTER, ALL_FLAGS, WINDOW);
    console.log(`page tail params: ${JSON.stringify(params.slice(-2))}`);
    expect(params.slice(-2)).toEqual(['25', '50']);

    const invalidWindows = [
      { limit: -1, offset: 0 },
      { limit: 1.5, offset: 0 },
      { limit: 10, offset: Number.MAX_SAFE_INTEGER + 2 }
    ];
    for (const window of invalidWindows) {
      console.log(`window ${JSON.stringify(window)}`);
      expect(() => buildPageStatement(scopeFor([2]), KEY_FILTER, ALL_FLAGS, window)).toThrow(InvalidPageWindowError);
    }
  });

  it('binds key sets as comma-joined digit strings and flags as 1/0 after the match-count params', () => {
    const { params } = buildPageStatement(scopeFor([2]), KEY_FILTER, ALL_FLAGS, WINDOW);
    const keyStart = params.indexOf('1,7');
    console.log(`page params from key sets: ${JSON.stringify(params.slice(keyStart))}`);
    expect(keyStart).toBeGreaterThanOrEqual(0);
    expect(params.slice(keyStart, keyStart + KEY_SET_PARAM_COUNT)).toEqual(['1,7', '1', '7']);
    const allowFlagParams = params.slice(-(FLAG_PARAM_COUNT + PAGE_WINDOW_PARAM_COUNT), -PAGE_WINDOW_PARAM_COUNT);
    console.log(`allow flag params: ${JSON.stringify(allowFlagParams)}`);
    expect(allowFlagParams).toEqual([0, 1, 1, 1, 1]);
  });

  it('chunks census ids by eight and measurement ids by 128 without losing or repeating an id', () => {
    const censusChunks = chunkCensusIDs(range(CENSUS_CHUNKED_LENGTH));
    expect(censusChunks.map(chunk => chunk.length)).toEqual(EXPECTED_CENSUS_CHUNK_LENGTHS);
    expect(censusChunks.flat()).toEqual(range(CENSUS_CHUNKED_LENGTH));

    const idChunks = chunkMeasurementIDs(range(MAX_ID_LIST_LENGTH));
    console.log(`id chunk lengths: ${idChunks.map(chunk => chunk.length)}`);
    expect(idChunks.map(chunk => chunk.length)).toEqual(EXPECTED_ID_CHUNK_LENGTHS);
    expect(idChunks.flat()).toEqual(range(MAX_ID_LIST_LENGTH));
  });

  it('orders selected rows by contradiction, occurrence count, date (nulls first) then id', () => {
    const rows = [
      { CoreMeasurementID: 9, HasContradiction: 0, OccurrenceCount: 1, MeasurementDate: new Date('2024-06-02T00:00:00Z') },
      { CoreMeasurementID: 4, HasContradiction: 1, OccurrenceCount: 1, MeasurementDate: new Date('2024-06-03T00:00:00Z') },
      { CoreMeasurementID: 3, HasContradiction: 0, OccurrenceCount: 2, MeasurementDate: null },
      { CoreMeasurementID: 8, HasContradiction: 0, OccurrenceCount: 1, MeasurementDate: null },
      { CoreMeasurementID: 5, HasContradiction: 1, OccurrenceCount: 3, MeasurementDate: new Date('2024-06-05T00:00:00Z') },
      { CoreMeasurementID: 7, HasContradiction: 0, OccurrenceCount: 1, MeasurementDate: new Date('2024-06-02T00:00:00Z') },
      { CoreMeasurementID: 6, HasContradiction: '1', OccurrenceCount: '1', MeasurementDate: '2024-06-03' }
    ];
    const sortedIDs = [...rows].sort(compareSelectedRows).map(row => row.CoreMeasurementID);
    console.log(`sorted ids: ${sortedIDs}`);
    expect(sortedIDs).toEqual([5, 4, 6, 3, 8, 7, 9]);
  });
});
