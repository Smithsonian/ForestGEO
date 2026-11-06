import { inspect } from 'node:util';
import mysql, { type Connection } from 'mysql2/promise';
import { expect } from 'vitest';
import { DEFAULT_TEST_CONFIG, loadSchema, seededRandom } from '../../setup/local-db-setup';
import { runQueryDispatch } from '../../setup/runquerydispatch';
import { cleanupTimingConnections, createTestDatabaseStrict } from '../../setup/stricttestdatabasecleanup';
import { TEST_DB_DRIVER_TIMEZONE } from '../../setup/test-db-connection';
import { readStatementLabel } from '@/app/api/errors/explorer/errorsetsql';

export const EQUIVALENCE_GROUP_CONCAT_MAX_LEN = 1_048_576;
export const FIXTURE_CONNECTION_CHARSET = 'UTF8MB4_0900_AI_CI';
export const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export const MAIN_PLOT_ID = 1;
export const DECOY_PLOT_ID = 2;
export const FIRST_CENSUS_ID = 1;
export const SECOND_CENSUS_ID = 2;
export const DECOY_CENSUS_ID = 3;

export const FIXTURE_ERROR_TYPE_IDS = {
  dbhGrowth: 1,
  dbhShrinkage: 2,
  fallbackFields: 3,
  semicolonCriteria: 4,
  sharedMessageFirst: 5,
  sharedMessageSecond: 6,
  tagMismatch: 7,
  tagMismatchLowerCase: 8,
  semicolonMessage: 9,
  invalidSpecies: 10,
  sqlException: 11,
  nullCode: 12
} as const;

export const FIXTURE_MESSAGES = {
  dbhGrowth: 'DBH grew more than allowed since the prior census',
  dbhShrinkage: 'DBH shrank more than allowed since the prior census',
  fallbackFields: 'Tree tag or stem tag is missing',
  semicolonCriteria: 'Tree and stem tag disagree with the stem register',
  shared: 'Species code does not match the tree',
  tagMismatch: 'Tag mismatch',
  tagMismatchLowerCase: 'tag mismatch',
  semicolonMessage: 'First condition; second condition',
  invalidSpecies: 'Species code is not in the species list',
  sqlException: 'The database rejected this row',
  nullCode: 'Row failed ingestion for an unrecorded reason',
  matchesNothing: 'No such message'
} as const;

export const WITNESS_TREE_TAGS = ['Ab1', 'ab1', 'Áb1'] as const;
export const WITNESS_STEM_TAG = '1';

const DEFAULT_SEEDS: readonly number[] = [544, 20261104, 4242];
export const EQUIVALENCE_SEEDS_ENV = 'ERRORS_EXPLORER_EQUIVALENCE_SEEDS';

export interface FixtureCensus {
  censusID: number;
  plotID: number;
  plotCensusNumber: number | null;
}
export interface FixtureErrorType {
  errorID: number;
  source: 'validation' | 'ingestion';
  code: string | null;
  message: string;
}
export interface FixtureValidation {
  validationID: number;
  procedureName: string;
  description: string | null;
  criteria: string | null;
}
export interface FixtureMeasurement {
  coreMeasurementID: number;
  plotID: number;
  censusID: number;
  isActive: boolean;
  coreStemGUID: number | null;
  summaryStemGUID: number | null;
  coreIsValidated: boolean | null;
  summaryIsValidated: boolean | null;
  treeTag: string | null;
  stemTag: string | null;
  speciesCode: string | null;
  quadratName: string | null;
  measurementDate: string | null;
  measuredDBH: number | null;
  measuredHOM: number | null;
  rawCodes: string | null;
  stemLocalX: string | number | null;
  stemLocalY: string | number | null;
  description: string | null;
  uploadFileID: string | null;
  uploadBatchID: string | null;
}
export interface FixtureLog {
  measurementID: number;
  errorID: number;
  isResolved: boolean;
  priorCensusID?: number | null;
  priorDBH?: number | null;
  priorHOM?: number | null;
}
export interface ExplorerFixture {
  plotIDs: number[];
  censuses: FixtureCensus[];
  errorTypes: FixtureErrorType[];
  validations: FixtureValidation[];
  measurements: FixtureMeasurement[];
  logs: FixtureLog[];
}
export interface GeneratedFixture extends ExplorerFixture {
  seed: number;
  witnessRowIDs: number[];
}

export function resolveEquivalenceSeeds(rawEnvValue: string | undefined = process.env[EQUIVALENCE_SEEDS_ENV]): number[] {
  if (!rawEnvValue?.trim()) return [...DEFAULT_SEEDS];
  const seeds = rawEnvValue.split(',').map(part => Number(part.trim()));
  const invalid = seeds.filter(seed => !Number.isInteger(seed));
  if (invalid.length > 0) throw new RangeError(`${EQUIVALENCE_SEEDS_ENV} must be comma-separated integers; got ${JSON.stringify(rawEnvValue)}`);
  return seeds;
}

