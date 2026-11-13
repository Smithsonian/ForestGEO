import { describe, expect, it } from 'vitest';
import { ERROR_SOURCE, FALLBACK_ERROR_CODE, FALLBACK_ERROR_MESSAGE } from '@/config/errorsexplorer';
import { ALL_FLAGS, everyErrorSetStatement, KEY_FILTER, WINDOW, type ErrorSetStatementVariant } from '@/tests/setup/errorsetstatements';
import {
  buildCatalogStatement,
  buildDuplicateMemberGroupsStatement,
  buildHistogramWithFlagsStatement,
  buildHistogramWithoutFlagsStatement,
  buildIDRawRowsStatement,
  buildPageStatement,
  buildRelatedRowsOutsideErrorSetStatement,
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
  type FlagCombinations,
  type PageWindow
} from './errorsetsql';

const range = (count: number, start = 1) => Array.from({ length: count }, (_, index) => start + index);

const SCHEMA = 'forestgeo_testsite';
const INVALID_SCHEMA = 'not a schema!';
const PLOT_ID = 3;
const PAGE_SIZE = 25;
const LARGE_PAGE_SIZE = 500;
const FIRST_OFFSET = 0;
const SECOND_OFFSET = 50;
const DEEP_OFFSET = 1000;
const MAX_CENSUS_LIST_LENGTH = 40;
const ID_LIST_LENGTHS = [1, 2, 127, 128, 129, 200, 256, 257, 300];
const MAX_ID_LIST_LENGTH = Math.max(...ID_LIST_LENGTHS);
const EXPECTED_STATEMENT_SHAPES = 10;
const UNLABELLED = 'unlabelled';
const SUMMARY_COLUMN_NAMES = ['ValidationRows', 'IngestionRows', 'ContradictionRows', 'DuplicateTagStemRows', 'SameBatchConflictRows'];
const TOTAL_ROWS_COLUMN = 'TotalRows';
const WINDOWED_COUNT = /COUNT\(\*\) OVER \(\)/g;
const ANY_WINDOW = /\bOVER\s*\(/g;
const EXPECTED_NO_LOG_DISPLAY_PARAMS = [ERROR_SOURCE.ingestion, FALLBACK_ERROR_CODE, FALLBACK_ERROR_MESSAGE];
const IS_FAILED_ROW_COLUMN = 'IsFailedRow';
const FAILED_ROW_EXPRESSION = '(cm.StemGUID IS NULL)';
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
const FLAG_BIT_NONE = 1;
const FLAG_BIT_SAME_BATCH_ONLY = 2;
const FLAG_BIT_DUPLICATE_ONLY = 4;
const FLAG_BIT_BOTH = 8;
const FLAG_COMBINATION_COUNT = 16;
const MANY_KEYS_COUNT = 50;
const SECOND_PLOT_ID = 41;
const PLOT_IDS = [PLOT_ID, SECOND_PLOT_ID];
const ALL_KEYS_MATCH_VALUES = [true, false];
const SINGLE_KEY = 7;
const KEY_SETS: Record<string, readonly number[]> = { empty: [], single: [SINGLE_KEY], many: range(MANY_KEYS_COUNT) };
const VALIDATION_KEY_PARITY_MODULUS = 2;
const VALIDATION_KEY_PARITY_REMAINDER = 0;
const PAGE_WINDOWS: PageWindow[] = [
  { limit: PAGE_SIZE, offset: FIRST_OFFSET },
  { limit: PAGE_SIZE, offset: SECOND_OFFSET },
  { limit: LARGE_PAGE_SIZE, offset: DEEP_OFFSET }
];
const REPRESENTATIVE_CENSUS_LENGTHS = [1, 8, 9, MAX_CENSUS_LIST_LENGTH];
const REPRESENTATIVE_ID_LENGTHS = [1, 128, 129];
const CENSUS_CHUNKED_LENGTH = 26;
const EXPECTED_CENSUS_CHUNK_LENGTHS = [8, 8, 8, 2];
const EXPECTED_ID_CHUNK_LENGTHS = [128, 128, 44];

const scopeFor = (censusIDs: number[], plotID = PLOT_ID): ErrorSetScope => ({ schema: SCHEMA, plotID, censusIDs });
const preview = (sql: string) => sql.slice(0, SQL_PREVIEW_LENGTH);
const placeholderCount = (sql: string) => sql.match(PLACEHOLDER)?.length ?? 0;

interface StatementVariant extends ErrorSetStatementVariant {
  readonly description: string;
}

const DEFAULT_VARIANT: StatementVariant = { plotID: PLOT_ID, keyFilter: KEY_FILTER, flags: ALL_FLAGS, window: WINDOW, description: 'default' };

function flagCombinationsFromBits(bits: number): FlagCombinations {
  return {
    none: (bits & FLAG_BIT_NONE) !== 0,
    sameBatchOnly: (bits & FLAG_BIT_SAME_BATCH_ONLY) !== 0,
    duplicateOnly: (bits & FLAG_BIT_DUPLICATE_ONLY) !== 0,
    both: (bits & FLAG_BIT_BOTH) !== 0
  };
}

const isValidationKey = (key: number) => key % VALIDATION_KEY_PARITY_MODULUS === VALIDATION_KEY_PARITY_REMAINDER;

function keyFilterFor(allKeysMatch: boolean, keys: readonly number[]): ErrorTypeKeyFilter {
  return {
    allKeysMatch,
    matchingKeys: keys,
    matchingValidationKeys: keys.filter(isValidationKey),
    matchingIngestionKeys: keys.filter(key => !isValidationKey(key))
  };
}

function filterWindowPlotVariants(): StatementVariant[] {
  const variants: StatementVariant[] = [];
  for (const plotID of PLOT_IDS) {
    for (const allKeysMatch of ALL_KEYS_MATCH_VALUES) {
      for (const [keySetName, keys] of Object.entries(KEY_SETS)) {
        for (let bits = 0; bits < FLAG_COMBINATION_COUNT; bits++) {
          for (const window of PAGE_WINDOWS) {
            variants.push({
              plotID,
              keyFilter: keyFilterFor(allKeysMatch, keys),
              flags: flagCombinationsFromBits(bits),
              window,
              description: `plot=${plotID} allKeysMatch=${allKeysMatch} keys=${keySetName} flagBits=${bits} window=${window.limit}/${window.offset}`
            });
          }
        }
      }
    }
  }
  return variants;
}

const labelledStatement = (statements: BuiltStatement[], label: string): BuiltStatement => {
  const found = statements.find(statement => readStatementLabel(statement.sql) === label);
  if (!found) throw new Error(`no statement labelled ${label}`);
  return found;
};

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
    ['relatedRowsOutsideErrorSet', () => buildRelatedRowsOutsideErrorSetStatement(scope, [10])],
    ['duplicateMemberGroups', () => buildDuplicateMemberGroupsStatement(scope, [10])],
    ['sameBatchMemberGroups', () => buildSameBatchMemberGroupsStatement(scope, [10])]
  ];
}

