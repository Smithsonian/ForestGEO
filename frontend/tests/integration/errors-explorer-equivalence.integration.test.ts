import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_EXPLORER_PRESETS,
  type ContradictionType,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorExplorerQueryRequest,
  type ErrorExplorerQueryResponse,
  type ErrorExplorerRow,
  type ErrorExplorerSource
} from '@/config/errorsexplorer';
import * as production from '@/app/api/errors/explorer/_shared';
import * as oracle from '../oracles/errors-explorer-legacy';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  assertLocalOrRefuse,
  createRecordingExecutor,
  DECOY_CENSUS_ID,
  expectExplorerEqual,
  FIRST_CENSUS_ID,
  FIXTURE_MESSAGES,
  generateEquivalenceFixture,
  MAIN_PLOT_ID,
  openFixtureDatabase,
  replaceFixture,
  resolveEquivalenceSeeds,
  SECOND_CENSUS_ID,
  type FixtureDatabase,
  type FixtureMeasurement,
  type GeneratedFixture
} from './helpers/errorsexplorerfixtures';

const EQUIVALENCE_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errequiv`;
const SEED_TEST_TIMEOUT_MS = 10 * 60 * 1000;
const PAGE_SIZES: readonly number[] = [10, 25, 100];
const IRREGULAR_PAGES: readonly number[] = [NaN, 1.5, Infinity];
const DERIVATION_PAGE_SIZE = 25;
const WHOLE_LIST_PAGE_SIZE = Number.MAX_SAFE_INTEGER;
const QUICK_SEARCH_VALUES: readonly string[] = ['', '   ', 'T1', 'T12', 't12', 'T12 1', 'condition', 'speciesCode', 'Á'];
const NON_ERROR_ID_COUNT = 10;
const IRREGULAR_MEASUREMENT_IDS: readonly number[] = [NaN, -1, 1.5];
const PAGE_BOUNDARY_PAGE_SIZES: readonly number[] = [10, 25];
const DUPLICATE: ContradictionType = 'duplicate_tag_stem';
const SAME_BATCH: ContradictionType = 'same_batch_conflict';
const FAILED_NO_LOG_CODE = 'failed_no_log';

type OracleExecutor = Parameters<typeof oracle.queryErrorExplorer>[0];
type ProductionExecutor = Parameters<typeof production.queryErrorExplorer>[0];

interface Scope {
  name: string;
  censusID: number;
  censusIDs: number[];
}
interface NamedFilters {
  label: string;
  filters: ErrorExplorerFilters;
  sweepWithSearch: boolean;
}

const SCOPES: readonly Scope[] = [
  { name: 'single census', censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID] },
  { name: 'two-census plot census', censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID] },
  { name: 'empty censusIDs falls back to censusID', censusID: FIRST_CENSUS_ID, censusIDs: [] }
];
const GROUPED_SCOPE = SCOPES[1];
const DEFAULT_FILTERS: ErrorExplorerFilters = oracleFilters({});

function oracleFilters(overrides: Partial<ErrorExplorerFilters>): ErrorExplorerFilters {
  return { source: 'all', exactMessages: [], affectedFields: [], contradictionOnly: false, contradictionTypes: [], quickSearch: '', ...overrides };
}

function scopeCensusArgument(scope: Scope): number | number[] {
  return scope.censusIDs.length ? scope.censusIDs : scope.censusID;
}

function buildFilterGrid(): NamedFilters[] {
  const sources: readonly ErrorExplorerSource[] = ['all', 'validation', 'ingestion'];
  const messages: ReadonlyArray<{ label: string; exactMessages: string[] }> = [
    { label: 'no message', exactMessages: [] },
    { label: 'shared message', exactMessages: [FIXTURE_MESSAGES.shared] },
    { label: 'fallback message', exactMessages: [FIXTURE_MESSAGES.fallbackFields] },
    { label: 'semicolon message', exactMessages: [FIXTURE_MESSAGES.semicolonMessage] },
    { label: 'semicolon-criteria message', exactMessages: [FIXTURE_MESSAGES.semicolonCriteria] },
    { label: 'matches nothing', exactMessages: [FIXTURE_MESSAGES.matchesNothing] }
  ];
  const fields: ReadonlyArray<{ label: string; affectedFields: string[] }> = [
    { label: 'no field', affectedFields: [] },
    { label: 'one field', affectedFields: ['speciesCode'] },
    { label: 'two fields', affectedFields: ['treeTag', 'measuredDBH'] }
  ];
  const contradictions: ReadonlyArray<{ label: string; contradictionOnly: boolean; contradictionTypes: ContradictionType[] }> = [
    { label: 'contradictions off', contradictionOnly: false, contradictionTypes: [] },
    { label: 'contradictions only', contradictionOnly: true, contradictionTypes: [] },
    { label: 'duplicates only', contradictionOnly: true, contradictionTypes: [DUPLICATE] },
    { label: 'same-batch only', contradictionOnly: true, contradictionTypes: [SAME_BATCH] },
    { label: 'both types', contradictionOnly: true, contradictionTypes: [DUPLICATE, SAME_BATCH] }
  ];
  const presets = ERROR_EXPLORER_PRESETS.map(preset => ({
    label: `preset ${preset.id}`,
    filters: oracleFilters({
      ...preset.filters,
      exactMessages: [...preset.filters.exactMessages],
      affectedFields: [...preset.filters.affectedFields],
      contradictionTypes: [...preset.filters.contradictionTypes]
    }),
    sweepWithSearch: true
  }));
  const grid: NamedFilters[] = [];
  for (const source of sources)
    for (const message of messages)
      for (const field of fields)
        for (const contradiction of contradictions) {
          grid.push({
            label: `${source} | ${message.label} | ${field.label} | ${contradiction.label}`,
            filters: oracleFilters({
              source,
              exactMessages: message.exactMessages,
              affectedFields: field.affectedFields,
              contradictionOnly: contradiction.contradictionOnly,
              contradictionTypes: contradiction.contradictionTypes
            }),
            sweepWithSearch:
              source === 'all' && message.label === 'shared message' && field.label === 'no field' && contradiction.label === 'contradictions off'
          });
        }
  const irregular: NamedFilters[] = [
    {
      label: 'exactMessages given as a string',
      filters: oracleFilters({ exactMessages: FIXTURE_MESSAGES.tagMismatch as unknown as string[] }),
      sweepWithSearch: false
    },
    { label: 'unknown source', filters: oracleFilters({ source: 'bogus' as ErrorExplorerSource }), sweepWithSearch: false }
  ];
  return [...presets, ...grid, ...irregular];
}

const FILTER_GRID = buildFilterGrid();

function pagesFor(totalRows: number, pageSize: number): number[] {
  const lastPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  return [...Array.from({ length: lastPage + 2 }, (_, page) => page), ...IRREGULAR_PAGES];
}

function sliceOracleWholeList(whole: ErrorExplorerQueryResponse, page: number, pageSize: number): ErrorExplorerQueryResponse {
  const start = page * pageSize;
  return { rows: whole.rows.slice(start, start + pageSize), totalRows: whole.totalRows, summary: whole.summary };
}

interface CoverageContext {
  fixture: GeneratedFixture;
  rows: ErrorExplorerRow[];
  rowIDs: Set<number>;
  rowByID: Map<number, ErrorExplorerRow>;
  measurementByID: Map<number, FixtureMeasurement>;
}
interface CoverageCase {
  name: string;
  isCovered: (context: CoverageContext) => boolean;
}

const isNonBlank = (tag: string | null): tag is string => (tag ?? '') !== '';

function groupMeasurements(measurements: FixtureMeasurement[], keyOf: (row: FixtureMeasurement) => string | null): FixtureMeasurement[][] {
  const groups = new Map<string, FixtureMeasurement[]>();
  measurements.forEach(row => {
    const key = keyOf(row);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return [...groups.values()];
}

function duplicateGroups(fixture: GeneratedFixture): FixtureMeasurement[][] {
  return groupMeasurements(fixture.measurements, row =>
    isNonBlank(row.treeTag) && isNonBlank(row.stemTag) ? JSON.stringify([row.plotID, row.censusID, row.treeTag, row.stemTag]) : null
  ).filter(group => group.length > 1);
}

function sameBatchGroups(fixture: GeneratedFixture): FixtureMeasurement[][] {
  return groupMeasurements(fixture.measurements, row =>
    isNonBlank(row.treeTag) && row.uploadFileID !== null && row.uploadBatchID !== null && row.isActive
      ? JSON.stringify([row.plotID, row.censusID, row.uploadFileID, row.uploadBatchID, row.treeTag])
      : null
  ).filter(group => group.length > 1);
}

const flagsOf = (context: CoverageContext, measurement: FixtureMeasurement): ContradictionType[] =>
  context.rowByID.get(measurement.coreMeasurementID)?.contradictionTypes ?? [];

const COVERAGE_CASES: readonly CoverageCase[] = [
  { name: 'a ";" message on an active unresolved log', isCovered: ({ rows }) => rows.some(row => row.errorMessages.some(message => message.includes(';'))) },
  {
    name: 'a stale summary row in the error set',
    isCovered: ({ rows, measurementByID }) =>
      rows.some(row => {
        const measurement = measurementByID.get(Number(row.coreMeasurementID));
        return measurement !== undefined && measurement.coreIsValidated !== measurement.summaryIsValidated;
      })
  },
  { name: 'a failed row in the error set', isCovered: ({ rows }) => rows.some(row => row.isFailedRow) },
  { name: 'a NULL-date error row', isCovered: ({ rows }) => rows.some(row => row.measurementDate === null) },
  {
    name: 'an inactive duplicate member that alone makes its active mate a duplicate',
    isCovered: context =>
      duplicateGroups(context.fixture).some(group => {
        const activeMembers = group.filter(member => member.isActive);
        return group.length > activeMembers.length && activeMembers.length === 1 && flagsOf(context, activeMembers[0]).includes(DUPLICATE);
      })
  },
  {
    name: 'a duplicate group with exactly one error member',
    isCovered: context =>
      duplicateGroups(context.fixture).some(
        group =>
          group.filter(member => context.rowIDs.has(member.coreMeasurementID)).length === 1 &&
          group.some(member => flagsOf(context, member).includes(DUPLICATE))
      )
  },
  {
    name: 'a tree tag with only one of two stem tags duplicated',
    isCovered: context =>
      groupMeasurements(context.fixture.measurements, row => (isNonBlank(row.treeTag) ? JSON.stringify([row.plotID, row.censusID, row.treeTag]) : null)).some(
        treeGroup => {
          const stemGroups = groupMeasurements(treeGroup, row => (isNonBlank(row.stemTag) ? row.stemTag : null));
          const duplicatedStemFlagged = stemGroups.some(
            stemGroup => stemGroup.length > 1 && stemGroup.some(member => flagsOf(context, member).includes(DUPLICATE))
          );
          const uniqueStemInErrorSet = stemGroups.some(
            stemGroup => stemGroup.length === 1 && context.rowIDs.has(stemGroup[0].coreMeasurementID) && !flagsOf(context, stemGroup[0]).includes(DUPLICATE)
          );
          return duplicatedStemFlagged && uniqueStemInErrorSet;
        }
      )
  },
  {
    name: 'an agreeing same-batch group without a flag',
    isCovered: context =>
      sameBatchGroups(context.fixture).some(
        group =>
          new Set(group.map(member => (member.speciesCode ?? '').toLowerCase())).size === 1 &&
          group.some(member => context.rowIDs.has(member.coreMeasurementID)) &&
          group.every(member => !flagsOf(context, member).includes(SAME_BATCH))
      )
  },
  { name: 'a conflicting same-batch group with a flag', isCovered: ({ rows }) => rows.some(row => row.contradictionTypes.includes(SAME_BATCH)) },
  { name: 'case-variant species codes', isCovered: ({ rows }) => ['AAA', 'aaa'].every(code => rows.some(row => row.speciesCode === code)) },
  { name: 'NULL, empty and space-only tree tags', isCovered: ({ rows }) => [undefined, '', ' '].every(tag => rows.some(row => row.treeTag === tag)) },
  { name: 'NULL, empty and space-only stem tags', isCovered: ({ rows }) => [undefined, '', ' '].every(tag => rows.some(row => row.stemTag === tag)) },
  {
    name: 'a resolved-only log that leaves the measurement in the error set',
    isCovered: context =>
      context.fixture.measurements.some(measurement => {
        const logs = context.fixture.logs.filter(log => log.measurementID === measurement.coreMeasurementID);
        return (
          logs.length > 0 &&
          logs.every(log => log.isResolved) &&
          context.rowByID.get(measurement.coreMeasurementID)?.errorCodes.includes(FAILED_NO_LOG_CODE) === true
        );
      })
  },
  {
    name: 'a resolved-only log that leaves the measurement out of the error set',
    isCovered: context =>
      context.rowIDs.size > 0 &&
      context.fixture.measurements.some(measurement => {
        const logs = context.fixture.logs.filter(log => log.measurementID === measurement.coreMeasurementID);
        return logs.length > 0 && logs.every(log => log.isResolved) && measurement.isActive && !context.rowIDs.has(measurement.coreMeasurementID);
      })
  },
  {
    name: 'IsValidated NULL in the error set',
    isCovered: ({ rows, measurementByID }) => rows.some(row => measurementByID.get(Number(row.coreMeasurementID))?.summaryIsValidated === null)
  },
  {
    name: 'a page-boundary tie',
    isCovered: ({ rows }) =>
      PAGE_BOUNDARY_PAGE_SIZES.some(pageSize =>
        Array.from({ length: Math.floor((rows.length - 1) / pageSize) }, (_, index) => (index + 1) * pageSize).some(edge => {
          const before = rows[edge - 1];
          const after = rows[edge];
          return (
            before.hasContradiction === after.hasContradiction && before.errorCount === after.errorCount && before.measurementDate === after.measurementDate
          );
        })
      )
  },
  { name: 'an error row with no duplicate and no same-batch flag', isCovered: ({ rows }) => rows.some(row => row.contradictionTypes.length === 0) },
  {
    name: 'an error row with only the duplicate flag',
    isCovered: ({ rows }) => rows.some(row => row.contradictionTypes.includes(DUPLICATE) && !row.contradictionTypes.includes(SAME_BATCH))
  },
  {
    name: 'an error row with only the same-batch flag',
    isCovered: ({ rows }) => rows.some(row => row.contradictionTypes.includes(SAME_BATCH) && !row.contradictionTypes.includes(DUPLICATE))
  },
  {
    name: 'an error row with both flags',
    isCovered: ({ rows }) => rows.some(row => row.contradictionTypes.includes(DUPLICATE) && row.contradictionTypes.includes(SAME_BATCH))
  }
];

function findUncoveredCases(fixture: GeneratedFixture, rows: ErrorExplorerRow[]): string[] {
  const context: CoverageContext = {
    fixture,
    rows,
    rowIDs: new Set(rows.map(row => Number(row.coreMeasurementID))),
    rowByID: new Map(rows.map(row => [Number(row.coreMeasurementID), row])),
    measurementByID: new Map(fixture.measurements.map(measurement => [measurement.coreMeasurementID, measurement]))
  };
  return COVERAGE_CASES.filter(coverageCase => !coverageCase.isCovered(context)).map(coverageCase => coverageCase.name);
}

describe('errors explorer: frozen oracle against production on generated data', () => {
  let fixtureDatabase: FixtureDatabase | null = null;

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await openFixtureDatabase(EQUIVALENCE_DATABASE);
  });

  afterAll(async () => {
    const opened = fixtureDatabase;
    fixtureDatabase = null;
    await opened?.teardown();
  });

  describe.each(resolveEquivalenceSeeds())('seed %i', seed => {
    let fixture: GeneratedFixture;
    let apiCalls = 0;
    let statementCount = 0;
    const wholeListCache = new Map<string, Promise<ErrorExplorerQueryResponse>>();

    const database = () => (fixtureDatabase as FixtureDatabase).database;
    const explorerConnection = () => (fixtureDatabase as FixtureDatabase).explorerConnection;
    const countingExecutor = () => ({
      executeQuery: async (sql: string, params?: unknown[]) => {
        statementCount++;
        return runQueryDispatch(explorerConnection(), sql, params);
      }
    });
    const oracleExecutor = (): OracleExecutor => countingExecutor();
    const productionExecutor = (): ProductionExecutor => countingExecutor() as unknown as ProductionExecutor;
    const witnessIDs = () => new Set(fixture.witnessRowIDs);

    const queryRequest = (scope: Scope, filters: ErrorExplorerFilters, page: number, pageSize: number): ErrorExplorerQueryRequest => ({
      schema: database(),
      plotID: MAIN_PLOT_ID,
      censusID: scope.censusID,
      censusIDs: scope.censusIDs,
      page,
      pageSize,
      filters
    });
    const facetRequest = (scope: Scope, filters: ErrorExplorerFilters) => ({
      schema: database(),
      plotID: MAIN_PLOT_ID,
      censusID: scope.censusID,
      censusIDs: scope.censusIDs,
      filters
    });

    const oracleWholeList = (scope: Scope, filters: ErrorExplorerFilters): Promise<ErrorExplorerQueryResponse> => {
      const cacheKey = JSON.stringify([scope.name, filters]);
      const cached = wholeListCache.get(cacheKey);
      if (cached) return cached;
      apiCalls++;
      const pending = oracle.queryErrorExplorer(oracleExecutor(), queryRequest(scope, filters, 0, WHOLE_LIST_PAGE_SIZE));
      wholeListCache.set(cacheKey, pending);
      return pending;
    };

    const compare = (context: Record<string, unknown>, actual: unknown, expected: unknown) =>
      expectExplorerEqual(explorerConnection(), { seed, ...context }, actual, expected, witnessIDs());

    const runTimed = async (api: string, body: () => Promise<void>) => {
      apiCalls = 0;
      statementCount = 0;
      const startedAt = performance.now();
      await body();
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      console.log(`[equivalence] seed=${seed} api=${api} calls=${apiCalls} statements=${statementCount} seconds=${seconds}`);
    };

    beforeAll(async () => {
      fixture = generateEquivalenceFixture(seed);
      wholeListCache.clear();
      await replaceFixture((fixtureDatabase as FixtureDatabase).setupConnection, fixture);
      console.log(
        `[equivalence] seed=${seed} measurements=${fixture.measurements.length} logs=${fixture.logs.length} witness=${fixture.witnessRowIDs.join(',')}`
      );
    });

    it('generator covers every planted case', async () => {
      const whole = await oracleWholeList(GROUPED_SCOPE, DEFAULT_FILTERS);
      const uncovered = findUncoveredCases(fixture, whole.rows);
      console.log(`[coverage] seed=${seed} errorSetRows=${whole.rows.length} uncovered=${JSON.stringify(uncovered)}`);
      expect(uncovered.map(name => `generator did not cover ${name}`)).toEqual([]);
    });

    it('witness rows share one duplicate group whose keys differ byte-wise but not under the collation', async () => {
      const whole = await production.queryErrorExplorer(productionExecutor(), queryRequest(SCOPES[0], DEFAULT_FILTERS, 0, WHOLE_LIST_PAGE_SIZE));
      const witnessRows = whole.rows.filter(row => fixture.witnessRowIDs.includes(Number(row.coreMeasurementID)));
      const witnessTags = fixture.measurements.filter(row => fixture.witnessRowIDs.includes(row.coreMeasurementID)).map(row => row.treeTag);
      console.log(`[witness] seed=${seed} tags=${JSON.stringify(witnessTags)} keys=${JSON.stringify(witnessRows.map(row => row.contradictionGroupKey))}`);

      expect(new Set(witnessTags).size).toBe(fixture.witnessRowIDs.length);
      expect(witnessRows).toHaveLength(fixture.witnessRowIDs.length);
      witnessRows.forEach(row => {
        expect(row.contradictionType).toBe(DUPLICATE);
        expect([...row.relatedMeasurementIDs].sort((a, b) => a - b)).toEqual(
          fixture.witnessRowIDs.filter(id => id !== row.coreMeasurementID).sort((a, b) => a - b)
        );
      });
      const [firstKey, ...otherKeys] = witnessRows.map(row => row.contradictionGroupKey as string);
      for (const otherKey of otherKeys) {
        const [rows] = await explorerConnection().query('SELECT ? = ? COLLATE utf8mb4_0900_ai_ci AS same', [firstKey, otherKey]);
        expect((rows as Array<{ same: number }>)[0].same).toBe(1);
      }
    });

    it('the comparison fails when production differs from the oracle', async () => {
      const whole = await oracleWholeList(GROUPED_SCOPE, DEFAULT_FILTERS);
      expect(whole.rows.length).toBeGreaterThan(2);
      const changedField = { ...whole, rows: whole.rows.map((row, index) => (index === 1 ? { ...row, errorCount: row.errorCount + 1 } : row)) };
      const droppedRow = { ...whole, rows: whole.rows.slice(1) };
      const changedSummary = { ...whole, summary: { ...whole.summary, total: whole.summary.total + 1 } };
      const changedGroupKeyOutsideWitness = {
        ...whole,
        rows: whole.rows.map(row =>
          row.contradictionGroupKey !== null && !fixture.witnessRowIDs.includes(Number(row.coreMeasurementID))
            ? { ...row, contradictionGroupKey: `${row.contradictionGroupKey}x` }
            : row
        )
      };

      const mutations: Array<{ name: string; mutated: unknown; expectedPath: string }> = [
        { name: 'a changed field', mutated: changedField, expectedPath: '$.rows[1].errorCount' },
        { name: 'a dropped row', mutated: droppedRow, expectedPath: '$.rows.length' },
        { name: 'a changed summary', mutated: changedSummary, expectedPath: '$.summary.total' },
        { name: 'a changed group key outside the witness rows', mutated: changedGroupKeyOutsideWitness, expectedPath: 'contradictionGroupKey' }
      ];
      for (const { name, mutated, expectedPath } of mutations) {
        const error = await expectExplorerEqual(explorerConnection(), { seed, scenario: name }, mutated, whole, witnessIDs()).then(
          () => null,
          (caught: Error) => caught
        );
        console.log(`[harness can fail] ${name}: ${error?.message.split('\n')[2] ?? 'NOT DETECTED'}`);
        expect(error, `${name} must be detected`).not.toBeNull();
        expect(error?.message).toContain(`seed: ${seed}`);
        expect(error?.message).toContain(expectedPath);
      }
    });

    it(
      'queryErrorExplorer: every filter, scope, page size and page',
      async () =>
        runTimed('queryErrorExplorer', async () => {
          for (const scope of SCOPES) {
            for (const preset of FILTER_GRID.slice(0, ERROR_EXPLORER_PRESETS.length)) {
              const whole = await oracleWholeList(scope, preset.filters);
              for (const page of pagesFor(whole.totalRows, DERIVATION_PAGE_SIZE)) {
                apiCalls++;
                const oraclePage = await oracle.queryErrorExplorer(oracleExecutor(), queryRequest(scope, preset.filters, page, DERIVATION_PAGE_SIZE));
                await compare(
                  { scenario: 'oracle per page against its whole-list slice', scope: scope.name, filters: preset.label, page, pageSize: DERIVATION_PAGE_SIZE },
                  sliceOracleWholeList(whole, page, DERIVATION_PAGE_SIZE),
                  oraclePage
                );
              }
            }
            for (const { label, filters } of FILTER_GRID) {
              const whole = await oracleWholeList(scope, filters);
              for (const pageSize of PAGE_SIZES) {
                for (const page of pagesFor(whole.totalRows, pageSize)) {
                  apiCalls++;
                  const actual = await production.queryErrorExplorer(productionExecutor(), queryRequest(scope, filters, page, pageSize));
                  await compare(
                    { scenario: 'queryErrorExplorer', scope: scope.name, filters: label, filterValues: filters, page, pageSize },
                    actual,
                    sliceOracleWholeList(whole, page, pageSize)
                  );
                }
              }
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );

    it(
      'queryErrorExplorer with quick search: every filter, scope and search value',
      async () =>
        runTimed('queryErrorExplorer quick search', async () => {
          for (const scope of SCOPES) {
            for (const { label, filters, sweepWithSearch } of FILTER_GRID) {
              for (const quickSearch of QUICK_SEARCH_VALUES) {
                const searchFilters = { ...filters, quickSearch };
                const whole = await oracleWholeList(scope, searchFilters);
                apiCalls++;
                const actualWhole = await production.queryErrorExplorer(productionExecutor(), queryRequest(scope, searchFilters, 0, WHOLE_LIST_PAGE_SIZE));
                await compare(
                  {
                    scenario: 'quick search whole list',
                    scope: scope.name,
                    filters: label,
                    filterValues: searchFilters,
                    quickSearch,
                    page: 0,
                    pageSize: WHOLE_LIST_PAGE_SIZE
                  },
                  actualWhole,
                  whole
                );
                if (!sweepWithSearch) continue;
                for (const pageSize of PAGE_SIZES) {
                  for (const page of pagesFor(whole.totalRows, pageSize)) {
                    apiCalls++;
                    const actual = await production.queryErrorExplorer(productionExecutor(), queryRequest(scope, searchFilters, page, pageSize));
                    await compare(
                      { scenario: 'quick search page', scope: scope.name, filters: label, filterValues: searchFilters, quickSearch, page, pageSize },
                      actual,
                      sliceOracleWholeList(whole, page, pageSize)
                    );
                  }
                }
              }
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );

    it(
      'buildErrorExplorerFacets: every filter, scope and search value',
      async () =>
        runTimed('buildErrorExplorerFacets', async () => {
          for (const scope of SCOPES) {
            for (const { label, filters } of FILTER_GRID) {
              for (const quickSearch of QUICK_SEARCH_VALUES) {
                const searchFilters = { ...filters, quickSearch };
                apiCalls += 2;
                const expected = await oracle.buildErrorExplorerFacets(oracleExecutor(), facetRequest(scope, searchFilters));
                const actual = await production.buildErrorExplorerFacets(productionExecutor(), facetRequest(scope, searchFilters));
                await compare(
                  { scenario: 'buildErrorExplorerFacets', scope: scope.name, filters: label, filterValues: searchFilters, quickSearch },
                  actual,
                  expected
                );
              }
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );

    it('buildErrorExplorerFacets lists the semicolon message as one whole value', async () => {
      const facets: ErrorExplorerFacetsResponse = await production.buildErrorExplorerFacets(productionExecutor(), facetRequest(GROUPED_SCOPE, DEFAULT_FILTERS));
      const messageValues = facets.messages.map(option => option.value);
      console.log(`[facets] seed=${seed} messages=${JSON.stringify(messageValues)}`);
      expect(messageValues).toContain(FIXTURE_MESSAGES.semicolonMessage);
      expect(messageValues.filter(value => value.includes('condition'))).toEqual([FIXTURE_MESSAGES.semicolonMessage]);
    });

    it(
      'buildErrorMessageCounts: one census, the two-census list and an empty list',
      async () =>
        runTimed('buildErrorMessageCounts', async () => {
          for (const censusIDs of [[FIRST_CENSUS_ID], [FIRST_CENSUS_ID, SECOND_CENSUS_ID], []]) {
            const oracleRecorder = createRecordingExecutor(explorerConnection());
            const productionRecorder = createRecordingExecutor(explorerConnection());
            const request = { schema: database(), plotID: MAIN_PLOT_ID, censusIDs };
            apiCalls += 2;
            const expected = await oracle.buildErrorMessageCounts(oracleRecorder, request);
            const actual = await production.buildErrorMessageCounts(productionRecorder as unknown as ProductionExecutor, request);
            statementCount += oracleRecorder.statements.length + productionRecorder.statements.length;
            await compare({ scenario: 'buildErrorMessageCounts', censusIDs }, actual, expected);
            if (censusIDs.length === 0) {
              expect(oracleRecorder.statements, 'oracle statements for an empty census list').toHaveLength(0);
              expect(productionRecorder.statements, 'production statements for an empty census list').toHaveLength(0);
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );

    it(
      'buildErrorExplorerDetails: every error-set id, non-error ids, the other plot and irregular ids',
      async () =>
        runTimed('buildErrorExplorerDetails', async () => {
          const errorSetIDs = (await oracleWholeList(GROUPED_SCOPE, DEFAULT_FILTERS)).rows.map(row => Number(row.coreMeasurementID));
          const errorSet = new Set(errorSetIDs);
          const nonErrorIDs = fixture.measurements
            .filter(row => row.plotID === MAIN_PLOT_ID && !errorSet.has(row.coreMeasurementID))
            .slice(0, NON_ERROR_ID_COUNT)
            .map(row => row.coreMeasurementID);
          const otherPlotID = fixture.measurements.find(row => row.censusID === DECOY_CENSUS_ID)?.coreMeasurementID as number;
          const measurementIDs = [...errorSetIDs, ...nonErrorIDs, otherPlotID, ...IRREGULAR_MEASUREMENT_IDS];
          const activeTypes: Array<ContradictionType | undefined> = [undefined, DUPLICATE, SAME_BATCH];
          console.log(`[details] seed=${seed} errorSetIDs=${errorSetIDs.length} nonErrorIDs=${nonErrorIDs.length} otherPlotID=${otherPlotID}`);
          expect(nonErrorIDs).toHaveLength(NON_ERROR_ID_COUNT);

          for (const censusID of [FIRST_CENSUS_ID, SECOND_CENSUS_ID]) {
            const request = { schema: database(), plotID: MAIN_PLOT_ID, censusID };
            for (const measurementID of measurementIDs) {
              for (const activeType of activeTypes) {
                apiCalls += 2;
                const expected = await oracle.buildErrorExplorerDetails(oracleExecutor(), request, measurementID, activeType);
                const actual = await production.buildErrorExplorerDetails(productionExecutor(), request, measurementID, activeType);
                await compare(
                  { scenario: 'buildErrorExplorerDetails', censusID, measurementID, activeContradictionType: activeType ?? null },
                  actual,
                  expected
                );
              }
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );

    it(
      'buildErrorExportRows: the presets and the semicolon message filter',
      async () =>
        runTimed('buildErrorExportRows', async () => {
          const exportFilters: NamedFilters[] = [
            ...FILTER_GRID.slice(0, ERROR_EXPLORER_PRESETS.length),
            { label: 'semicolon message', filters: oracleFilters({ exactMessages: [FIXTURE_MESSAGES.semicolonMessage] }), sweepWithSearch: false }
          ];
          for (const scope of SCOPES) {
            const censusArgument = scopeCensusArgument(scope);
            for (const { label, filters } of exportFilters) {
              apiCalls += 2;
              const expected = oracle.buildErrorExportRows(
                await oracle.fetchGroupedErrorRows(oracleExecutor(), database(), MAIN_PLOT_ID, censusArgument),
                filters
              );
              const actual = production.buildErrorExportRows(
                await production.fetchGroupedErrorRows(productionExecutor(), database(), MAIN_PLOT_ID, censusArgument),
                filters
              );
              await compare({ scenario: 'buildErrorExportRows', scope: scope.name, filters: label }, actual, expected);
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );
  });

  describe('coverage assertion can fail', () => {
    const fixture = generateEquivalenceFixture(resolveEquivalenceSeeds()[0]);

    it('reports every case as uncovered when the oracle returned no error rows', () => {
      const uncovered = findUncoveredCases(fixture, []);
      expect(uncovered).toEqual(COVERAGE_CASES.map(coverageCase => coverageCase.name));
    });

    it('reports the stale-summary case when no row in the error set is stale', () => {
      const freshFixture: GeneratedFixture = {
        ...fixture,
        measurements: fixture.measurements.map(row => ({ ...row, coreIsValidated: row.summaryIsValidated }))
      };
      const row = {
        coreMeasurementID: fixture.measurements[0].coreMeasurementID,
        contradictionTypes: [],
        errorMessages: [],
        errorCodes: []
      } as unknown as ErrorExplorerRow;
      expect(findUncoveredCases(freshFixture, [row])).toContain('a stale summary row in the error set');
    });
  });
});