export function assertLocalOrRefuse(azureServer: string | undefined = process.env.AZURE_SQL_SERVER, testHost: string = DEFAULT_TEST_CONFIG.host): void {
  if (!azureServer || !LOCAL_HOSTS.includes(azureServer)) {
    throw new Error(`REFUSING TO RUN: AZURE_SQL_SERVER is '${azureServer}', not local. Aborting to avoid touching a real database.`);
  }
  if (!testHost || !LOCAL_HOSTS.includes(testHost)) {
    throw new Error(`REFUSING TO RUN: the test MySQL host is '${testHost}', not local. Aborting to avoid connecting to a real database.`);
  }
}

export interface FixtureDatabase {
  readonly database: string;
  /** Writable root connection: fixtures, mutations, and the final DROP. */
  readonly setupConnection: Connection;
  /** The connection the explorer executor runs on: charset, timezone 'Z', group_concat_max_len = EQUIVALENCE_GROUP_CONCAT_MAX_LEN. */
  readonly explorerConnection: Connection;
  /** Ends explorerConnection, then teardownTestDatabaseStrict(setupConnection, database); errors from both steps are collected and rethrown as an AggregateError. */
  teardown(): Promise<void>;
}

export async function setGroupConcatMaxLen(connection: Connection, bytes: number): Promise<void> {
  if (!Number.isInteger(bytes) || bytes <= 0) throw new RangeError(`group_concat_max_len must be a positive integer; got ${bytes}`);
  await connection.query(`SET SESSION group_concat_max_len = ${bytes}`);
}

/**
 * createTestDatabaseStrict + loadSchema + the explorer connection. If any step throws, it ends the connections it opened and
 * drops the schema before rethrowing, so a failed beforeAll leaks nothing. Tests keep `let fixtureDatabase: FixtureDatabase | null = null`
 * and call `await fixtureDatabase?.teardown()` in afterAll.
 */
export async function openFixtureDatabase(database: string): Promise<FixtureDatabase> {
  const setupConnection = await createTestDatabaseStrict({ ...DEFAULT_TEST_CONFIG, database });
  let explorerConnection: Connection | null = null;
  try {
    await loadSchema(setupConnection);
    explorerConnection = await mysql.createConnection({
      host: DEFAULT_TEST_CONFIG.host,
      port: DEFAULT_TEST_CONFIG.port,
      user: DEFAULT_TEST_CONFIG.user,
      password: DEFAULT_TEST_CONFIG.password,
      database,
      multipleStatements: false,
      timezone: TEST_DB_DRIVER_TIMEZONE,
      charset: FIXTURE_CONNECTION_CHARSET
    });
    await setGroupConcatMaxLen(explorerConnection, EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
  } catch (setupError) {
    await cleanupTimingConnections(explorerConnection, setupConnection, database, setupError);
    throw setupError;
  }
  const openedExplorerConnection = explorerConnection;
  return {
    database,
    setupConnection,
    explorerConnection: openedExplorerConnection,
    teardown: () => cleanupTimingConnections(openedExplorerConnection, setupConnection, database)
  };
}

const FIXTURE_TABLE_DELETE_ORDER = [
  'measurement_error_log',
  'measurement_errors',
  'sitespecificvalidations',
  'measurementssummary',
  'coremeasurements',
  'census',
  'plots'
] as const;
const CENSUS_START_DATE = '2020-01-01';
const CENSUS_END_DATE = '2020-12-31';

async function insertRows(connection: Connection, table: string, columns: readonly string[], rows: readonly unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  await connection.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [rows]);
}

async function restoreForeignKeyChecks(connection: Connection, primaryError: unknown): Promise<void> {
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (restoreError) {
    if (primaryError === null) throw restoreError;
    throw new AggregateError([primaryError, restoreError], 'Fixture replacement failed and foreign key checks could not be restored');
  }
}

