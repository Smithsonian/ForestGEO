import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { toSliceBounds } from '@/app/api/errors/explorer/errorsetcounts';
import {
  CENSUS_LIST_SIZE,
  ERROR_EXPLORER_STATEMENT_LABELS,
  NO_LOG_ERROR_CODE,
  NO_LOG_ERROR_MESSAGE,
  NO_LOG_ERROR_SOURCE
} from '@/app/api/errors/explorer/errorsetsql';
import * as oracle from '../oracles/errors-explorer-legacy';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  assertLocalOrRefuse,
  ATTRIBUTES_ONLY_TOKEN,
  createRecordingExecutor,
  DECOY_CENSUS_ID,
  DECOY_PLOT_ID,
  expectExplorerEqual,
  FIRST_CENSUS_ID,
  FIXTURE_MESSAGES,
  generateEquivalenceFixture,
  MAIN_PLOT_ID,
  createFixtureDatabaseSession,
  FIXTURE_HOOK_TIMEOUT_MS,
  replaceFixture,
  resolveEquivalenceSeeds,
  SECOND_CENSUS_ID,
  WITNESS_ERROR_STEM_TAGS,
  WITNESS_NON_ERROR_STEM_TAG,
  WITNESS_NON_ERROR_TREE_TAG,
  WITNESS_SAME_BATCH_ERROR_TREE_TAGS,
  WITNESS_SAME_BATCH_NON_ERROR_TREE_TAG,
  WITNESS_STEM_TAG,
  WITNESS_STEM_VARIANT_TREE_TAG,
  WITNESS_TREE_TAGS,
  SINGLE_ERROR_SAME_BATCH_PAIR,
  SINGLE_ERROR_STEM_PAIR_TREE_TAG,
  SINGLE_ERROR_STEM_TAG_PAIR,
  SINGLE_ERROR_TREE_TAG_PAIR,
  ACCENT_ONLY_TREE_TAG_PAIR,
  type FixtureDatabase,
  type FixtureMeasurement,
  type GeneratedFixture,
  type RecordedStatement
} from './helpers/errorsexplorerfixtures';