describe('errorsetsql statement builders', () => {
  it('starts every statement with a known label and a schema-qualified first table', () => {
    const labels = Object.values(ERROR_EXPLORER_STATEMENT_LABELS) as string[];
    const statements = everyErrorSetStatement(SCHEMA, [2], [10]);
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

  it('refuses empty and oversized lists with ErrorSetListSizeError', () => {
    const attempts: Array<[string, () => unknown]> = [
      ['empty id list', () => buildIDRawRowsStatement(scopeFor([2]), [])],
      ['empty census list', () => buildScopeRawRowsStatement(scopeFor([]))],
      ['9-census scope', () => buildScopeRawRowsStatement(scopeFor(range(OVERSIZED_CENSUS_LIST_LENGTH)))],
      ['129-id list', () => buildIDRawRowsStatement(scopeFor([2]), range(OVERSIZED_ID_LIST_LENGTH))],
      ['empty outside-id list', () => buildRelatedRowsOutsideErrorSetStatement(scopeFor([2]), [])],
      ['129-id outside list', () => buildRelatedRowsOutsideErrorSetStatement(scopeFor([2]), range(OVERSIZED_ID_LIST_LENGTH))],
      ['9-census outside scope', () => buildRelatedRowsOutsideErrorSetStatement(scopeFor(range(OVERSIZED_CENSUS_LIST_LENGTH)), [10])],
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
    }
  });

  it('produces exactly ten distinct statement texts across list lengths, key filters, flags, windows and plots', () => {
    const textsByLabel = new Map<string, Set<string>>();
    const firstVariantByText = new Map<string, string>();
    const allTexts = new Set<string>();
    let buildsRun = 0;
    const recordBuild = (description: string, statements: BuiltStatement[]) => {
      buildsRun++;
      for (const { sql } of statements) {
        allTexts.add(sql);
        if (!firstVariantByText.has(sql)) firstVariantByText.set(sql, description);
        const label = readStatementLabel(sql) ?? UNLABELLED;
        textsByLabel.set(label, (textsByLabel.get(label) ?? new Set()).add(sql));
      }
    };
    const describeBuild = (variant: StatementVariant, censusCount: number, idCount: number) =>
      `${variant.description} censusLength=${censusCount} idLength=${idCount}`;

    for (let censusCount = 1; censusCount <= MAX_CENSUS_LIST_LENGTH; censusCount++) {
      for (const idCount of ID_LIST_LENGTHS) {
        recordBuild(describeBuild(DEFAULT_VARIANT, censusCount, idCount), everyErrorSetStatement(SCHEMA, range(censusCount), range(idCount)));
      }
    }
    const listLengthBuildsRun = buildsRun;

    const filterVariants = filterWindowPlotVariants();
    for (const variant of filterVariants) {
      for (const censusCount of REPRESENTATIVE_CENSUS_LENGTHS) {
        for (const idCount of REPRESENTATIVE_ID_LENGTHS) {
          recordBuild(describeBuild(variant, censusCount, idCount), everyErrorSetStatement(SCHEMA, range(censusCount), range(idCount), variant));
        }
      }
    }

    const expectedListLengthBuilds = MAX_CENSUS_LIST_LENGTH * ID_LIST_LENGTHS.length;
    const expectedFilterVariants = PLOT_IDS.length * ALL_KEYS_MATCH_VALUES.length * Object.keys(KEY_SETS).length * FLAG_COMBINATION_COUNT * PAGE_WINDOWS.length;
    const expectedFilterBuilds = expectedFilterVariants * REPRESENTATIVE_CENSUS_LENGTHS.length * REPRESENTATIVE_ID_LENGTHS.length;
    console.log(
      `list-length builds: ${listLengthBuildsRun}; filter/flag/window/plot variants: ${filterVariants.length}; filter builds: ${buildsRun - listLengthBuildsRun}; total builds: ${buildsRun}`
    );
    for (const [label, texts] of textsByLabel) console.log(`${label}: ${texts.size} distinct text(s)`);
    console.log(`distinct statement texts overall: ${allTexts.size}`);

    expect(listLengthBuildsRun).toBe(expectedListLengthBuilds);
    expect(filterVariants.length).toBe(expectedFilterVariants);
    expect(buildsRun).toBe(expectedListLengthBuilds + expectedFilterBuilds);
    expect([...textsByLabel.keys()].sort()).toEqual((Object.values(ERROR_EXPLORER_STATEMENT_LABELS) as string[]).sort());
    for (const [label, texts] of textsByLabel) {
      const firstVariants = [...texts].map(text => `  ${preview(text)}... first built by ${firstVariantByText.get(text)}`).join('\n');
      expect(texts.size, `${label} gained ${texts.size} texts:\n${firstVariants}`).toBe(1);
    }
    expect(allTexts.size).toBe(EXPECTED_STATEMENT_SHAPES);
  });

  it('feeds every filter, flag, window and plot variant into the page and totals params', () => {
    const filterVariants = filterWindowPlotVariants();
    const pageParamTuples = new Set<string>();
    const totalsParamTuples = new Set<string>();
    for (const variant of filterVariants) {
      const statements = everyErrorSetStatement(SCHEMA, range(1), range(1), variant);
      const pageParams = labelledStatement(statements, ERROR_EXPLORER_STATEMENT_LABELS.page).params;
      pageParamTuples.add(JSON.stringify(pageParams));
      totalsParamTuples.add(JSON.stringify(labelledStatement(statements, ERROR_EXPLORER_STATEMENT_LABELS.totals).params));
      expect(pageParams.includes(SECOND_PLOT_ID), `${variant.description}: second plot id in page params ${JSON.stringify(pageParams)}`).toBe(
        variant.plotID === SECOND_PLOT_ID
      );
    }
    const expectedPageTuples = filterVariants.length;
    const expectedTotalsTuples = filterVariants.length / PAGE_WINDOWS.length;
    console.log(
      `distinct page param tuples: ${pageParamTuples.size} (expected ${expectedPageTuples}); distinct totals param tuples: ${totalsParamTuples.size} (expected ${expectedTotalsTuples})`
    );
    expect(pageParamTuples.size).toBe(expectedPageTuples);
    expect(totalsParamTuples.size).toBe(expectedTotalsTuples);
  });

  it('keeps params aligned with placeholders and pads the census slot with nulls', () => {
    for (const { sql, params } of everyErrorSetStatement(SCHEMA, THREE_CENSUS_IDS, [10, 11])) {
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
    expect(params.slice(-PAGE_WINDOW_PARAM_COUNT)).toEqual([String(WINDOW.limit), String(WINDOW.offset)]);

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

  it('returns only the total from the page statement, with one windowed count and no summary sums', () => {
    const { sql } = buildPageStatement(scopeFor([2]), KEY_FILTER, ALL_FLAGS, WINDOW);

    console.log(`page statement windows: ${sql.match(ANY_WINDOW)?.length ?? 0}, windowed counts: ${sql.match(WINDOWED_COUNT)?.length ?? 0}`);
    expect(sql.match(WINDOWED_COUNT)?.length, 'the page statement keeps one COUNT(*) OVER ()').toBe(1);
    expect(sql.match(ANY_WINDOW)?.length, 'and no other window function').toBe(1);
    expect(sql).toContain(`AS ${TOTAL_ROWS_COLUMN}`);
    for (const column of SUMMARY_COLUMN_NAMES) expect(sql, `page statement still selects ${column}`).not.toContain(column);
  });

  it('returns only the total from the totals statement, with no window and no summary sums', () => {
    const { sql } = buildTotalsStatement(scopeFor([2]), KEY_FILTER, ALL_FLAGS);

    console.log(`totals statement windows: ${sql.match(ANY_WINDOW)?.length ?? 0}`);
    expect(sql.match(ANY_WINDOW), 'the totals statement is a plain aggregate').toBeNull();
    expect(sql).toContain(`COUNT(*) AS ${TOTAL_ROWS_COLUMN}`);
    for (const column of SUMMARY_COLUMN_NAMES) expect(sql, `totals statement still selects ${column}`).not.toContain(column);
  });

  it('binds the no-log occurrence display values from the shared config constants', () => {
    const scope = scopeFor([2]);
    const displayParamCarriers: Array<[string, BuiltStatement]> = [
      ['catalog', buildCatalogStatement(SCHEMA)],
      ['scopeRawRows', buildScopeRawRowsStatement(scope)],
      ['idRawRows', buildIDRawRowsStatement(scope, [10])]
    ];
    for (const [name, statement] of displayParamCarriers) {
      const firstDisplayParam = statement.params.indexOf(ERROR_SOURCE.ingestion);
      console.log(
        `${name}: display params at ${firstDisplayParam}: ${JSON.stringify(statement.params.slice(firstDisplayParam, firstDisplayParam + EXPECTED_NO_LOG_DISPLAY_PARAMS.length))}`
      );
      expect(firstDisplayParam, `${name} binds the ingestion source`).toBeGreaterThanOrEqual(0);
      expect(statement.params.slice(firstDisplayParam, firstDisplayParam + EXPECTED_NO_LOG_DISPLAY_PARAMS.length), name).toEqual(
        EXPECTED_NO_LOG_DISPLAY_PARAMS
      );
    }
  });

  describe('histogram failed-row flag', () => {
    const WITH_FLAGS_FINAL_SELECT = /\nSELECT f\.ErrorTypeKeys/;
    const WITHOUT_FLAGS_FINAL_SELECT = /\nSELECT em\.ErrorTypeKeys/;
    const GROUP_BY_CLAUSE = /\bGROUP BY ([^\n]+)\n/;
    const ORDER_BY_CLAUSE = /\bORDER BY ([^\n]+)$/;

    function finalSelectOf(sql: string, finalSelectStart: RegExp): string {
      const start = finalSelectStart.exec(sql);
      if (!start) throw new Error(`no final histogram SELECT in: ${preview(sql)}`);
      return sql.slice(start.index);
    }

    it('derives the flag from the core measurement stem inside error_key', () => {
      const { sql } = buildHistogramWithFlagsStatement(scopeFor([2]));
      const errorKeyStart = sql.indexOf('error_key AS (');
      const errorKeyEnd = sql.indexOf(',\nduplicate_group AS', errorKeyStart);
      const errorKeyCte = sql.slice(errorKeyStart, errorKeyEnd);

      console.log(`error_key CTE: ${errorKeyCte}`);
      expect(errorKeyStart, 'error_key CTE present').toBeGreaterThanOrEqual(0);
      expect(errorKeyCte).toContain(`${FAILED_ROW_EXPRESSION} AS ${IS_FAILED_ROW_COLUMN}`);
    });

    it('selects, groups and orders the with-flags histogram by the flag', () => {
      const finalSelect = finalSelectOf(buildHistogramWithFlagsStatement(scopeFor([2])).sql, WITH_FLAGS_FINAL_SELECT);
      const selectList = finalSelect.slice(0, finalSelect.indexOf('FROM flagged'));
      const groupBy = GROUP_BY_CLAUSE.exec(finalSelect)?.[1] ?? '';
      const orderBy = ORDER_BY_CLAUSE.exec(finalSelect)?.[1] ?? '';

      console.log(`select: ${selectList.trim()}\ngroup by: ${groupBy}\norder by: ${orderBy}`);
      expect(selectList, 'selected').toContain(`f.${IS_FAILED_ROW_COLUMN}`);
      expect(groupBy, 'grouped by, so failed and live rows with one signature never merge').toContain(`f.${IS_FAILED_ROW_COLUMN}`);
      expect(orderBy, 'ordered by, so the result is deterministic').toContain(`f.${IS_FAILED_ROW_COLUMN}`);
    });

    it('returns a constant false flag from the without-flags histogram so both shapes have the same columns', () => {
      const finalSelect = finalSelectOf(buildHistogramWithoutFlagsStatement(scopeFor([2])).sql, WITHOUT_FLAGS_FINAL_SELECT);

      console.log(`without-flags select: ${finalSelect.slice(0, finalSelect.indexOf('FROM'))}`);
      expect(finalSelect).toContain(`0 AS ${IS_FAILED_ROW_COLUMN}`);
      expect(finalSelect, 'the cheap shape cannot see coremeasurements, so it must not group by the flag').not.toMatch(
        new RegExp(`GROUP BY[^\\n]*${IS_FAILED_ROW_COLUMN}`)
      );
    });
  });

  describe('related rows outside the error set', () => {
    const OUTSIDE_LABEL = '/* errors-explorer:related-rows-outside */';
    const RELATED_ROW_COLUMNS = [
      'RelatedCoreMeasurementID',
      'TreeTag',
      'StemTag',
      'SpeciesCode',
      'QuadratName',
      'MeasurementDate',
      'MeasuredDBH',
      'MeasuredHOM',
      'StemLocalX',
      'StemLocalY',
      'MeasurementDescription',
      'UploadFileID',
      'UploadBatchID'
    ];
    const OUTSIDE_IDS = [501, 502, 503];

    it('carries the tenth label and starts from the schema-qualified coremeasurements table', () => {
      const { sql } = buildRelatedRowsOutsideErrorSetStatement(scopeFor([2]), OUTSIDE_IDS);

      console.log(preview(sql));
      expect(ERROR_EXPLORER_STATEMENT_LABELS.relatedRowsOutsideErrorSet).toBe(OUTSIDE_LABEL);
      expect(readStatementLabel(sql)).toBe(OUTSIDE_LABEL);
      expect(FIRST_TABLE_REFERENCE.exec(sql)?.[1]).toBe(`${QUALIFIED_SCHEMA_PREFIX}coremeasurements`);
    });

    it('selects the columns the details panel reads for a partner outside the error set', () => {
      const { sql } = buildRelatedRowsOutsideErrorSetStatement(scopeFor([2]), OUTSIDE_IDS);
      const selectList = sql.slice(sql.indexOf('SELECT'), sql.indexOf('FROM'));

      console.log(`select list: ${selectList}`);
      for (const column of RELATED_ROW_COLUMNS) expect(selectList, `missing ${column}`).toMatch(new RegExp(`\\b${column}\\b`));
    });

    it('binds the plot, then the padded census slot, then the padded id slot, and keeps only active rows', () => {
      const { sql, params } = buildRelatedRowsOutsideErrorSetStatement(scopeFor(THREE_CENSUS_IDS), OUTSIDE_IDS);
      const paddedCensusSlot = [...THREE_CENSUS_IDS, ...Array<null>(CENSUS_LIST_SIZE - THREE_CENSUS_IDS.length).fill(null)];
      const paddedIDSlot = [...OUTSIDE_IDS, ...Array<null>(ID_LIST_SIZE - OUTSIDE_IDS.length).fill(null)];

      console.log(`params: ${JSON.stringify(params)}`);
      expect(sql).toMatch(/ms\.PlotID = \?/);
      expect(sql).toContain('COALESCE(cm.IsActive, TRUE) = TRUE');
      expect(params).toEqual([PLOT_ID, ...paddedCensusSlot, ...paddedIDSlot]);
      expect(placeholderCount(sql)).toBe(params.length);
    });
  });
});