/** Replaces the fixture tables' rows: FOREIGN_KEY_CHECKS = 0, DELETE from measurement_error_log, measurement_errors, sitespecificvalidations, measurementssummary, coremeasurements, census, plots; bulk INSERTs; FOREIGN_KEY_CHECKS = 1. */
export async function replaceFixture(connection: Connection, fixture: ExplorerFixture): Promise<void> {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of FIXTURE_TABLE_DELETE_ORDER) await connection.query(`DELETE FROM ${table}`);
    await insertRows(
      connection,
      'plots',
      ['PlotID', 'PlotName'],
      fixture.plotIDs.map(plotID => [plotID, `Equivalence plot ${plotID}`])
    );
    await insertRows(
      connection,
      'census',
      ['CensusID', 'PlotID', 'PlotCensusNumber', 'StartDate', 'EndDate', 'IsActive'],
      fixture.censuses.map(census => [census.censusID, census.plotID, census.plotCensusNumber, CENSUS_START_DATE, CENSUS_END_DATE, true])
    );
    await insertRows(
      connection,
      'measurement_errors',
      ['ErrorID', 'ErrorSource', 'ErrorCode', 'ErrorMessage'],
      fixture.errorTypes.map(type => [type.errorID, type.source, type.code, type.message])
    );
    await insertRows(
      connection,
      'sitespecificvalidations',
      ['ValidationID', 'ProcedureName', 'Description', 'Criteria', 'IsEnabled'],
      fixture.validations.map(validation => [validation.validationID, validation.procedureName, validation.description, validation.criteria, true])
    );
    await insertRows(
      connection,
      'coremeasurements',
      [
        'CoreMeasurementID',
        'CensusID',
        'StemGUID',
        'IsValidated',
        'MeasurementDate',
        'MeasuredDBH',
        'MeasuredHOM',
        'UploadFileID',
        'UploadBatchID',
        'RawCodes',
        'IsActive'
      ],
      fixture.measurements.map(row => [
        row.coreMeasurementID,
        row.censusID,
        row.coreStemGUID,
        row.coreIsValidated,
        row.measurementDate,
        row.measuredDBH,
        row.measuredHOM,
        row.uploadFileID,
        row.uploadBatchID,
        row.rawCodes,
        row.isActive
      ])
    );
    await insertRows(
      connection,
      'measurementssummary',
      [
        'CoreMeasurementID',
        'StemGUID',
        'PlotID',
        'CensusID',
        'TreeTag',
        'StemTag',
        'SpeciesCode',
        'QuadratName',
        'StemLocalX',
        'StemLocalY',
        'MeasurementDate',
        'MeasuredDBH',
        'MeasuredHOM',
        'IsValidated',
        'Description'
      ],
      fixture.measurements.map(row => [
        row.coreMeasurementID,
        row.summaryStemGUID,
        row.plotID,
        row.censusID,
        row.treeTag,
        row.stemTag,
        row.speciesCode,
        row.quadratName,
        row.stemLocalX,
        row.stemLocalY,
        row.measurementDate,
        row.measuredDBH,
        row.measuredHOM,
        row.summaryIsValidated,
        row.description
      ])
    );
    await insertRows(
      connection,
      'measurement_error_log',
      ['MeasurementID', 'ErrorID', 'IsResolved', 'PriorCensusID', 'PriorDBH', 'PriorHOM'],
      fixture.logs.map(log => [log.measurementID, log.errorID, log.isResolved, log.priorCensusID ?? null, log.priorDBH ?? null, log.priorHOM ?? null])
    );
  } catch (replaceError) {
    await restoreForeignKeyChecks(connection, replaceError);
    throw replaceError;
  }
  await restoreForeignKeyChecks(connection, null);
}

export interface RecordedStatement {
  label: string | null;
  sql: string;
  params: unknown[];
  rows: number;
  jsonBytes: number;
}
export interface RecordingExecutor {
  executeQuery(sql: string, params?: unknown[]): Promise<unknown>;
  readonly statements: RecordedStatement[];
  reset(): void;
  /** Runs once, right after the first statement whose label equals `label` returns (its rows are already read). */
  afterStatementOnce(label: string, hook: () => Promise<void>): void;
}

export function createRecordingExecutor(connection: Pick<Connection, 'query' | 'execute'>): RecordingExecutor {
  const statements: RecordedStatement[] = [];
  const pendingHooks = new Map<string, () => Promise<void>>();
  return {
    statements,
    reset: () => {
      statements.length = 0;
    },
    afterStatementOnce: (label, hook) => {
      pendingHooks.set(label, hook);
    },
    executeQuery: async (sql, params = []) => {
      const rows = await runQueryDispatch(connection, sql, params);
      const label = readStatementLabel(sql);
      statements.push({
        label,
        sql,
        params: [...params],
        rows: Array.isArray(rows) ? rows.length : 0,
        jsonBytes: Buffer.byteLength(JSON.stringify(rows))
      });
      const hook = label === null ? undefined : pendingHooks.get(label);
      if (label !== null && hook) {
        pendingHooks.delete(label);
        await hook();
      }
      return rows;
    }
  };
}

export interface DifferingPath {
  path: string;
  actual: unknown;
  expected: unknown;
}

function isPlainContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value);
}