const EQUIVALENCE_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errequiv`;
const SEED_TEST_TIMEOUT_MS = 10 * 60 * 1000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const EQUIVALENCE_FILE_RUNTIME_LIMIT_MINUTES = 35;
const EQUIVALENCE_FILE_RUNTIME_LIMIT_MS = EQUIVALENCE_FILE_RUNTIME_LIMIT_MINUTES * MILLISECONDS_PER_MINUTE;
const PAGE_SIZES: readonly number[] = [10, 25, 100];
const IRREGULAR_PAGES: readonly number[] = [NaN, 1.5, Infinity];
const DERIVATION_PAGE_SIZE = 25;
const WHOLE_LIST_PAGE_SIZE = Number.MAX_SAFE_INTEGER;
const QUICK_SEARCH_VALUES: readonly string[] = ['', '   ', 'T1', 'T12', 't12', 'T12 1', 'condition', 'speciesCode', 'Á', ATTRIBUTES_ONLY_TOKEN];
const MATCHES_NOTHING_AXIS = 'message:matches nothing';
const NO_LOG_AXIS = 'message:no-log fallback message';
const FOREIGN_TAG_SPELLING = 'Zb1';
const FOREIGN_STEM_SPELLING = 'Zz';
const NON_ERROR_ID_COUNT = 10;
const IRREGULAR_MEASUREMENT_IDS: readonly number[] = [NaN, -1, 1.5];
const PAGE_BOUNDARY_PAGE_SIZES: readonly number[] = [10, 25];
const DUPLICATE: ContradictionType = 'duplicate_tag_stem';
const SAME_BATCH: ContradictionType = 'same_batch_conflict';
const FAILED_NO_LOG_CODE = 'failed_no_log';
const LABELS = ERROR_EXPLORER_STATEMENT_LABELS;
const STATEMENT_SHAPE_COUNT = Object.keys(LABELS).length;
const KNOWN_STATEMENT_LABELS: ReadonlySet<string> = new Set(Object.values(LABELS));
const DETAILS_STATEMENT_LABELS: ReadonlySet<string> = new Set([LABELS.idRawRows, LABELS.duplicateMemberGroups, LABELS.sameBatchMemberGroups]);
const SQL_QUERY_STATEMENT_LABELS: ReadonlySet<string> = new Set([
  LABELS.catalog,
  LABELS.page,
  LABELS.totals,
  LABELS.idRawRows,
  LABELS.duplicateMemberGroups,
  LABELS.sameBatchMemberGroups
]);
const PAGE_WINDOW_PARAM_COUNT = 2;
const MEMBER_GROUP_KINDS_PER_ROW = 2;
const BLANK_SEARCH = '';
/** Every raw-rows statement and the catalog bind these three as the display fallback for a measurement without a log, whatever the filters are. */
const FALLBACK_DISPLAY_PARAMS: ReadonlySet<unknown> = new Set([NO_LOG_ERROR_SOURCE, NO_LOG_ERROR_CODE, NO_LOG_ERROR_MESSAGE]);

type OracleExecutor = Parameters<typeof oracle.queryErrorExplorer>[0];
type ProductionExecutor = Parameters<typeof production.queryErrorExplorer>[0];

interface Scope {
  name: string;
  plotID: number;
  censusID: number;
  censusIDs: number[];
}
interface NamedFilters {
  label: string;
  filters: ErrorExplorerFilters;
  sweepWithSearch: boolean;
  axes: string[];
}

const SCOPES: readonly Scope[] = [
  { name: 'single census', plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID] },
  { name: 'two-census plot census', plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID, SECOND_CENSUS_ID] },
  { name: 'empty censusIDs falls back to censusID', plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [] }
];
const PLOT_SCOPES: readonly Scope[] = [
  { name: 'plot 2 on its own census', plotID: DECOY_PLOT_ID, censusID: DECOY_CENSUS_ID, censusIDs: [DECOY_CENSUS_ID] },
  { name: 'plot 1 asked for the other plot census', plotID: MAIN_PLOT_ID, censusID: DECOY_CENSUS_ID, censusIDs: [DECOY_CENSUS_ID] },
  { name: 'plot 2 asked for the first census', plotID: DECOY_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID] }
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
    { label: 'type 5 message', exactMessages: [FIXTURE_MESSAGES.fallbackFields] },
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
    sweepWithSearch: true,
    axes: [`preset:${preset.id}`]
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
              source === 'all' && message.label === 'shared message' && field.label === 'no field' && contradiction.label === 'contradictions off',
            axes: [`source:${source}`, `message:${message.label}`, `fields:${field.label}`, `contradiction:${contradiction.label}`]
          });
        }
  const noLogMessage: NamedFilters[] = [];
  for (const source of sources)
    for (const contradiction of contradictions.slice(0, 2)) {
      noLogMessage.push({
        label: `${source} | no-log fallback message | no field | ${contradiction.label}`,
        filters: oracleFilters({
          source,
          exactMessages: [FIXTURE_MESSAGES.noLogFallback],
          contradictionOnly: contradiction.contradictionOnly,
          contradictionTypes: contradiction.contradictionTypes
        }),
        sweepWithSearch: false,
        axes: [`source:${source}`, NO_LOG_AXIS, 'fields:no field', `contradiction:${contradiction.label}`]
      });
    }
  const supplementaryContradictions: ReadonlyArray<{ label: string; contradictionOnly: boolean; contradictionTypes: ContradictionType[] }> = [
    { label: 'types without the contradictions-only box: duplicates', contradictionOnly: false, contradictionTypes: [DUPLICATE] },
    { label: 'types without the contradictions-only box: same-batch', contradictionOnly: false, contradictionTypes: [SAME_BATCH] },
    { label: 'types without the contradictions-only box: duplicates then same-batch', contradictionOnly: false, contradictionTypes: [DUPLICATE, SAME_BATCH] },
    { label: 'types without the contradictions-only box: same-batch then duplicates', contradictionOnly: false, contradictionTypes: [SAME_BATCH, DUPLICATE] },
    { label: 'contradictions only: same-batch then duplicates', contradictionOnly: true, contradictionTypes: [SAME_BATCH, DUPLICATE] }
  ];
  const supplementary: NamedFilters[] = supplementaryContradictions.map(contradiction => ({
    label: `all | no message | no field | ${contradiction.label}`,
    filters: oracleFilters({ contradictionOnly: contradiction.contradictionOnly, contradictionTypes: contradiction.contradictionTypes }),
    sweepWithSearch: false,
    axes: [`contradiction:${contradiction.label}`]
  }));
  const irregular: NamedFilters[] = [
    {
      label: 'exactMessages given as a string',
      filters: oracleFilters({ exactMessages: FIXTURE_MESSAGES.tagMismatch as unknown as string[] }),
      sweepWithSearch: false,
      axes: []
    },
    { label: 'unknown source', filters: oracleFilters({ source: 'bogus' as ErrorExplorerSource }), sweepWithSearch: false, axes: [] }
  ];
  return [...presets, ...grid, ...noLogMessage, ...supplementary, ...irregular];
}

const FILTER_GRID = buildFilterGrid();
const PRESET_FILTERS = FILTER_GRID.slice(0, ERROR_EXPLORER_PRESETS.length);
const NO_LOG_FILTER_LABEL_PART = 'no-log fallback message';
interface ScopedFilters {
  scope: Scope;
  named: NamedFilters;
}
const GRID_COMBINATIONS: ScopedFilters[] = [
  ...SCOPES.flatMap(scope => FILTER_GRID.map(named => ({ scope, named }))),
  ...PLOT_SCOPES.flatMap(scope => PRESET_FILTERS.map(named => ({ scope, named })))
];
const PRESET_COMBINATIONS: ScopedFilters[] = [...SCOPES, ...PLOT_SCOPES].flatMap(scope => PRESET_FILTERS.map(named => ({ scope, named })));

/** A statement that only reads: optional leading comments, then WITH or SELECT. Anything else may change data and so empties the oracle's read cache. */
const READ_STATEMENT_PATTERN = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:WITH|SELECT)\b/i;

/** structuredClone turns a Buffer (the BIT column IsValidated) into a plain object, so the copy is made by hand. */
function copyMySQLValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(copyMySQLValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, copyMySQLValue(member)]));
  }
  return value;
}

interface OracleReadCache {
  hits: number;
  misses: number;
  clear(): void;
  read(sql: string, params: unknown[] | undefined, runOnMySQL: () => Promise<unknown>): Promise<unknown>;
}

/**
 * The oracle re-reads the same error set for every filter, scope and search value. Within one seed the fixture does not change,
 * so identical (sql, params) reads return a copy of the stored rows. Only the oracle's executor uses it; production always goes to MySQL.
 * A write that does not go through the oracle executor (the setup connection, a session change on the explorer connection) must call
 * `oracleReadCache.clear()` first, or the oracle serves rows from before it.
 */
function createOracleReadCache(): OracleReadCache {
  const rowsByStatement = new Map<string, unknown>();
  const cache: OracleReadCache = {
    hits: 0,
    misses: 0,
    clear: () => rowsByStatement.clear(),
    read: async (sql, params, runOnMySQL) => {
      if (!READ_STATEMENT_PATTERN.test(sql)) {
        rowsByStatement.clear();
        return runOnMySQL();
      }
      const key = JSON.stringify([sql, params ?? []]);
      if (rowsByStatement.has(key)) {
        cache.hits++;
        return copyMySQLValue(rowsByStatement.get(key));
      }
      cache.misses++;
      const rows = await runOnMySQL();
      rowsByStatement.set(key, copyMySQLValue(rows));
      return rows;
    }
  };
  return cache;
}

function filterStringsOf(filters: ErrorExplorerFilters): string[] {
  const messages = ([] as string[]).concat(filters.exactMessages);
  return [...messages, ...filters.affectedFields, filters.quickSearch.trim()].filter(value => value !== BLANK_SEARCH);
}

/** The schema name is part of every statement text, so it is cut out before the filter strings are looked for. */
function findFilterStringInStatement(statement: RecordedStatement, schema: string, filterStrings: readonly string[]): string | null {
  const textWithoutSchema = statement.sql.split(schema).join('');
  for (const filterString of filterStrings) {
    if (textWithoutSchema.includes(filterString)) return `the statement text contains "${filterString}"`;
    const matchingParam = statement.params.find(param => typeof param === 'string' && !FALLBACK_DISPLAY_PARAMS.has(param) && param.includes(filterString));
    if (matchingParam !== undefined) return `the parameter ${JSON.stringify(matchingParam)} contains "${filterString}"`;
  }
  return null;
}

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
  },
  {
    name: 'a duplicate group whose tree-tag spellings differ by case and accent, with a non-error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.treeTagVariants, DUPLICATE)
  },
  {
    name: 'a duplicate group whose stem-tag spellings differ by case, with a non-error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.stemTagVariants, DUPLICATE)
  },
  {
    name: 'a same-batch group whose tree-tag spellings differ by case and whose species conflict, with a non-error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.sameBatchVariants, SAME_BATCH)
  },
  {
    name: 'a duplicate pair of case-variant tree tags with exactly one error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.singleErrorTreeTagPair, DUPLICATE)
  },
  {
    name: 'a duplicate pair of tree tags that differ only by an accent, with exactly one error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.accentOnlyTreeTagPair, DUPLICATE)
  },
  {
    name: 'a duplicate pair of case-variant stem tags with exactly one error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.singleErrorStemTagPair, DUPLICATE)
  },
  {
    name: 'a same-batch pair of case-variant tree tags with conflicting species and exactly one error member',
    isCovered: context => variantGroupIsFlagged(context, context.fixture.witnessGroups.singleErrorSameBatchPair, SAME_BATCH)
  },
  {
    name: 'rows of another plot that share a duplicate pair and an agreeing same-batch group with plot 1, left out of both',
    isCovered: context =>
      context.fixture.mismatchedPlotRowIDs.length > 0 &&
      context.fixture.mismatchedPlotRowIDs.every(mismatchedID => isLeftOutOfPlotOneGroups(context, mismatchedID))
  },
  { name: 'an error row whose Attributes alone carry the search token', isCovered: ({ rows }) => rows.some(row => row.attributes === ATTRIBUTES_ONLY_TOKEN) }
];

function isLeftOutOfPlotOneGroups(context: CoverageContext, mismatchedID: number): boolean {
  const mismatched = context.measurementByID.get(mismatchedID);
  if (mismatched === undefined || mismatched.plotID === MAIN_PLOT_ID || context.rowIDs.has(mismatchedID)) return false;
  const plotOneRows = context.fixture.measurements.filter(
    row => row.plotID === MAIN_PLOT_ID && row.censusID === mismatched.censusID && row.treeTag === mismatched.treeTag
  );
  const neverRelated = plotOneRows.every(member => !context.rowByID.get(member.coreMeasurementID)?.relatedMeasurementIDs.includes(mismatchedID));
  if (mismatched.uploadFileID === null) {
    const pair = plotOneRows.filter(row => row.stemTag === mismatched.stemTag);
    return pair.length >= 2 && pair.every(member => flagsOf(context, member).includes(DUPLICATE)) && neverRelated;
  }
  const sameBatchMates = plotOneRows.filter(row => row.uploadFileID === mismatched.uploadFileID && row.uploadBatchID === mismatched.uploadBatchID);
  return (
    sameBatchMates.length >= 2 &&
    sameBatchMates.every(member => context.rowIDs.has(member.coreMeasurementID)) &&
    new Set(sameBatchMates.map(row => (row.speciesCode ?? '').toLowerCase())).size === 1 &&
    sameBatchMates.every(member => !flagsOf(context, member).includes(SAME_BATCH)) &&
    neverRelated
  );
}

function variantGroupIsFlagged(context: CoverageContext, groupIDs: number[], flag: ContradictionType): boolean {
  const errorMemberIDs = groupIDs.slice(0, -1);
  const nonErrorMemberID = groupIDs[groupIDs.length - 1];
  return (
    errorMemberIDs.length > 0 &&
    !context.rowIDs.has(nonErrorMemberID) &&
    errorMemberIDs.every(id => {
      const row = context.rowByID.get(id);
      return row !== undefined && row.contradictionTypes.includes(flag) && row.relatedMeasurementIDs.includes(nonErrorMemberID);
    })
  );
}

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

  const fixtureSession = createFixtureDatabaseSession(EQUIVALENCE_DATABASE);
  const productionStatementLabelByText = new Map<string, string | null>();

  let fileStartedAt = 0;

  beforeAll(async () => {
    assertLocalOrRefuse();
    fileStartedAt = performance.now();
    fixtureDatabase = await fixtureSession.open();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    fixtureDatabase = null;
    await fixtureSession.close();
    const elapsedMs = performance.now() - fileStartedAt;
    console.log(`[equivalence] file seconds=${(elapsedMs / 1000).toFixed(1)} limit seconds=${EQUIVALENCE_FILE_RUNTIME_LIMIT_MS / 1000}`);
    if (elapsedMs > EQUIVALENCE_FILE_RUNTIME_LIMIT_MS) {
      throw new Error(
        `The equivalence file took ${(elapsedMs / MILLISECONDS_PER_MINUTE).toFixed(1)} minutes; the limit is ${EQUIVALENCE_FILE_RUNTIME_LIMIT_MINUTES}`
      );
    }
  }, FIXTURE_HOOK_TIMEOUT_MS);

  describe.each(resolveEquivalenceSeeds())('seed %i', seed => {
    let fixture: GeneratedFixture;
    let apiCalls = 0;
    let statementCount = 0;
    const wholeListCache = new Map<string, Promise<ErrorExplorerQueryResponse>>();
    const axisMaxima = new Map<string, number>();
    const noLogTotals = new Map<string, number>();
    let maxPageStatementRowsPerSlot = 0;
    let maxMemberGroupRowsPerPageRow = 0;
    let sqlPathQueryCount = 0;

    const database = () => (fixtureDatabase as FixtureDatabase).database;
    const explorerConnection = () => (fixtureDatabase as FixtureDatabase).explorerConnection;
    const countingExecutor = () => ({
      executeQuery: async (sql: string, params?: unknown[]) => {
        statementCount++;
        return runQueryDispatch(explorerConnection(), sql, params);
      }
    });
    const oracleReadCache = createOracleReadCache();
    const oracleExecutor = (): OracleExecutor => ({
      executeQuery: (sql: string, params?: unknown[]) => oracleReadCache.read(sql, params, () => countingExecutor().executeQuery(sql, params))
    });
    const productionExecutor = (): ProductionExecutor => countingExecutor() as unknown as ProductionExecutor;
    const witnessIDs = () => new Set(fixture.witnessRowIDs);

    const recordProduction = async <Result>(run: (executor: ProductionExecutor) => Promise<Result>) => {
      const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });
      const result = await run(recorder as unknown as ProductionExecutor);
      statementCount += recorder.statements.length;
      return { result, statements: recorder.statements };
    };

    const failStatementCheck = (context: Record<string, unknown>, statement: RecordedStatement, reason: string): never => {
      const message = [
        `[statement assertion] seed ${seed}: ${reason}`,
        `  context: ${JSON.stringify(context)}`,
        `  label: ${statement.label}`,
        `  sql: ${statement.sql.slice(0, 400)}`
      ].join('\n');
      console.log(message);
      throw new Error(message);
    };

    const observeProduction = (
      context: Record<string, unknown>,
      statements: readonly RecordedStatement[],
      filters: ErrorExplorerFilters,
      allowedLabels: ReadonlySet<string> = KNOWN_STATEMENT_LABELS
    ): void => {
      const filterStrings = filterStringsOf(filters);
      for (const statement of statements) {
        if (statement.label === null || !allowedLabels.has(statement.label))
          failStatementCheck(context, statement, `the label ${statement.label} is not allowed here`);
        productionStatementLabelByText.set(statement.sql, statement.label);
        const leak = findFilterStringInStatement(statement, database(), filterStrings);
        if (leak) failStatementCheck(context, statement, `a filter or search string was sent to MySQL: ${leak}`);
      }
    };

    const observeSqlPathQuery = (
      context: Record<string, unknown>,
      statements: readonly RecordedStatement[],
      filters: ErrorExplorerFilters,
      response: ErrorExplorerQueryResponse,
      request: ErrorExplorerQueryRequest
    ): void => {
      observeProduction(context, statements, filters, SQL_QUERY_STATEMENT_LABELS);
      sqlPathQueryCount++;
      const pageStatements = statements.filter(statement => statement.label === LABELS.page);
      if (pageStatements.length > 1) failStatementCheck(context, pageStatements[1], `${pageStatements.length} page statements for one chunk`);
      if ((request.censusIDs?.length ?? 0) > CENSUS_LIST_SIZE) {
        failStatementCheck(context, statements[0], 'a scope with more than 8 censuses belongs in the consistency file, where the chunk window is pinned');
      }
      const window = toSliceBounds(request.page, request.pageSize);
      const expectedWindow = [String(window.limit), String(window.offset)];
      if (window.limit === 0 && pageStatements.length > 0) {
        failStatementCheck(context, pageStatements[0], 'a request that selects no rows must not send a page statement');
      }
      for (const pageStatement of pageStatements) {
        const boundWindow = pageStatement.params.slice(-PAGE_WINDOW_PARAM_COUNT);
        if (!isDeepStrictEqual(boundWindow, expectedWindow)) {
          failStatementCheck(
            context,
            pageStatement,
            `the page window ${JSON.stringify(boundWindow)} differs from the requested [limit, offset] ${JSON.stringify(expectedWindow)}`
          );
        }
        maxPageStatementRowsPerSlot = Math.max(maxPageStatementRowsPerSlot, pageStatement.rows / window.limit);
      }
      const memberGroupRows = statements
        .filter(statement => statement.label === LABELS.duplicateMemberGroups || statement.label === LABELS.sameBatchMemberGroups)
        .reduce((total, statement) => total + statement.rows, 0);
      if (response.rows.length > 0) {
        const perPageRow = memberGroupRows / response.rows.length;
        if (perPageRow > MEMBER_GROUP_KINDS_PER_ROW) {
          failStatementCheck(context, statements[statements.length - 1], `${memberGroupRows} member-group rows for ${response.rows.length} page rows`);
        }
        maxMemberGroupRowsPerPageRow = Math.max(maxMemberGroupRowsPerPageRow, perPageRow);
      } else if (memberGroupRows > 0) {
        failStatementCheck(context, statements[statements.length - 1], `${memberGroupRows} member-group rows for an empty page`);
      }
    };

    const observeSearchQuery = (
      context: Record<string, unknown>,
      statements: readonly RecordedStatement[],
      filters: ErrorExplorerFilters,
      response: ErrorExplorerQueryResponse,
      request: ErrorExplorerQueryRequest
    ): void => {
      const searchesInNode = filters.quickSearch.trim() !== BLANK_SEARCH;
      if (!searchesInNode) return observeSqlPathQuery(context, statements, filters, response, request);
      observeProduction(context, statements, filters);
      const pageStatement = statements.find(statement => statement.label === LABELS.page || statement.label === LABELS.catalog);
      if (pageStatement) failStatementCheck(context, pageStatement, 'a quick search must stay on the Node path');
    };

    const queryRequest = (scope: Scope, filters: ErrorExplorerFilters, page: number, pageSize: number): ErrorExplorerQueryRequest => ({
      schema: database(),
      plotID: scope.plotID,
      censusID: scope.censusID,
      censusIDs: scope.censusIDs,
      page,
      pageSize,
      filters
    });
    const facetRequest = (scope: Scope, filters: ErrorExplorerFilters) => ({
      schema: database(),
      plotID: scope.plotID,
      censusID: scope.censusID,
      censusIDs: scope.censusIDs,
      filters
    });

    const oracleWholeList = (scope: Scope, filters: ErrorExplorerFilters): Promise<ErrorExplorerQueryResponse> => {
      const isReusable = filters.quickSearch === '';
      const cacheKey = JSON.stringify([scope.name, filters]);
      const cached = isReusable ? wholeListCache.get(cacheKey) : undefined;
      if (cached) return cached;
      apiCalls++;
      const pending = oracle.queryErrorExplorer(oracleExecutor(), queryRequest(scope, filters, 0, WHOLE_LIST_PAGE_SIZE));
      if (isReusable) wholeListCache.set(cacheKey, pending);
      return pending;
    };

    const noteAxisTotals = (axes: readonly string[], totalRows: number) =>
      axes.forEach(axis => axisMaxima.set(axis, Math.max(axisMaxima.get(axis) ?? 0, totalRows)));

    const compare = (context: Record<string, unknown>, actual: unknown, expected: unknown) =>
      expectExplorerEqual(explorerConnection(), { seed, ...context }, actual, expected, witnessIDs());

    const runTimed = async (api: string, body: () => Promise<void>) => {
      apiCalls = 0;
      statementCount = 0;
      const startedAt = performance.now();
      await body();
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      console.log(`[equivalence] seed=${seed} api=${api} calls=${apiCalls} mysqlStatementsExcludingOracleCacheHits=${statementCount} seconds=${seconds}`);
    };

    beforeAll(async () => {
      fixture = generateEquivalenceFixture(seed);
      wholeListCache.clear();
      axisMaxima.clear();
      noLogTotals.clear();
      oracleReadCache.clear();
      maxPageStatementRowsPerSlot = 0;
      maxMemberGroupRowsPerPageRow = 0;
      sqlPathQueryCount = 0;
      await replaceFixture((fixtureDatabase as FixtureDatabase).setupConnection, fixture);
      oracleReadCache.clear();
      oracleReadCache.hits = 0;
      oracleReadCache.misses = 0;
      console.log(
        `[equivalence] seed=${seed} measurements=${fixture.measurements.length} logs=${fixture.logs.length} witness=${fixture.witnessRowIDs.join(',')}`
      );
    }, FIXTURE_HOOK_TIMEOUT_MS);

    afterAll(() => {
      wholeListCache.clear();
    });

    it('generator covers every planted case', async () => {
      const whole = await oracleWholeList(GROUPED_SCOPE, DEFAULT_FILTERS);
      const uncovered = findUncoveredCases(fixture, whole.rows);
      console.log(`[coverage] seed=${seed} errorSetRows=${whole.rows.length} uncovered=${JSON.stringify(uncovered)}`);
      expect(uncovered.map(name => `generator did not cover ${name}`)).toEqual([]);
    });

    const witnessFamilies = () => {
      const sameBatchRow = fixture.measurements.find(row => row.coreMeasurementID === fixture.witnessGroups.sameBatchVariants[0]) as FixtureMeasurement;
      const sameBatchPrefix = `same-batch:${FIRST_CENSUS_ID}:${sameBatchRow.uploadFileID}:${sameBatchRow.uploadBatchID}`;
      return [
        {
          name: 'tree-tag spellings',
          ids: fixture.witnessGroups.treeTagVariants,
          expectedFlag: DUPLICATE,
          spellings: [...WITNESS_TREE_TAGS, WITNESS_NON_ERROR_TREE_TAG],
          keyFor: (spelling: string) => `duplicate:${FIRST_CENSUS_ID}:${spelling}:${WITNESS_STEM_TAG}`,
          foreignKey: `duplicate:${FIRST_CENSUS_ID}:${FOREIGN_TAG_SPELLING}:${WITNESS_STEM_TAG}`
        },
        {
          name: 'stem-tag spellings',
          ids: fixture.witnessGroups.stemTagVariants,
          expectedFlag: DUPLICATE,
          spellings: [...WITNESS_ERROR_STEM_TAGS, WITNESS_NON_ERROR_STEM_TAG],
          keyFor: (spelling: string) => `duplicate:${FIRST_CENSUS_ID}:${WITNESS_STEM_VARIANT_TREE_TAG}:${spelling}`,
          foreignKey: `duplicate:${FIRST_CENSUS_ID}:${WITNESS_STEM_VARIANT_TREE_TAG}:${FOREIGN_STEM_SPELLING}`
        },
        {
          name: 'same-batch tree-tag spellings',
          ids: fixture.witnessGroups.sameBatchVariants,
          expectedFlag: SAME_BATCH,
          spellings: [...WITNESS_SAME_BATCH_ERROR_TREE_TAGS, WITNESS_SAME_BATCH_NON_ERROR_TREE_TAG],
          keyFor: (spelling: string) => `${sameBatchPrefix}:${spelling}`,
          foreignKey: `${sameBatchPrefix}:${FOREIGN_TAG_SPELLING}`
        },
        {
          name: 'tree-tag spellings with one error member',
          ids: fixture.witnessGroups.singleErrorTreeTagPair,
          expectedFlag: DUPLICATE,
          spellings: [...SINGLE_ERROR_TREE_TAG_PAIR],
          keyFor: (spelling: string) => `duplicate:${FIRST_CENSUS_ID}:${spelling}:${WITNESS_STEM_TAG}`,
          foreignKey: `duplicate:${FIRST_CENSUS_ID}:${FOREIGN_TAG_SPELLING}:${WITNESS_STEM_TAG}`
        },
        {
          name: 'accent-only tree-tag spellings with one error member',
          ids: fixture.witnessGroups.accentOnlyTreeTagPair,
          expectedFlag: DUPLICATE,
          spellings: [...ACCENT_ONLY_TREE_TAG_PAIR],
          keyFor: (spelling: string) => `duplicate:${FIRST_CENSUS_ID}:${spelling}:${WITNESS_STEM_TAG}`,
          foreignKey: `duplicate:${FIRST_CENSUS_ID}:${FOREIGN_TAG_SPELLING}:${WITNESS_STEM_TAG}`
        },
        {
          name: 'stem-tag spellings with one error member',
          ids: fixture.witnessGroups.singleErrorStemTagPair,
          expectedFlag: DUPLICATE,
          spellings: [...SINGLE_ERROR_STEM_TAG_PAIR],
          keyFor: (spelling: string) => `duplicate:${FIRST_CENSUS_ID}:${SINGLE_ERROR_STEM_PAIR_TREE_TAG}:${spelling}`,
          foreignKey: `duplicate:${FIRST_CENSUS_ID}:${SINGLE_ERROR_STEM_PAIR_TREE_TAG}:${FOREIGN_STEM_SPELLING}`
        },
        {
          name: 'same-batch tree-tag spellings with one error member',
          ids: fixture.witnessGroups.singleErrorSameBatchPair,
          expectedFlag: SAME_BATCH,
          spellings: [...SINGLE_ERROR_SAME_BATCH_PAIR],
          keyFor: (spelling: string) => `${sameBatchPrefix}:${spelling}`,
          foreignKey: `${sameBatchPrefix}:${FOREIGN_TAG_SPELLING}`
        }
      ];
    };

    const withGroupKey = (response: ErrorExplorerQueryResponse, rowIDs: ReadonlySet<number>, groupKey: string): ErrorExplorerQueryResponse => ({
      ...response,
      rows: response.rows.map(row => (rowIDs.has(Number(row.coreMeasurementID)) ? { ...row, contradictionGroupKey: groupKey } : row))
    });

    it('production lists each witness group with its non-error spelling as a related row, and leaves that member out of the error set', async () => {
      const response = await production.queryErrorExplorer(productionExecutor(), queryRequest(SCOPES[0], DEFAULT_FILTERS, 0, WHOLE_LIST_PAGE_SIZE));
      for (const family of witnessFamilies()) {
        const errorMemberIDs = family.ids.slice(0, -1);
        const nonErrorMemberID = family.ids[family.ids.length - 1];
        const rows = response.rows.filter(row => errorMemberIDs.includes(Number(row.coreMeasurementID)));
        console.log(`[witness] seed=${seed} ${family.name} keys=${JSON.stringify(rows.map(row => row.contradictionGroupKey))}`);
        expect(rows.map(row => row.coreMeasurementID).sort((a, b) => Number(a) - Number(b))).toEqual([...errorMemberIDs].sort((a, b) => a - b));
        expect(response.rows.some(row => row.coreMeasurementID === nonErrorMemberID)).toBe(false);
        rows.forEach(row => {
          expect(row.contradictionType).toBe(family.expectedFlag);
          expect([...row.relatedMeasurementIDs].sort((a, b) => a - b)).toEqual(family.ids.filter(id => id !== row.coreMeasurementID).sort((a, b) => a - b));
        });
      }
    });

    it('every case or accent spelling of a witness group key is accepted on the real connection, a different tag is rejected', async () => {
      const whole = await oracleWholeList(SCOPES[0], DEFAULT_FILTERS);
      const collationQuery = vi.spyOn(explorerConnection(), 'query');
      for (const family of witnessFamilies()) {
        const groupRowIDs = new Set(family.ids.slice(0, -1));
        const collationCallsAtFamilyStart = collationQuery.mock.calls.length;
        expect(whole.rows.filter(row => groupRowIDs.has(Number(row.coreMeasurementID)))).toHaveLength(groupRowIDs.size);
        for (const spelling of family.spellings) {
          const rewritten = withGroupKey(whole, groupRowIDs, family.keyFor(spelling));
          await expectExplorerEqual(explorerConnection(), { seed, scenario: `${family.name}: key rewritten to ${spelling}` }, rewritten, whole, witnessIDs());
        }
        expect(
          collationQuery.mock.calls.length - collationCallsAtFamilyStart,
          `${family.name}: byte-different spellings must be sent to MySQL`
        ).toBeGreaterThan(0);
        const foreign = withGroupKey(whole, groupRowIDs, family.foreignKey);
        const error = await expectExplorerEqual(
          explorerConnection(),
          { seed, scenario: `${family.name}: key rewritten to another tag` },
          foreign,
          whole,
          witnessIDs()
        ).then(
          () => null,
          (caught: Error) => caught
        );
        console.log(`[witness] seed=${seed} ${family.name}: another tag -> ${error?.message.split('\n')[2] ?? 'NOT REJECTED'}`);
        expect(error, `${family.name}: a key for another tag must be rejected`).not.toBeNull();
        expect(error?.message).toContain('contradictionGroupKey of row');
      }
    });

    it('plot scopes: plot 2 on census 1 holds exactly the mismatched-plot rows, plot 1 on census 3 is empty, plot 2 on census 3 is not', async () => {
      const [plotTwoOnFirstCensus, plotOneOnOtherCensus, plotTwoOnOwnCensus] = [PLOT_SCOPES[2], PLOT_SCOPES[1], PLOT_SCOPES[0]];
      const found = await oracleWholeList(plotTwoOnFirstCensus, DEFAULT_FILTERS);
      const empty = await oracleWholeList(plotOneOnOtherCensus, DEFAULT_FILTERS);
      const own = await oracleWholeList(plotTwoOnOwnCensus, DEFAULT_FILTERS);
      console.log(`[plot scopes] seed=${seed} plot2/census1=${found.totalRows} plot1/census3=${empty.totalRows} plot2/census3=${own.totalRows}`);

      expect(found.rows.map(row => Number(row.coreMeasurementID)).sort((a, b) => a - b)).toEqual([...fixture.mismatchedPlotRowIDs].sort((a, b) => a - b));
      expect(empty.totalRows).toBe(0);
      expect(own.totalRows).toBeGreaterThan(0);
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
          for (const { scope, named } of PRESET_COMBINATIONS) {
            const whole = await oracleWholeList(scope, named.filters);
            for (const page of pagesFor(whole.totalRows, DERIVATION_PAGE_SIZE)) {
              apiCalls++;
              const oraclePage = await oracle.queryErrorExplorer(oracleExecutor(), queryRequest(scope, named.filters, page, DERIVATION_PAGE_SIZE));
              await compare(
                { scenario: 'oracle per page against its whole-list slice', scope: scope.name, filters: named.label, page, pageSize: DERIVATION_PAGE_SIZE },
                sliceOracleWholeList(whole, page, DERIVATION_PAGE_SIZE),
                oraclePage
              );
            }
          }
          for (const { scope, named } of GRID_COMBINATIONS) {
            const { label, filters, axes } = named;
            const whole = await oracleWholeList(scope, filters);
            noteAxisTotals(axes, whole.totalRows);
            if (label.includes(NO_LOG_FILTER_LABEL_PART)) noLogTotals.set(`${scope.name} | ${label}`, whole.totalRows);
            for (const pageSize of PAGE_SIZES) {
              for (const page of pagesFor(whole.totalRows, pageSize)) {
                apiCalls++;
                const request = queryRequest(scope, filters, page, pageSize);
                const { result: actual, statements } = await recordProduction(executor => production.queryErrorExplorer(executor, request));
                const context = { scenario: 'queryErrorExplorer', scope: scope.name, filters: label, filterValues: filters, page, pageSize };
                await compare(context, actual, sliceOracleWholeList(whole, page, pageSize));
                observeSqlPathQuery(context, statements, filters, actual, request);
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
                noteAxisTotals([`search:${quickSearch}`], whole.totalRows);
                apiCalls++;
                const wholeRequest = queryRequest(scope, searchFilters, 0, WHOLE_LIST_PAGE_SIZE);
                const { result: actualWhole, statements: wholeStatements } = await recordProduction(executor =>
                  production.queryErrorExplorer(executor, wholeRequest)
                );
                const wholeContext = {
                  scenario: 'quick search whole list',
                  scope: scope.name,
                  filters: label,
                  filterValues: searchFilters,
                  quickSearch,
                  page: 0,
                  pageSize: WHOLE_LIST_PAGE_SIZE
                };
                await compare(wholeContext, actualWhole, whole);
                observeSearchQuery(wholeContext, wholeStatements, searchFilters, actualWhole, wholeRequest);
                if (!sweepWithSearch) continue;
                for (const pageSize of PAGE_SIZES) {
                  for (const page of pagesFor(whole.totalRows, pageSize)) {
                    apiCalls++;
                    const pageRequest = queryRequest(scope, searchFilters, page, pageSize);
                    const { result: actual, statements } = await recordProduction(executor => production.queryErrorExplorer(executor, pageRequest));
                    const pageContext = {
                      scenario: 'quick search page',
                      scope: scope.name,
                      filters: label,
                      filterValues: searchFilters,
                      quickSearch,
                      page,
                      pageSize
                    };
                    await compare(pageContext, actual, sliceOracleWholeList(whole, page, pageSize));
                    observeSearchQuery(pageContext, statements, searchFilters, actual, pageRequest);
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
          for (const { scope, named } of GRID_COMBINATIONS) {
            for (const quickSearch of QUICK_SEARCH_VALUES) {
              const searchFilters = { ...named.filters, quickSearch };
              apiCalls += 2;
              const expected = await oracle.buildErrorExplorerFacets(oracleExecutor(), facetRequest(scope, searchFilters));
              const { result: actual, statements } = await recordProduction(executor =>
                production.buildErrorExplorerFacets(executor, facetRequest(scope, searchFilters))
              );
              const context = { scenario: 'buildErrorExplorerFacets', scope: scope.name, filters: named.label, filterValues: searchFilters, quickSearch };
              await compare(context, actual, expected);
              observeProduction(context, statements, searchFilters);
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
            observeProduction({ scenario: 'buildErrorMessageCounts', censusIDs }, productionRecorder.statements, DEFAULT_FILTERS);
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
          const measurementIDs = [...errorSetIDs, ...nonErrorIDs, otherPlotID, ...fixture.mismatchedPlotRowIDs, ...IRREGULAR_MEASUREMENT_IDS];
          const activeTypes: Array<ContradictionType | undefined> = [undefined, DUPLICATE, SAME_BATCH];
          console.log(`[details] seed=${seed} errorSetIDs=${errorSetIDs.length} nonErrorIDs=${nonErrorIDs.length} otherPlotID=${otherPlotID}`);
          expect(nonErrorIDs).toHaveLength(NON_ERROR_ID_COUNT);

          for (const censusID of [FIRST_CENSUS_ID, SECOND_CENSUS_ID]) {
            const request = { schema: database(), plotID: MAIN_PLOT_ID, censusID };
            for (const measurementID of measurementIDs) {
              for (const activeType of activeTypes) {
                apiCalls += 2;
                const expected = await oracle.buildErrorExplorerDetails(oracleExecutor(), request, measurementID, activeType);
                const { result: actual, statements } = await recordProduction(executor =>
                  production.buildErrorExplorerDetails(executor, request, measurementID, activeType)
                );
                const context = { scenario: 'buildErrorExplorerDetails', censusID, measurementID, activeContradictionType: activeType ?? null };
                await compare(context, actual, expected);
                observeProduction(context, statements, DEFAULT_FILTERS, DETAILS_STATEMENT_LABELS);
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
            ...PRESET_FILTERS,
            { label: 'semicolon message', filters: oracleFilters({ exactMessages: [FIXTURE_MESSAGES.semicolonMessage] }), sweepWithSearch: false, axes: [] }
          ];
          for (const scope of [...SCOPES, ...PLOT_SCOPES]) {
            const censusArgument = scopeCensusArgument(scope);
            for (const { label, filters } of exportFilters) {
              apiCalls += 2;
              const expected = oracle.buildErrorExportRows(
                await oracle.fetchGroupedErrorRows(oracleExecutor(), database(), scope.plotID, censusArgument),
                filters
              );
              const actual = production.buildErrorExportRows(
                await production.fetchGroupedErrorRows(productionExecutor(), database(), scope.plotID, censusArgument),
                filters
              );
              await compare({ scenario: 'buildErrorExportRows', scope: scope.name, filters: label }, actual, expected);
            }
          }
        }),
      SEED_TEST_TIMEOUT_MS
    );

    it('every production statement was one of the nine shapes, and the SQL query path stayed within one page row per slot and two member-group rows per page row', () => {
      const textsByLabel = new Map<string | null, number>();
      productionStatementLabelByText.forEach(label => textsByLabel.set(label, (textsByLabel.get(label) ?? 0) + 1));
      console.log(
        `[statements] seed=${seed} distinctTexts=${productionStatementLabelByText.size} textsByLabel=${JSON.stringify(Object.fromEntries(textsByLabel))} ` +
          `oracleCacheHits=${oracleReadCache.hits} oracleCacheMisses=${oracleReadCache.misses} sqlPathQueries=${sqlPathQueryCount} maxPageStatementRowsPerSlot=${maxPageStatementRowsPerSlot} maxMemberGroupRowsPerPageRow=${maxMemberGroupRowsPerPageRow}`
      );
      expect(sqlPathQueryCount, 'the query test must have run before this one').toBeGreaterThan(0);
      expect(productionStatementLabelByText.size, 'distinct statement texts over the whole run').toBeLessThanOrEqual(STATEMENT_SHAPE_COUNT);
      textsByLabel.forEach((count, label) => expect(count, `distinct texts for the label ${label}`).toBe(1));
      expect(maxPageStatementRowsPerSlot).toBeLessThanOrEqual(1);
      expect(maxMemberGroupRowsPerPageRow).toBeLessThanOrEqual(MEMBER_GROUP_KINDS_PER_ROW);
    });

    it('every filter axis value and search value was recorded, and each selects rows in at least one scope except the matches-nothing control', () => {
      const emptyAxes = [...axisMaxima.entries()].filter(([axis, maximum]) => maximum === 0 && axis !== MATCHES_NOTHING_AXIS).map(([axis]) => axis);
      const expectedAxes = [...new Set([...FILTER_GRID.flatMap(named => named.axes), ...QUICK_SEARCH_VALUES.map(value => `search:${value}`)])].sort();
      console.log(`[axes] seed=${seed} axisValues=${axisMaxima.size} maxima=${JSON.stringify(Object.fromEntries(axisMaxima))}`);
      console.log(`[no-log] seed=${seed} oracle totalRows per no-log fallback set: ${JSON.stringify(Object.fromEntries(noLogTotals))}`);

      expect([...axisMaxima.keys()].sort(), 'the query and quick-search tests must have recorded exactly the expected axes').toEqual(expectedAxes);
      expect(axisMaxima.get(MATCHES_NOTHING_AXIS), 'the matches-nothing control must stay empty').toBe(0);
      expect(axisMaxima.get(NO_LOG_AXIS), 'the no-log fallback message needs a positive oracle count').toBeGreaterThan(0);
      expect(emptyAxes).toEqual([]);
    });
  });

  describe('oracle read cache can fail', () => {
    const SELECT_STATEMENT = '/* label */ SELECT 1 FROM t WHERE a IN (?)';
    const countingRun = (rows: unknown, runs: { count: number }) => async () => {
      runs.count++;
      return rows;
    };

    it('returns a copy for an identical read, and reads again for the same text with other params', async () => {
      const cache = createOracleReadCache();
      const runs = { count: 0 };
      const rows = [{ id: 1, when: new Date(0), isValidated: Buffer.from([1]) }];
      const first = (await cache.read(SELECT_STATEMENT, [1], countingRun(rows, runs))) as typeof rows;
      const second = (await cache.read(SELECT_STATEMENT, [1], countingRun(rows, runs))) as typeof rows;
      const otherParams = await cache.read(SELECT_STATEMENT, [2], countingRun(rows, runs));
      console.log(`[oracle cache] runs=${runs.count} hits=${cache.hits} misses=${cache.misses}`);
      expect(runs.count, 'MySQL reads: one per distinct (sql, params)').toBe(2);
      expect({ hits: cache.hits, misses: cache.misses }).toEqual({ hits: 1, misses: 2 });
      expect(second).toEqual(first);
      expect(Buffer.isBuffer(second[0].isValidated), 'a BIT column stays a Buffer in the copy').toBe(true);
      expect(second[0].when).toBeInstanceOf(Date);
      expect(second, 'a cache hit is a copy, so the oracle cannot change what the next read sees').not.toBe(first);
      (second[0] as { id: number }).id = 99;
      expect(((await cache.read(SELECT_STATEMENT, [1], countingRun(rows, runs))) as typeof rows)[0].id).toBe(1);
      expect(otherParams).toEqual(rows);
    });

    it('is emptied by a statement that is not a read', async () => {
      const cache = createOracleReadCache();
      const runs = { count: 0 };
      await cache.read(SELECT_STATEMENT, [1], countingRun([], runs));
      await cache.read('UPDATE t SET a = 1', [], countingRun([], runs));
      await cache.read(SELECT_STATEMENT, [1], countingRun([], runs));
      expect(runs.count, 'the read after the write goes to MySQL again').toBe(3);
    });

    it('is emptied by clear()', async () => {
      const cache = createOracleReadCache();
      const runs = { count: 0 };
      await cache.read(SELECT_STATEMENT, [1], countingRun([], runs));
      cache.clear();
      await cache.read(SELECT_STATEMENT, [1], countingRun([], runs));
      expect(runs.count).toBe(2);
    });
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