/** Date by getTime, Buffer by equals, arrays and objects key by key; an undefined property equals a missing one, as in toEqual. */
export function firstDifferingPath(actual: unknown, expected: unknown, path: string = '$'): DifferingPath | null {
  if (Object.is(actual, expected)) return null;
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime() || (Number.isNaN(actual.getTime()) && Number.isNaN(expected.getTime())) ? null : { path, actual, expected };
  }
  if (Buffer.isBuffer(actual) && Buffer.isBuffer(expected)) return actual.equals(expected) ? null : { path, actual, expected };
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return { path: `${path}.length`, actual: actual.length, expected: expected.length };
    for (let index = 0; index < actual.length; index++) {
      const differing = firstDifferingPath(actual[index], expected[index], `${path}[${index}]`);
      if (differing) return differing;
    }
    return null;
  }
  if (isPlainContainer(actual) && isPlainContainer(expected)) {
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])];
    for (const key of keys) {
      const differing = firstDifferingPath(actual[key], expected[key], `${path}.${key}`);
      if (differing) return differing;
    }
    return null;
  }
  return { path, actual, expected };
}

const GROUP_KEY_PROPERTY = 'contradictionGroupKey';
const ROW_ID_PROPERTY = 'coreMeasurementID';
const BLANKED_GROUP_KEY = null;
const COLLATION_EQUALITY_SQL = 'SELECT ? = ? COLLATE utf8mb4_0900_ai_ci AS same';
const MISMATCH_VALUE_MAX_CHARS = 2000;
const MISMATCH_INSPECT_DEPTH = 5;

function rowIDOf(node: Record<string, unknown>): number | null {
  const id = node[ROW_ID_PROPERTY];
  return typeof id === 'number' ? id : null;
}

function collectGroupKeys(value: unknown, rowIDs: ReadonlySet<number>, collected: Map<number, unknown[]> = new Map()): Map<number, unknown[]> {
  if (Array.isArray(value)) {
    value.forEach(item => collectGroupKeys(item, rowIDs, collected));
  } else if (isPlainContainer(value)) {
    const rowID = rowIDOf(value);
    if (rowID !== null && rowIDs.has(rowID) && GROUP_KEY_PROPERTY in value) collected.set(rowID, [...(collected.get(rowID) ?? []), value[GROUP_KEY_PROPERTY]]);
    Object.values(value).forEach(child => collectGroupKeys(child, rowIDs, collected));
  }
  return collected;
}

function blankGroupKeys(value: unknown, rowIDs: ReadonlySet<number>): unknown {
  if (Array.isArray(value)) return value.map(item => blankGroupKeys(item, rowIDs));
  if (!isPlainContainer(value)) return value;
  const rowID = rowIDOf(value);
  const shouldBlank = rowID !== null && rowIDs.has(rowID) && GROUP_KEY_PROPERTY in value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, shouldBlank && key === GROUP_KEY_PROPERTY ? BLANKED_GROUP_KEY : blankGroupKeys(child, rowIDs)])
  );
}

async function groupKeysAreEqualUnderCollation(connection: Connection, actualKey: unknown, expectedKey: unknown): Promise<boolean> {
  if (actualKey === null || expectedKey === null) return actualKey === expectedKey;
  const [rows] = await connection.query(COLLATION_EQUALITY_SQL, [actualKey, expectedKey]);
  return (rows as Array<{ same: number }>)[0].same === 1;
}

async function findGroupKeyMismatch(
  connection: Connection,
  actualKeys: Map<number, unknown[]>,
  expectedKeys: Map<number, unknown[]>
): Promise<DifferingPath | null> {
  const rowIDs = [...new Set([...actualKeys.keys(), ...expectedKeys.keys()])].sort((a, b) => a - b);
  for (const rowID of rowIDs) {
    const actual = actualKeys.get(rowID) ?? [];
    const expected = expectedKeys.get(rowID) ?? [];
    const path = `${GROUP_KEY_PROPERTY} of row ${rowID} (compared under utf8mb4_0900_ai_ci)`;
    if (actual.length !== expected.length) return { path: `${path}.length`, actual: actual.length, expected: expected.length };
    for (let index = 0; index < actual.length; index++) {
      if (!(await groupKeysAreEqualUnderCollation(connection, actual[index], expected[index])))
        return { path: `${path}[${index}]`, actual: actual[index], expected: expected[index] };
    }
  }
  return null;
}

function describeValue(value: unknown): string {
  const text = inspect(value, { depth: MISMATCH_INSPECT_DEPTH, breakLength: Infinity });
  return text.length > MISMATCH_VALUE_MAX_CHARS ? `${text.slice(0, MISMATCH_VALUE_MAX_CHARS)}... (${text.length} chars)` : text;
}

export function describeMismatch(context: Record<string, unknown>, differing: DifferingPath): string {
  return [
    'EXPLORER MISMATCH',
    `  context: ${describeValue(context)}`,
    `  first differing path: ${differing.path}`,
    `  actual:   ${describeValue(differing.actual)}`,
    `  expected: ${describeValue(differing.expected)}`
  ].join('\n');
}

/** toEqual with a verbose failure message; group keys of the listed measurement IDs are compared under utf8mb4_0900_ai_ci first, then blanked on both sides (F7). */
export async function expectExplorerEqual(
  connection: Connection,
  context: Record<string, unknown>,
  actual: unknown,
  expected: unknown,
  collationKeyRowIDs: ReadonlySet<number> = new Set()
): Promise<void> {
  const keyMismatch = await findGroupKeyMismatch(connection, collectGroupKeys(actual, collationKeyRowIDs), collectGroupKeys(expected, collationKeyRowIDs));
  const comparableActual = blankGroupKeys(actual, collationKeyRowIDs);
  const comparableExpected = blankGroupKeys(expected, collationKeyRowIDs);
  const differing = keyMismatch ?? firstDifferingPath(comparableActual, comparableExpected);
  if (differing) {
    const message = describeMismatch(context, differing);
    console.log(message);
    throw new Error(message);
  }
  expect(comparableActual, `explorer result for ${JSON.stringify(context)}`).toEqual(comparableExpected);
}

type Random = () => number;

const MEASUREMENT_ID_BLOCK_SIZE = 1000;
const PLANTED_FIRST_ID = 5000;
const FIRST_CENSUS: FixtureCensus = { censusID: FIRST_CENSUS_ID, plotID: MAIN_PLOT_ID, plotCensusNumber: null };
const SECOND_CENSUS: FixtureCensus = { censusID: SECOND_CENSUS_ID, plotID: MAIN_PLOT_ID, plotCensusNumber: null };
const DECOY_CENSUS: FixtureCensus = { censusID: DECOY_CENSUS_ID, plotID: DECOY_PLOT_ID, plotCensusNumber: null };
const FIXTURE_CENSUSES: FixtureCensus[] = [FIRST_CENSUS, SECOND_CENSUS, DECOY_CENSUS];
const RANDOM_ROW_COUNTS: ReadonlyArray<{ census: FixtureCensus; count: number }> = [
  { census: FIRST_CENSUS, count: 260 },
  { census: SECOND_CENSUS, count: 100 },
  { census: DECOY_CENSUS, count: 40 }
];
const ACTIVE_RATE = 0.9;
const STALE_SUMMARY_RATE = 0.05;
const FAILED_ROW_RATE = 0.1;
const FAILED_ROW_STALE_STEM_NULL_RATE = 0.5;
const NULL_DATE_RATE = 0.1;
const NO_UPLOAD_RATE = 0.2;
const RESOLVED_LOG_RATE = 0.2;
const BLANK_TREE_TAG_RATE = 0.06;
const TREE_TAG_POOL_SIZE = 40;
const VALIDATION_STATES: ReadonlyArray<boolean | null> = [true, false, null];
const MEASUREMENT_DATES: readonly string[] = ['2020-03-01', '2020-03-02', '2020-03-03', '2020-03-04'];
const STEM_TAGS: ReadonlyArray<string | null> = ['1', '1', '2', '', null, ' '];
const BLANK_TREE_TAGS: ReadonlyArray<string | null> = [null, '', ' '];
const SPECIES_CODES: readonly string[] = ['AAA', 'aaa', 'BBB', 'CCC'];
const QUADRAT_NAMES: readonly string[] = ['Q01', 'Q02', 'Q03', 'Q04', 'Q05'];
const UPLOAD_FILES: readonly string[] = ['file-a', 'file-b'];
const UPLOAD_BATCHES: readonly string[] = ['batch-1', 'batch-2'];
const RAW_CODES: ReadonlyArray<string | null> = [null, null, null, 'R', 'D;R', 'broken stem'];
const DESCRIPTIONS: ReadonlyArray<string | null> = [null, null, 'resprout', 'leaning'];
const HOM_VALUES: ReadonlyArray<number | null> = [null, 1.3, 2.6];
const LOG_COUNT_THRESHOLDS: readonly number[] = [0.4, 0.7, 0.9];
const PRIOR_SNAPSHOT_CODES: ReadonlySet<string> = new Set(['1', '2']);
const DBH_MIN = 10;
const DBH_SPAN = 490;
const COORDINATE_SPAN = 20;
const PRIOR_DBH_FACTOR_MIN = 0.5;

const FIXTURE_ERROR_TYPES: FixtureErrorType[] = [
  { errorID: FIXTURE_ERROR_TYPE_IDS.dbhGrowth, source: 'validation', code: '1', message: FIXTURE_MESSAGES.dbhGrowth },
  { errorID: FIXTURE_ERROR_TYPE_IDS.dbhShrinkage, source: 'validation', code: '2', message: FIXTURE_MESSAGES.dbhShrinkage },
  { errorID: FIXTURE_ERROR_TYPE_IDS.fallbackFields, source: 'validation', code: '5', message: FIXTURE_MESSAGES.fallbackFields },
  { errorID: FIXTURE_ERROR_TYPE_IDS.semicolonCriteria, source: 'validation', code: '6', message: FIXTURE_MESSAGES.semicolonCriteria },
  { errorID: FIXTURE_ERROR_TYPE_IDS.sharedMessageFirst, source: 'validation', code: '8', message: FIXTURE_MESSAGES.shared },
  { errorID: FIXTURE_ERROR_TYPE_IDS.sharedMessageSecond, source: 'validation', code: '9', message: FIXTURE_MESSAGES.shared },
  { errorID: FIXTURE_ERROR_TYPE_IDS.tagMismatch, source: 'validation', code: '10', message: FIXTURE_MESSAGES.tagMismatch },
  { errorID: FIXTURE_ERROR_TYPE_IDS.tagMismatchLowerCase, source: 'validation', code: '11', message: FIXTURE_MESSAGES.tagMismatchLowerCase },
  { errorID: FIXTURE_ERROR_TYPE_IDS.semicolonMessage, source: 'validation', code: '12', message: FIXTURE_MESSAGES.semicolonMessage },
  { errorID: FIXTURE_ERROR_TYPE_IDS.invalidSpecies, source: 'ingestion', code: 'INVALID_SPECIES', message: FIXTURE_MESSAGES.invalidSpecies },
  { errorID: FIXTURE_ERROR_TYPE_IDS.sqlException, source: 'ingestion', code: 'SQL_EXCEPTION', message: FIXTURE_MESSAGES.sqlException },
  { errorID: FIXTURE_ERROR_TYPE_IDS.nullCode, source: 'ingestion', code: null, message: FIXTURE_MESSAGES.nullCode }
];

/** Code '5' has empty criteria (fallback field map), code '9' has no validation row, and codes '1', '5' and '10' have no description, so their message comes from the error catalog. */
const FIXTURE_VALIDATIONS: FixtureValidation[] = [
  { validationID: 1, procedureName: 'ValidateDBHGrowth', description: null, criteria: 'measuredDBH' },
  { validationID: 2, procedureName: 'ValidateDBHShrinkage', description: FIXTURE_MESSAGES.dbhShrinkage, criteria: 'measuredDBH' },
  { validationID: 5, procedureName: 'ValidateTagsPresent', description: null, criteria: '' },
  { validationID: 6, procedureName: 'ValidateTagsAgainstStemRegister', description: FIXTURE_MESSAGES.semicolonCriteria, criteria: 'treeTag;stemTag' },
  { validationID: 8, procedureName: 'ValidateSpeciesAgainstTree', description: FIXTURE_MESSAGES.shared, criteria: 'speciesCode' },
  { validationID: 10, procedureName: 'ValidateTagMismatch', description: null, criteria: 'treeTag' },
  { validationID: 11, procedureName: 'ValidateTagMismatchLowerCase', description: FIXTURE_MESSAGES.tagMismatchLowerCase, criteria: 'stemTag' },
  { validationID: 12, procedureName: 'ValidateConditions', description: FIXTURE_MESSAGES.semicolonMessage, criteria: 'measuredDBH' }
];

const pickOne = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];
const chance = (random: Random, probability: number): boolean => random() < probability;
const roundTo = (value: number, decimals: number): number => Math.round(value * 10 ** decimals) / 10 ** decimals;

function sampleDistinct<T>(random: Random, items: readonly T[], count: number): T[] {
  const remaining = [...items];
  const sampled: T[] = [];
  while (sampled.length < count && remaining.length > 0) sampled.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0]);
  return sampled;
}

function pickLogCount(random: Random): number {
  const draw = random();
  const index = LOG_COUNT_THRESHOLDS.findIndex(threshold => draw < threshold);
  return index === -1 ? LOG_COUNT_THRESHOLDS.length : index;
}

function randomMeasurement(random: Random, coreMeasurementID: number, census: FixtureCensus): FixtureMeasurement {
  const summaryIsValidated = pickOne(random, VALIDATION_STATES);
  const isStale = chance(random, STALE_SUMMARY_RATE);
  const isFailed = chance(random, FAILED_ROW_RATE);
  const hasUpload = !chance(random, NO_UPLOAD_RATE);
  return {
    coreMeasurementID,
    plotID: census.plotID,
    censusID: census.censusID,
    isActive: chance(random, ACTIVE_RATE),
    coreStemGUID: isFailed ? null : coreMeasurementID,
    summaryStemGUID: isFailed && chance(random, FAILED_ROW_STALE_STEM_NULL_RATE) ? null : coreMeasurementID,
    coreIsValidated: isStale ? !summaryIsValidated : summaryIsValidated,
    summaryIsValidated,
    treeTag: chance(random, BLANK_TREE_TAG_RATE) ? pickOne(random, BLANK_TREE_TAGS) : `T${1 + Math.floor(random() * TREE_TAG_POOL_SIZE)}`,
    stemTag: pickOne(random, STEM_TAGS),
    speciesCode: pickOne(random, SPECIES_CODES),
    quadratName: pickOne(random, QUADRAT_NAMES),
    measurementDate: chance(random, NULL_DATE_RATE) ? null : pickOne(random, MEASUREMENT_DATES),
    measuredDBH: roundTo(DBH_MIN + random() * DBH_SPAN, 1),
    measuredHOM: pickOne(random, HOM_VALUES),
    rawCodes: pickOne(random, RAW_CODES),
    stemLocalX: chance(random, NULL_DATE_RATE) ? null : roundTo(random() * COORDINATE_SPAN, 2),
    stemLocalY: chance(random, NULL_DATE_RATE) ? null : roundTo(random() * COORDINATE_SPAN, 2),
    description: pickOne(random, DESCRIPTIONS),
    uploadFileID: hasUpload ? pickOne(random, UPLOAD_FILES) : null,
    uploadBatchID: hasUpload ? pickOne(random, UPLOAD_BATCHES) : null
  };
}

function randomLogs(random: Random, measurement: FixtureMeasurement): FixtureLog[] {
  const errorTypes = sampleDistinct(random, FIXTURE_ERROR_TYPES, pickLogCount(random));
  return errorTypes.map(errorType => {
    const log: FixtureLog = { measurementID: measurement.coreMeasurementID, errorID: errorType.errorID, isResolved: chance(random, RESOLVED_LOG_RATE) };
    if (errorType.source === 'validation' && errorType.code !== null && PRIOR_SNAPSHOT_CODES.has(errorType.code)) {
      log.priorCensusID = measurement.censusID > FIRST_CENSUS_ID ? measurement.censusID - 1 : null;
      log.priorDBH = roundTo((measurement.measuredDBH ?? DBH_MIN) * (PRIOR_DBH_FACTOR_MIN + random()), 1);
      log.priorHOM = pickOne(random, HOM_VALUES);
    }
    return log;
  });
}

interface PlantedRows {
  measurements: FixtureMeasurement[];
  logs: FixtureLog[];
  witnessRowIDs: number[];
}

/** Every seed carries the same planted rows: they are the cases the random draw cannot be trusted to produce. */
function plantedRows(): PlantedRows {
  const ET = FIXTURE_ERROR_TYPE_IDS;
  const measurements: FixtureMeasurement[] = [];
  const logs: FixtureLog[] = [];
  let nextID = PLANTED_FIRST_ID;
  const plant = (overrides: Partial<FixtureMeasurement> = {}, unresolvedErrorIDs: number[] = [], resolvedErrorIDs: number[] = []): number => {
    const coreMeasurementID = nextID++;
    measurements.push({
      coreMeasurementID,
      plotID: MAIN_PLOT_ID,
      censusID: FIRST_CENSUS_ID,
      isActive: true,
      coreStemGUID: coreMeasurementID,
      summaryStemGUID: coreMeasurementID,
      coreIsValidated: true,
      summaryIsValidated: true,
      treeTag: null,
      stemTag: null,
      speciesCode: 'AAA',
      quadratName: 'Q01',
      measurementDate: MEASUREMENT_DATES[0],
      measuredDBH: 12.5,
      measuredHOM: 1.3,
      rawCodes: null,
      stemLocalX: 1.5,
      stemLocalY: 2.5,
      description: null,
      uploadFileID: null,
      uploadBatchID: null,
      ...overrides
    });
    unresolvedErrorIDs.forEach(errorID => logs.push({ measurementID: coreMeasurementID, errorID, isResolved: false }));
    resolvedErrorIDs.forEach(errorID => logs.push({ measurementID: coreMeasurementID, errorID, isResolved: true }));
    return coreMeasurementID;
  };
  const sameBatch = { uploadFileID: UPLOAD_FILES[0], uploadBatchID: UPLOAD_BATCHES[0] };

  plant({ treeTag: 'D1', stemTag: '1' }, [ET.semicolonCriteria]);
  plant({ treeTag: 'D1', stemTag: '1' }, [ET.tagMismatch]);
  plant({ treeTag: 'D2', stemTag: '1' }, [ET.sharedMessageFirst]);
  plant({ treeTag: 'D2', stemTag: '1' });
  plant({ treeTag: 'D3', stemTag: '1' }, [ET.invalidSpecies]);
  plant({ treeTag: 'D3', stemTag: '1' }, [ET.sqlException, ET.sharedMessageSecond]);
  plant({ treeTag: 'D3', stemTag: '1' });
  plant({ treeTag: 'D4', stemTag: '1' }, [ET.sharedMessageFirst]);
  plant({ treeTag: 'D4', stemTag: '1', isActive: false }, [ET.tagMismatch]);
  plant({ treeTag: 'D5', stemTag: '1' }, [ET.dbhGrowth]);
  plant({ treeTag: 'D5', stemTag: '1' }, [ET.dbhShrinkage]);
  plant({ treeTag: 'D5', stemTag: '2' }, [ET.fallbackFields]);
  plant({ treeTag: 'S1', stemTag: '1', speciesCode: 'AAA', ...sameBatch }, [ET.invalidSpecies]);
  plant({ treeTag: 'S1', stemTag: '2', speciesCode: 'BBB', ...sameBatch }, [ET.invalidSpecies]);
  plant({ treeTag: 'S2', stemTag: '1', speciesCode: 'AAA', ...sameBatch }, [ET.tagMismatchLowerCase]);
  plant({ treeTag: 'S2', stemTag: '2', speciesCode: 'aaa', ...sameBatch }, [ET.tagMismatchLowerCase]);
  const bothBatch = { uploadFileID: UPLOAD_FILES[1], uploadBatchID: UPLOAD_BATCHES[1] };
  plant({ treeTag: 'C1', stemTag: '1', speciesCode: 'CCC', ...bothBatch }, [ET.sqlException]);
  plant({ treeTag: 'C1', stemTag: '1', speciesCode: 'BBB', ...bothBatch }, [ET.sqlException]);
  plant({ treeTag: 'U1', stemTag: '1' }, [ET.nullCode]);
  const witnessRowIDs = WITNESS_TREE_TAGS.map(treeTag => plant({ treeTag, stemTag: WITNESS_STEM_TAG }, [ET.tagMismatch]));
  BLANK_TREE_TAGS.forEach(treeTag => plant({ treeTag, stemTag: '1' }, [ET.fallbackFields]));
  BLANK_TREE_TAGS.forEach((stemTag, index) => plant({ treeTag: `B${index + 1}`, stemTag }, [ET.fallbackFields]));
  plant({ treeTag: 'M1', stemTag: '1' }, [ET.semicolonMessage]);
  plant({ treeTag: 'X1', stemTag: '1', coreIsValidated: true, summaryIsValidated: false });
  plant({ treeTag: 'X2', stemTag: '1', coreIsValidated: false, summaryIsValidated: true }, [ET.sqlException]);
  plant({ treeTag: 'X3', stemTag: '1', coreStemGUID: null, summaryStemGUID: null }, [ET.invalidSpecies]);
  plant({ treeTag: 'X4', stemTag: '1', measurementDate: null }, [ET.nullCode]);
  plant({ treeTag: 'X5', stemTag: '1', coreIsValidated: null, summaryIsValidated: null }, [ET.sharedMessageFirst]);
  plant({ treeTag: 'X6', stemTag: '1', coreIsValidated: false, summaryIsValidated: false }, [], [ET.tagMismatch]);
  plant({ treeTag: 'X7', stemTag: '1' }, [], [ET.tagMismatch]);
  plant({ treeTag: 'X8', stemTag: '1' });

  return { measurements, logs, witnessRowIDs };
}

export function generateEquivalenceFixture(seed: number): GeneratedFixture {
  const random = seededRandom(seed);
  const measurements: FixtureMeasurement[] = [];
  const logs: FixtureLog[] = [];
  RANDOM_ROW_COUNTS.forEach(({ census, count }) => {
    for (let index = 1; index <= count; index++) {
      const measurement = randomMeasurement(random, census.censusID * MEASUREMENT_ID_BLOCK_SIZE + index, census);
      measurements.push(measurement);
      logs.push(...randomLogs(random, measurement));
    }
  });
  const planted = plantedRows();
  return {
    seed,
    plotIDs: [MAIN_PLOT_ID, DECOY_PLOT_ID],
    censuses: FIXTURE_CENSUSES.map(census => ({ ...census })),
    errorTypes: FIXTURE_ERROR_TYPES.map(type => ({ ...type })),
    validations: FIXTURE_VALIDATIONS.map(validation => ({ ...validation })),
    measurements: [...measurements, ...planted.measurements],
    logs: [...logs, ...planted.logs],
    witnessRowIDs: planted.witnessRowIDs
  };
}
