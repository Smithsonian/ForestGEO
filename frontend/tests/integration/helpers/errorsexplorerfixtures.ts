import { inspect } from 'node:util';
import mysql, { type Connection } from 'mysql2/promise';
import { expect } from 'vitest';
import { DEFAULT_TEST_CONFIG, loadSchema, seededRandom } from '../../setup/local-db-setup';
import { runQueryDispatch } from '../../setup/runquerydispatch';
import { cleanupTimingConnections, createTestDatabaseStrict } from '../../setup/stricttestdatabasecleanup';
import { TEST_DB_DRIVER_TIMEZONE } from '../../setup/test-db-connection';
import { NO_LOG_ERROR_MESSAGE, readStatementLabel } from '@/app/api/errors/explorer/errorsetsql';
import { applyShowValue, DEFAULT_ERROR_EXPLORER_FILTERS, ERRORS_EXPLORER_SHOW_OPTIONS, type ErrorExplorerFilters } from '@/config/errorsexplorer';

export interface ShowFilterSet {
  label: string;
  filters: ErrorExplorerFilters;
}

export const SHOW_FILTER_SETS: readonly ShowFilterSet[] = ERRORS_EXPLORER_SHOW_OPTIONS.map(option => ({
  label: option.value,
  filters: applyShowValue(DEFAULT_ERROR_EXPLORER_FILTERS, option.value)
}));

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

export const SHARED_IDENTITY_ERROR_IDS = { first: 13, second: 14 } as const;

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
  sharedIdentity: 'Two catalog entries describe this one failure',
  noLogFallback: NO_LOG_ERROR_MESSAGE,
  matchesNothing: 'No such message'
} as const;

export const WITNESS_TREE_TAGS = ['Ab1', 'ab1', 'Áb1'] as const;
export const WITNESS_NON_ERROR_TREE_TAG = 'AB1';
export const WITNESS_STEM_TAG = '1';
export const WITNESS_STEM_VARIANT_TREE_TAG = 'Wst';
export const WITNESS_ERROR_STEM_TAGS = ['Sa', 'sA'] as const;
export const WITNESS_NON_ERROR_STEM_TAG = 'SA';
export const WITNESS_SAME_BATCH_ERROR_TREE_TAGS = ['Sb1', 'sb1'] as const;
export const WITNESS_SAME_BATCH_NON_ERROR_TREE_TAG = 'SB1';
export const SINGLE_ERROR_TREE_TAG_PAIR = ['Ab2', 'aB2'] as const;
export const ACCENT_ONLY_TREE_TAG_PAIR = ['Áb3', 'Ab3'] as const;
export const SINGLE_ERROR_STEM_PAIR_TREE_TAG = 'Wst2';
export const SINGLE_ERROR_STEM_TAG_PAIR = ['Sd', 'sD'] as const;
export const SINGLE_ERROR_SAME_BATCH_PAIR = ['Sb2', 'sb2'] as const;
export const SAME_BATCH_PLOT_MISMATCH_TREE_TAG = 'S2';
export const ATTRIBUTES_ONLY_TOKEN = 'buttressed';
export const SEARCH_PAIR_TREE_TAG = 'T12';
export const SEARCH_PAIR_STEM_TAG = '1';
export const PLOT_MISMATCH_TREE_TAG = 'D1';
export const PLOT_MISMATCH_STEM_TAG = '1';
export const PRIOR_DBH_TREE_TAG = 'PD';
export const PRIOR_DBH_STEM_TAG = '1';
export const PRIOR_DBH_PLANTED_MEASURED_DBH = 12.5;
export const PRIOR_DBH_ZERO = 0;
export const PRIOR_DBH_NULL = null;
export const PRIOR_DBH_ROUNDED_VALUE = 9;
export const PRIOR_DBH_ROUNDED_PERCENT = 38.9;
export const INACTIVE_CLEAN_TREE_TAG = 'IN1';
export const OUTSIDE_PARTNER_ID = 70;
export const OUTSIDE_PARTNER_ERROR_MEMBER_ID = 701;
export const OUTSIDE_PARTNER_TREE_TAG = 'PH1';
export const OUTSIDE_PARTNER_STEM_TAG = '1';

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
  quadratID: number | null;
  treeID: number | null;
  speciesID: number | null;
  speciesName: string | null;
  subspeciesName: string | null;
  stemPlotX: string | number | null;
  stemPlotY: string | number | null;
  attributes: string | null;
  userDefinedFields: Record<string, unknown> | null;
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
export interface WitnessGroups {
  treeTagVariants: number[];
  stemTagVariants: number[];
  sameBatchVariants: number[];
  /** Each pair is [error member, non-error member]. */
  singleErrorTreeTagPair: number[];
  accentOnlyTreeTagPair: number[];
  singleErrorStemTagPair: number[];
  singleErrorSameBatchPair: number[];
}
export interface DbhChangeRowIDs {
  priorZero: number;
  priorNull: number;
  priorRounded: number;
}
export interface SharedIdentityRowIDs {
  /** Linked to both catalog entries of the shared identity. */
  linkedToBoth: number;
  /** Linked to the first catalog entry only. */
  linkedToFirstOnly: number;
}
export interface OutsidePartnerRowIDs {
  /** A longer ID whose duplicate group also holds a partner outside the error set; the partner's ID is a prefix of this ID. */
  errorMember: number;
  outsidePartner: number;
}
export interface PlantedCaseRowIDs {
  dbhChange: DbhChangeRowIDs;
  sharedIdentity: SharedIdentityRowIDs;
  outsidePartner: OutsidePartnerRowIDs;
  inactiveClean: number;
}
export interface GeneratedFixture extends ExplorerFixture {
  seed: number;
  /** Rows whose contradictionGroupKey spelling depends on which group member MySQL picks: compared under the collation. */
  witnessRowIDs: number[];
  witnessGroups: WitnessGroups;
  /** Rows whose summary PlotID differs from their census's plot. */
  mismatchedPlotRowIDs: number[];
  plantedCases: PlantedCaseRowIDs;
}

export function resolveEquivalenceSeeds(rawEnvValue: string | undefined = process.env[EQUIVALENCE_SEEDS_ENV]): number[] {
  if (!rawEnvValue?.trim()) return [...DEFAULT_SEEDS];
  const parts = rawEnvValue.split(',').map(part => part.trim());
  const seeds = parts.map(part => (part === '' ? NaN : Number(part)));
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
 * drops the schema before rethrowing. A step that is merely slow is not a throw: a vitest hook timeout abandons the pending
 * promise without cancelling it, and the connections and schema it opens afterwards are only reachable through that promise.
 * Test files therefore go through createFixtureDatabaseSession, whose close() awaits a pending open before tearing down.
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

/** Above the 90 s vitest hookTimeout that setup overran at host load 18; setup itself takes about 2 s on an idle host. */
export const FIXTURE_HOOK_TIMEOUT_MS = 5 * 60 * 1000;

export class FixtureSessionAlreadyOpenError extends Error {
  constructor(readonly database: string) {
    super(`The fixture session for ${database} is already open; close() it before opening again`);
    this.name = 'FixtureSessionAlreadyOpenError';
  }
}

export interface FixtureDatabaseSession {
  /** Starts openFixtureDatabase and remembers the pending promise so that close() can wait for it. Rejects with FixtureSessionAlreadyOpenError until close() has run. */
  open(): Promise<FixtureDatabase>;
  /**
   * Waits for a pending open, then tears down what it opened. A rejected open is logged with its parts and not rethrown: the open cleaned up after
   * itself where it could, and a failure in an abandoned hook has no other reporter, so a schema left behind is named in that log.
   */
  close(): Promise<void>;
}

function logAbandonedOpenFailure(database: string, openError: unknown): void {
  const parts = openError instanceof AggregateError ? openError.errors : [openError];
  console.error(
    `[fixture session] open of ${database} failed and its cleanup may be incomplete: the schema or its connections may remain.`,
    `${parts.length} part(s):`
  );
  parts.forEach((part, index) => console.error(`[fixture session] part ${index + 1} of ${parts.length}:`, inspect(part, { depth: null })));
}

export function createFixtureDatabaseSession(database: string): FixtureDatabaseSession {
  let pendingOpen: Promise<FixtureDatabase> | null = null;
  return {
    open: () => {
      if (pendingOpen) return Promise.reject(new FixtureSessionAlreadyOpenError(database));
      pendingOpen = openFixtureDatabase(database);
      return pendingOpen;
    },
    close: async () => {
      const opening = pendingOpen;
      pendingOpen = null;
      if (!opening) return;
      let opened: FixtureDatabase;
      try {
        opened = await opening;
      } catch (openError) {
        logAbandonedOpenFailure(database, openError);
        return;
      }
      await opened.teardown();
    }
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
        'Description',
        'QuadratID',
        'TreeID',
        'SpeciesID',
        'SpeciesName',
        'SubspeciesName',
        'StemPlotX',
        'StemPlotY',
        'Attributes',
        'UserDefinedFields'
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
        row.description,
        row.quadratID,
        row.treeID,
        row.speciesID,
        row.speciesName,
        row.subspeciesName,
        row.stemPlotX,
        row.stemPlotY,
        row.attributes,
        row.userDefinedFields === null ? null : JSON.stringify(row.userDefinedFields)
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
  /** Throws, naming the labels, if any registered hook has not fired yet. */
  assertAllHooksFired(): void;
}

export interface RecordingExecutorOptions {
  /** JSON-serialising every result set costs more than the query on the whole-list statements; the equivalence sweep turns it off and records 0. */
  measureJsonBytes?: boolean;
}

export function createRecordingExecutor(connection: Pick<Connection, 'query' | 'execute'>, options: RecordingExecutorOptions = {}): RecordingExecutor {
  const { measureJsonBytes = true } = options;
  const statements: RecordedStatement[] = [];
  const pendingHooks = new Map<string, () => Promise<void>>();
  return {
    statements,
    reset: () => {
      statements.length = 0;
    },
    afterStatementOnce: (label, hook) => {
      if (pendingHooks.has(label)) throw new Error(`A hook for statement label ${label} is already registered and has not fired`);
      pendingHooks.set(label, hook);
    },
    assertAllHooksFired: () => {
      if (pendingHooks.size > 0) throw new Error(`Hooks never fired for statement labels: ${[...pendingHooks.keys()].join(', ')}`);
    },
    executeQuery: async (sql, params = []) => {
      const rows = await runQueryDispatch(connection, sql, params);
      const label = readStatementLabel(sql);
      statements.push({
        label,
        sql,
        params: [...params],
        rows: Array.isArray(rows) ? rows.length : 0,
        jsonBytes: measureJsonBytes ? Buffer.byteLength(JSON.stringify(rows)) : 0
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
  if (actualKey === expectedKey) return true;
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
const SAME_BATCH_VARIANT_SPECIES: readonly string[] = ['AAA', 'BBB', 'CCC'];
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
const QUADRAT_ID_BASE = 300;
const QUADRAT_ID_MODULUS = 97;
const TREE_ID_BASE = 100_000;
const SPECIES_ID_BASE = 5000;
const SPECIES_ID_MODULUS = 53;
const SUBSPECIES_NULL_EVERY = 3;
const PLOT_X_STEP = 0.125;
const PLOT_X_OFFSET = 0.25;
const PLOT_Y_STEP = 0.0625;
const PLOT_Y_OFFSET = 0.75;
const ATTRIBUTES: ReadonlyArray<string | null> = [null, null, 'fluted', 'hollow', 'snag'];

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

/** Two catalog rows with a NULL code and one message are one identity under two ErrorIDs. They are kept out of FIXTURE_ERROR_TYPES so the seeded random draw is unchanged. */
const SHARED_IDENTITY_ERROR_TYPES: FixtureErrorType[] = [
  { errorID: SHARED_IDENTITY_ERROR_IDS.first, source: 'ingestion', code: null, message: FIXTURE_MESSAGES.sharedIdentity },
  { errorID: SHARED_IDENTITY_ERROR_IDS.second, source: 'ingestion', code: null, message: FIXTURE_MESSAGES.sharedIdentity }
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

type DisplayColumns = Pick<
  FixtureMeasurement,
  'quadratID' | 'treeID' | 'speciesID' | 'speciesName' | 'subspeciesName' | 'stemPlotX' | 'stemPlotY' | 'attributes' | 'userDefinedFields'
>;

/** Every id yields values that differ from the other columns' values for the same row, so a swapped or dropped column shows up as a difference. */
function displayColumnsFor(coreMeasurementID: number, attributes: string | null): DisplayColumns {
  return {
    quadratID: QUADRAT_ID_BASE + (coreMeasurementID % QUADRAT_ID_MODULUS),
    treeID: TREE_ID_BASE + coreMeasurementID,
    speciesID: SPECIES_ID_BASE + (coreMeasurementID % SPECIES_ID_MODULUS),
    speciesName: `Genus ${coreMeasurementID % SPECIES_ID_MODULUS}`,
    subspeciesName: coreMeasurementID % SUBSPECIES_NULL_EVERY === 0 ? null : `subsp. ${coreMeasurementID}`,
    stemPlotX: coreMeasurementID * PLOT_X_STEP + PLOT_X_OFFSET,
    stemPlotY: coreMeasurementID * PLOT_Y_STEP + PLOT_Y_OFFSET,
    attributes,
    userDefinedFields: { ordinal: coreMeasurementID, label: `row-${coreMeasurementID}`, flags: [coreMeasurementID % 2 === 0] }
  };
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
    ...displayColumnsFor(coreMeasurementID, pickOne(random, ATTRIBUTES)),
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
  witnessGroups: WitnessGroups;
  mismatchedPlotRowIDs: number[];
  plantedCases: PlantedCaseRowIDs;
}

/** Every seed carries the same planted rows: they are the cases the random draw cannot be trusted to produce. */
function plantedRows(): PlantedRows {
  const ET = FIXTURE_ERROR_TYPE_IDS;
  const measurements: FixtureMeasurement[] = [];
  const logs: FixtureLog[] = [];
  let nextID = PLANTED_FIRST_ID;
  const plant = (overrides: Partial<FixtureMeasurement> = {}, unresolvedErrorIDs: number[] = [], resolvedErrorIDs: number[] = []): number => {
    const coreMeasurementID = overrides.coreMeasurementID ?? nextID++;
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
      ...displayColumnsFor(coreMeasurementID, null),
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
  const witnessTreeErrorRowIDs = WITNESS_TREE_TAGS.map(treeTag => plant({ treeTag, stemTag: WITNESS_STEM_TAG }, [ET.tagMismatch]));
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

  const witnessTreeNonErrorRowID = plant({ treeTag: WITNESS_NON_ERROR_TREE_TAG, stemTag: WITNESS_STEM_TAG });
  const witnessStemErrorRowIDs = WITNESS_ERROR_STEM_TAGS.map(stemTag => plant({ treeTag: WITNESS_STEM_VARIANT_TREE_TAG, stemTag }, [ET.tagMismatch]));
  const witnessStemNonErrorRowID = plant({ treeTag: WITNESS_STEM_VARIANT_TREE_TAG, stemTag: WITNESS_NON_ERROR_STEM_TAG });
  const witnessSameBatchErrorRowIDs = WITNESS_SAME_BATCH_ERROR_TREE_TAGS.map((treeTag, index) =>
    plant({ treeTag, stemTag: String(index + 1), speciesCode: SAME_BATCH_VARIANT_SPECIES[index], ...sameBatch }, [ET.invalidSpecies])
  );
  const witnessSameBatchNonErrorRowID = plant({
    treeTag: WITNESS_SAME_BATCH_NON_ERROR_TREE_TAG,
    stemTag: String(WITNESS_SAME_BATCH_ERROR_TREE_TAGS.length + 1),
    speciesCode: SAME_BATCH_VARIANT_SPECIES[WITNESS_SAME_BATCH_ERROR_TREE_TAGS.length],
    ...sameBatch
  });
  const [singleErrorTreeTag, singleErrorTreeTagMate] = SINGLE_ERROR_TREE_TAG_PAIR;
  const [singleErrorStemTag, singleErrorStemTagMate] = SINGLE_ERROR_STEM_TAG_PAIR;
  const [singleErrorSameBatchTag, singleErrorSameBatchMate] = SINGLE_ERROR_SAME_BATCH_PAIR;
  const singleErrorTreeTagPair = [
    plant({ treeTag: singleErrorTreeTag, stemTag: WITNESS_STEM_TAG }, [ET.tagMismatch]),
    plant({ treeTag: singleErrorTreeTagMate, stemTag: WITNESS_STEM_TAG })
  ];
  const [accentOnlyErrorTag, accentOnlyMateTag] = ACCENT_ONLY_TREE_TAG_PAIR;
  const accentOnlyTreeTagPair = [
    plant({ treeTag: accentOnlyErrorTag, stemTag: WITNESS_STEM_TAG }, [ET.tagMismatch]),
    plant({ treeTag: accentOnlyMateTag, stemTag: WITNESS_STEM_TAG })
  ];
  const singleErrorStemTagPair = [
    plant({ treeTag: SINGLE_ERROR_STEM_PAIR_TREE_TAG, stemTag: singleErrorStemTag }, [ET.tagMismatch]),
    plant({ treeTag: SINGLE_ERROR_STEM_PAIR_TREE_TAG, stemTag: singleErrorStemTagMate })
  ];
  const singleErrorSameBatchPair = [
    plant({ treeTag: singleErrorSameBatchTag, stemTag: '1', speciesCode: 'AAA', ...sameBatch }, [ET.invalidSpecies]),
    plant({ treeTag: singleErrorSameBatchMate, stemTag: '2', speciesCode: 'BBB', ...sameBatch })
  ];
  const mismatchedPlotRowIDs = [
    plant({ plotID: DECOY_PLOT_ID, treeTag: PLOT_MISMATCH_TREE_TAG, stemTag: PLOT_MISMATCH_STEM_TAG }, [ET.tagMismatch]),
    plant({ plotID: DECOY_PLOT_ID, treeTag: SAME_BATCH_PLOT_MISMATCH_TREE_TAG, stemTag: '1', speciesCode: 'BBB', ...sameBatch }, [ET.tagMismatch])
  ];
  plant({ treeTag: 'A1', stemTag: '1', attributes: ATTRIBUTES_ONLY_TOKEN }, [ET.fallbackFields]);
  plant({ treeTag: SEARCH_PAIR_TREE_TAG, stemTag: SEARCH_PAIR_STEM_TAG }, [ET.fallbackFields]);

  const plantPriorDBHRow = (treeTag: string, errorID: number, priorDBH: number | null): number => {
    const coreMeasurementID = plant({ treeTag, stemTag: PRIOR_DBH_STEM_TAG, measuredDBH: PRIOR_DBH_PLANTED_MEASURED_DBH });
    logs.push({ measurementID: coreMeasurementID, errorID, isResolved: false, priorCensusID: null, priorDBH, priorHOM: null });
    return coreMeasurementID;
  };
  const dbhChange: DbhChangeRowIDs = {
    priorZero: plantPriorDBHRow(`${PRIOR_DBH_TREE_TAG}1`, ET.dbhGrowth, PRIOR_DBH_ZERO),
    priorNull: plantPriorDBHRow(`${PRIOR_DBH_TREE_TAG}2`, ET.dbhShrinkage, PRIOR_DBH_NULL),
    priorRounded: plantPriorDBHRow(`${PRIOR_DBH_TREE_TAG}3`, ET.dbhGrowth, PRIOR_DBH_ROUNDED_VALUE)
  };
  const inactiveClean = plant({ treeTag: INACTIVE_CLEAN_TREE_TAG, stemTag: '1', isActive: false });
  const sharedIdentity: SharedIdentityRowIDs = {
    linkedToBoth: plant({ treeTag: 'SI1', stemTag: '1' }, [SHARED_IDENTITY_ERROR_IDS.first, SHARED_IDENTITY_ERROR_IDS.second]),
    linkedToFirstOnly: plant({ treeTag: 'SI2', stemTag: '1' }, [SHARED_IDENTITY_ERROR_IDS.first])
  };
  const outsidePartner: OutsidePartnerRowIDs = {
    outsidePartner: plant({ coreMeasurementID: OUTSIDE_PARTNER_ID, treeTag: OUTSIDE_PARTNER_TREE_TAG, stemTag: OUTSIDE_PARTNER_STEM_TAG }),
    errorMember: plant({ coreMeasurementID: OUTSIDE_PARTNER_ERROR_MEMBER_ID, treeTag: OUTSIDE_PARTNER_TREE_TAG, stemTag: OUTSIDE_PARTNER_STEM_TAG }, [
      ET.tagMismatch
    ])
  };

  const witnessGroups: WitnessGroups = {
    treeTagVariants: [...witnessTreeErrorRowIDs, witnessTreeNonErrorRowID],
    stemTagVariants: [...witnessStemErrorRowIDs, witnessStemNonErrorRowID],
    sameBatchVariants: [...witnessSameBatchErrorRowIDs, witnessSameBatchNonErrorRowID],
    singleErrorTreeTagPair,
    accentOnlyTreeTagPair,
    singleErrorStemTagPair,
    singleErrorSameBatchPair
  };
  return {
    measurements,
    logs,
    witnessRowIDs: [
      ...witnessGroups.treeTagVariants,
      ...witnessGroups.stemTagVariants,
      ...witnessGroups.sameBatchVariants,
      ...witnessGroups.singleErrorTreeTagPair,
      ...witnessGroups.accentOnlyTreeTagPair,
      ...witnessGroups.singleErrorStemTagPair,
      ...witnessGroups.singleErrorSameBatchPair
    ],
    witnessGroups,
    mismatchedPlotRowIDs,
    plantedCases: { dbhChange, sharedIdentity, outsidePartner, inactiveClean }
  };
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
    errorTypes: [...FIXTURE_ERROR_TYPES, ...SHARED_IDENTITY_ERROR_TYPES].map(type => ({ ...type })),
    validations: FIXTURE_VALIDATIONS.map(validation => ({ ...validation })),
    measurements: [...measurements, ...planted.measurements],
    logs: [...logs, ...planted.logs],
    witnessRowIDs: planted.witnessRowIDs,
    witnessGroups: planted.witnessGroups,
    mismatchedPlotRowIDs: planted.mismatchedPlotRowIDs,
    plantedCases: planted.plantedCases
  };
}

// ---- signature and locale-tie fixtures (T14, spec Testing section 4) ----

export const SIGNATURE_WITNESS_ERROR_IDS = { single: 1, triple: 234, quadruple: 2345 } as const;
export const SIGNATURE_WITNESS_MEASUREMENT_IDS = { quadrupleCarrier: 101, tripleCarrier: 102 } as const;
export const SIGNATURE_WITNESS_COMPLETE_LIMIT = 6;
export const SIGNATURE_WITNESS_CUT_TO_OTHER_KEY_LIMIT = 5;
export const SIGNATURE_WITNESS_CUT_INSIDE_KEY_LIMIT = 4;
export const SIGNATURE_WITNESS_SHARED_KEYS = '1,234';

export const MANY_TYPES_ERROR_COUNT = 40;
export const MANY_TYPES_MEASUREMENT_ID = 101;
export const MANY_TYPES_CUTTING_LIMIT = 64;

export const DISTINCT_SIGNATURE_TYPE_COUNT = 14;
export const DISTINCT_SIGNATURE_MEASUREMENT_COUNT = 10_500;
export const FIXTURE_GENERATED_ROW_CODE = 'SIGNATURE_TYPE';

export const LOCALE_TIE_NFC_TEXT = 'é tie';
export const LOCALE_TIE_NFD_TEXT = 'é tie';
export const LOCALE_TIE_MEASUREMENT_IDS = { carriesSecondType: 101, carriesFirstType: 102 } as const;

const SIGNATURE_FIXTURE_CENSUS: FixtureCensus = { censusID: FIRST_CENSUS_ID, plotID: MAIN_PLOT_ID, plotCensusNumber: 1 };
const SIGNATURE_FIXTURE_DATE = MEASUREMENT_DATES[0];
const SIGNATURE_FIXTURE_DBH = 12.5;
const SIGNATURE_FIXTURE_HOM = 1.3;

function signatureFixtureMeasurement(coreMeasurementID: number): FixtureMeasurement {
  return {
    coreMeasurementID,
    plotID: MAIN_PLOT_ID,
    censusID: FIRST_CENSUS_ID,
    isActive: true,
    coreStemGUID: coreMeasurementID,
    summaryStemGUID: coreMeasurementID,
    coreIsValidated: true,
    summaryIsValidated: true,
    treeTag: `T${coreMeasurementID}`,
    stemTag: '1',
    speciesCode: 'AAA',
    quadratName: 'Q01',
    measurementDate: SIGNATURE_FIXTURE_DATE,
    measuredDBH: SIGNATURE_FIXTURE_DBH,
    measuredHOM: SIGNATURE_FIXTURE_HOM,
    rawCodes: null,
    stemLocalX: 1.5,
    stemLocalY: 2.5,
    ...displayColumnsFor(coreMeasurementID, null),
    description: null,
    uploadFileID: null,
    uploadBatchID: null
  };
}

function generatedErrorType(errorID: number): FixtureErrorType {
  return { errorID, source: 'ingestion', code: `${FIXTURE_GENERATED_ROW_CODE}_${errorID}`, message: `Signature type ${errorID}` };
}

function signatureFixture(
  errorTypes: FixtureErrorType[],
  validations: FixtureValidation[],
  carriers: ReadonlyArray<{ measurementID: number; errorIDs: number[] }>
): ExplorerFixture {
  return {
    plotIDs: [MAIN_PLOT_ID],
    censuses: [{ ...SIGNATURE_FIXTURE_CENSUS }],
    errorTypes,
    validations,
    measurements: carriers.map(carrier => signatureFixtureMeasurement(carrier.measurementID)),
    logs: carriers.flatMap(carrier => carrier.errorIDs.map(errorID => ({ measurementID: carrier.measurementID, errorID, isResolved: false })))
  };
}

/** Types 1, 234 and 2345 (no 23): A carries {1, 2345}, B carries {1, 234}. A cut of one signature can look like a whole key of the other. */
export function signatureWitnessFixture(): ExplorerFixture {
  const ids = SIGNATURE_WITNESS_ERROR_IDS;
  return signatureFixture(
    [ids.single, ids.triple, ids.quadruple].map(generatedErrorType),
    [],
    [
      { measurementID: SIGNATURE_WITNESS_MEASUREMENT_IDS.quadrupleCarrier, errorIDs: [ids.single, ids.quadruple] },
      { measurementID: SIGNATURE_WITNESS_MEASUREMENT_IDS.tripleCarrier, errorIDs: [ids.single, ids.triple] }
    ]
  );
}

/** One measurement carrying error types 1..40. */
export function manyTypesFixture(): ExplorerFixture {
  const errorIDs = Array.from({ length: MANY_TYPES_ERROR_COUNT }, (_, index) => index + 1);
  return signatureFixture(errorIDs.map(generatedErrorType), [], [{ measurementID: MANY_TYPES_MEASUREMENT_ID, errorIDs }]);
}

/** Two ingestion types whose messages are the NFC and NFD forms of one text; the measurement IDs run against the type IDs so the histogram and the oracle meet them in opposite orders. */
export function localeTieMessageFixture(): ExplorerFixture {
  const [firstTypeID, secondTypeID] = [1, 2];
  return signatureFixture(
    [
      { errorID: firstTypeID, source: 'ingestion', code: `${FIXTURE_GENERATED_ROW_CODE}_${firstTypeID}`, message: LOCALE_TIE_NFC_TEXT },
      { errorID: secondTypeID, source: 'ingestion', code: `${FIXTURE_GENERATED_ROW_CODE}_${secondTypeID}`, message: LOCALE_TIE_NFD_TEXT }
    ],
    [],
    [
      { measurementID: LOCALE_TIE_MEASUREMENT_IDS.carriesSecondType, errorIDs: [secondTypeID] },
      { measurementID: LOCALE_TIE_MEASUREMENT_IDS.carriesFirstType, errorIDs: [firstTypeID] }
    ]
  );
}

/** The 14 error types, the plot and the census; the measurements come from seedDistinctSignatureMeasurements. */
export function distinctSignatureTypesFixture(): ExplorerFixture {
  const errorIDs = Array.from({ length: DISTINCT_SIGNATURE_TYPE_COUNT }, (_, index) => index + 1);
  return signatureFixture(errorIDs.map(generatedErrorType), [], []);
}

/**
 * Measurement k (1..DISTINCT_SIGNATURE_MEASUREMENT_COUNT) carries the error types whose ID minus one is a set bit of k, so
 * every measurement has a different non-empty type set. Run it after replaceFixture(distinctSignatureTypesFixture()).
 */
export async function seedDistinctSignatureMeasurements(connection: Connection): Promise<void> {
  await connection.query(`SET SESSION cte_max_recursion_depth = ${DISTINCT_SIGNATURE_MEASUREMENT_COUNT}`);
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const numbers = `WITH RECURSIVE numbers (k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM numbers WHERE k < ${DISTINCT_SIGNATURE_MEASUREMENT_COUNT})`;
    await connection.query(
      `INSERT INTO coremeasurements (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive)
       ${numbers} SELECT k, ?, k, 1, ?, ?, ?, 1 FROM numbers`,
      [FIRST_CENSUS_ID, SIGNATURE_FIXTURE_DATE, SIGNATURE_FIXTURE_DBH, SIGNATURE_FIXTURE_HOM]
    );
    await connection.query(
      `INSERT INTO measurementssummary (CoreMeasurementID, StemGUID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate, MeasuredDBH, MeasuredHOM, IsValidated)
       ${numbers} SELECT k, k, ?, ?, CONCAT('K', k), '1', 'AAA', 'Q01', ?, ?, ?, 1 FROM numbers`,
      [MAIN_PLOT_ID, FIRST_CENSUS_ID, SIGNATURE_FIXTURE_DATE, SIGNATURE_FIXTURE_DBH, SIGNATURE_FIXTURE_HOM]
    );
    await connection.query(
      `INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
       ${numbers} SELECT numbers.k, me.ErrorID, 0 FROM numbers JOIN measurement_errors me ON ((numbers.k >> (me.ErrorID - 1)) & 1) = 1`
    );
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

// ---- GROUP_CONCAT truncation witness (T15, spec Testing section 3, D4) ----

export const TRUNCATION_ERROR_ID = 1;
export const TRUNCATION_UNRELATED_ERROR_ROW_ID = 100;
export const TRUNCATION_DUPLICATE_MEMBER_IDS: readonly number[] = [1001, 1002, 1003];
export const TRUNCATION_DUPLICATE_TREE_TAG = 'DUP';
export const TRUNCATION_UNRELATED_TREE_TAG = 'SOLO';
export const TRUNCATION_STEM_TAG = '1';
/** "1001,1002,1003" is 14 characters; each smaller limit cuts the member list at a different place relative to the separators. */
export const TRUNCATION_LIMITS = { whole: 14, cutInsideThirdID: 13, cutAtSeparator: 10, cutInsideSecondID: 9 } as const;

/** Measurement 100 is an error row that shares no tag pair; 1001 to 1003 share one tag pair, so the three form one duplicate group. Every row carries one unresolved log of error type 1. */
export function groupConcatTruncationFixture(): ExplorerFixture {
  const taggedMeasurement = (coreMeasurementID: number, treeTag: string): FixtureMeasurement => ({
    ...signatureFixtureMeasurement(coreMeasurementID),
    treeTag,
    stemTag: TRUNCATION_STEM_TAG
  });
  const measurements = [
    taggedMeasurement(TRUNCATION_UNRELATED_ERROR_ROW_ID, TRUNCATION_UNRELATED_TREE_TAG),
    ...TRUNCATION_DUPLICATE_MEMBER_IDS.map(memberID => taggedMeasurement(memberID, TRUNCATION_DUPLICATE_TREE_TAG))
  ];
  return {
    plotIDs: [MAIN_PLOT_ID],
    censuses: [{ ...SIGNATURE_FIXTURE_CENSUS }],
    errorTypes: [generatedErrorType(TRUNCATION_ERROR_ID)],
    validations: [],
    measurements,
    logs: measurements.map(measurement => ({ measurementID: measurement.coreMeasurementID, errorID: TRUNCATION_ERROR_ID, isResolved: false }))
  };
}

// ---- census chunks, large group and interleaving fixtures (T16, spec Testing sections 3 and 4) ----

export const MANY_CENSUS_COUNT = 26;
export const MANY_CENSUS_IDS: readonly number[] = Array.from({ length: MANY_CENSUS_COUNT }, (_, index) => index + 1);
export const MANY_CENSUS_ROW_ID_BLOCK = 100;
export const MANY_CENSUS_TREE_TAG_SEARCH = `D${MANY_CENSUS_COUNT}`;
export const MANY_CENSUS_ROW_OFFSET = {
  duplicateFirst: 1,
  duplicateSecond: 2,
  sameBatchFirst: 3,
  sameBatchSecond: 4,
  sharedMessageFirst: 5,
  sqlExceptionAndSharedMessageSecond: 6,
  duplicateNonErrorMate: 7,
  failed: 8
} as const;
const MANY_CENSUS_EQUAL_KEY_DATE = MEASUREMENT_DATES[0];

/**
 * 26 physical censuses of plot 1, eight rows each: a duplicate pair, a same-batch pair and a non-error duplicate mate (so the duplicate group
 * has a member outside the error set), a one-error row and a two-error row whose sort keys are equal in every census, and a failed row.
 * Dates of the grouped rows rotate with the census, so contradiction rows with equal and different keys interleave across the census chunks.
 */
export function manyCensusesFixture(): ExplorerFixture {
  const ET = FIXTURE_ERROR_TYPE_IDS;
  const measurements: FixtureMeasurement[] = [];
  const logs: FixtureLog[] = [];
  const sameBatchUpload = { uploadFileID: UPLOAD_FILES[0], uploadBatchID: UPLOAD_BATCHES[0] };
  for (const censusID of MANY_CENSUS_IDS) {
    const rotatingDate = MEASUREMENT_DATES[censusID % MEASUREMENT_DATES.length];
    const plant = (offset: number, overrides: Partial<FixtureMeasurement>, errorIDs: number[]): void => {
      const coreMeasurementID = censusID * MANY_CENSUS_ROW_ID_BLOCK + offset;
      measurements.push({ ...signatureFixtureMeasurement(coreMeasurementID), censusID, ...overrides });
      errorIDs.forEach(errorID => logs.push({ measurementID: coreMeasurementID, errorID, isResolved: false }));
    };
    const duplicateTag = `D${censusID}`;
    plant(MANY_CENSUS_ROW_OFFSET.duplicateFirst, { treeTag: duplicateTag, stemTag: '1', measurementDate: rotatingDate }, [ET.tagMismatch]);
    plant(MANY_CENSUS_ROW_OFFSET.duplicateSecond, { treeTag: duplicateTag, stemTag: '1', measurementDate: rotatingDate }, [ET.tagMismatch]);
    plant(
      MANY_CENSUS_ROW_OFFSET.sameBatchFirst,
      { treeTag: `S${censusID}`, stemTag: '1', speciesCode: 'AAA', measurementDate: rotatingDate, ...sameBatchUpload },
      [ET.invalidSpecies]
    );
    plant(
      MANY_CENSUS_ROW_OFFSET.sameBatchSecond,
      { treeTag: `S${censusID}`, stemTag: '2', speciesCode: 'BBB', measurementDate: rotatingDate, ...sameBatchUpload },
      [ET.invalidSpecies]
    );
    plant(MANY_CENSUS_ROW_OFFSET.sharedMessageFirst, { treeTag: `P${censusID}`, stemTag: '1', measurementDate: MANY_CENSUS_EQUAL_KEY_DATE }, [
      ET.sharedMessageFirst
    ]);
    plant(MANY_CENSUS_ROW_OFFSET.sqlExceptionAndSharedMessageSecond, { treeTag: `Q${censusID}`, stemTag: '1', measurementDate: MANY_CENSUS_EQUAL_KEY_DATE }, [
      ET.sqlException,
      ET.sharedMessageSecond
    ]);
    plant(MANY_CENSUS_ROW_OFFSET.duplicateNonErrorMate, { treeTag: duplicateTag, stemTag: '1', measurementDate: rotatingDate }, []);
    plant(
      MANY_CENSUS_ROW_OFFSET.failed,
      { treeTag: `F${censusID}`, stemTag: '1', coreStemGUID: null, summaryStemGUID: null, measurementDate: MANY_CENSUS_EQUAL_KEY_DATE },
      [ET.invalidSpecies]
    );
  }
  return {
    plotIDs: [MAIN_PLOT_ID],
    censuses: MANY_CENSUS_IDS.map(censusID => ({ censusID, plotID: MAIN_PLOT_ID, plotCensusNumber: censusID })),
    errorTypes: FIXTURE_ERROR_TYPES.map(type => ({ ...type })),
    validations: FIXTURE_VALIDATIONS.map(validation => ({ ...validation })),
    measurements,
    logs
  };
}

export const LARGE_GROUP_MEMBER_COUNT = 2000;
export const LARGE_GROUP_ERROR_SET_COUNT = 300;
export const LARGE_GROUP_TREE_TAG = 'BIG';
export const LARGE_GROUP_STEM_TAG = '1';
export const LARGE_GROUP_ERROR_ID = 1;
export const LARGE_GROUP_SOLO_ROW_IDS: readonly number[] = [5001, 5002, 5003];
const LARGE_GROUP_ERROR_RUN_LENGTH = 3;
const LARGE_GROUP_ERROR_RUN_PERIOD = 20;

function isLargeGroupErrorMember(memberID: number): boolean {
  return (memberID - 1) % LARGE_GROUP_ERROR_RUN_PERIOD < LARGE_GROUP_ERROR_RUN_LENGTH;
}

const LARGE_GROUP_MEMBER_IDS: readonly number[] = Array.from({ length: LARGE_GROUP_MEMBER_COUNT }, (_, index) => index + 1);
export const LARGE_GROUP_ERROR_MEMBER_IDS: readonly number[] = LARGE_GROUP_MEMBER_IDS.filter(isLargeGroupErrorMember);
export const LARGE_GROUP_FIRST_NON_ERROR_MEMBER_ID = LARGE_GROUP_MEMBER_IDS.find(memberID => !isLargeGroupErrorMember(memberID)) as number;

/** Members 1..2000 of one duplicate group; members whose ID minus one is below 3 modulo 20 (300 of them) carry an unresolved log, the rest are valid rows. Three solo error rows follow the group in the order. */
export function largeGroupFixture(): ExplorerFixture {
  const members = LARGE_GROUP_MEMBER_IDS.map(memberID => ({
    ...signatureFixtureMeasurement(memberID),
    treeTag: LARGE_GROUP_TREE_TAG,
    stemTag: LARGE_GROUP_STEM_TAG
  }));
  const solos = LARGE_GROUP_SOLO_ROW_IDS.map(soloID => ({ ...signatureFixtureMeasurement(soloID), treeTag: `SOLO${soloID}`, stemTag: LARGE_GROUP_STEM_TAG }));
  const errorRowIDs = [...LARGE_GROUP_ERROR_MEMBER_IDS, ...LARGE_GROUP_SOLO_ROW_IDS];
  return {
    plotIDs: [MAIN_PLOT_ID],
    censuses: [{ ...SIGNATURE_FIXTURE_CENSUS }],
    errorTypes: [
      { errorID: LARGE_GROUP_ERROR_ID, source: 'ingestion', code: `${FIXTURE_GENERATED_ROW_CODE}_${LARGE_GROUP_ERROR_ID}`, message: 'Large group message' }
    ],
    validations: [],
    measurements: [...members, ...solos],
    logs: errorRowIDs.map(measurementID => ({ measurementID, errorID: LARGE_GROUP_ERROR_ID, isResolved: false }))
  };
}

export const INTERLEAVING_ERROR_IDS = { messageA: 1, messageB: 2, messageC: 3, editableValidation: 4 } as const;
export const INTERLEAVING_MESSAGES = {
  messageA: 'Interleave message A',
  messageB: 'Interleave message B',
  messageC: 'Interleave message C',
  editableValidationOriginal: 'Interleave original description',
  editableValidationEdited: 'Edited description'
} as const;
export const INTERLEAVING_VALIDATION_ID = 40;
export const INTERLEAVING_ROW_IDS = {
  carriesAAndB: 101,
  carriesAOnly: 102,
  carriesBOnly: 103,
  carriesEditableValidation: 201,
  duplicateErrorMember: 301,
  duplicateMate: 302,
  earliestWithA: 401,
  carriesAAndBAfter: 402,
  carriesAOnlyLast: 403
} as const;
export const INTERLEAVING_DUPLICATE_TREE_TAG = 'DUP';
export const INTERLEAVING_EARLIEST_DATE = '2020-02-15';

/**
 * Default order: 301 (duplicate), then the two-error rows 101 and 402, then 401 (one error, earliest date), then 102, 103, 201, 403.
 * Row 401 gains a second error in case (d); sorted afresh it would move ahead of 101 and 402, so the selected order is what the test pins.
 */
export function interleavingFixture(): ExplorerFixture {
  const ids = INTERLEAVING_ROW_IDS;
  const errorTypeIDs = INTERLEAVING_ERROR_IDS;
  const ingestionType = (errorID: number, message: string): FixtureErrorType => ({ errorID, source: 'ingestion', code: `INTERLEAVE_${errorID}`, message });
  const row = (coreMeasurementID: number, overrides: Partial<FixtureMeasurement> = {}): FixtureMeasurement => ({
    ...signatureFixtureMeasurement(coreMeasurementID),
    ...overrides
  });
  const carriers: Array<{ measurement: FixtureMeasurement; errorIDs: number[] }> = [
    { measurement: row(ids.carriesAAndB), errorIDs: [errorTypeIDs.messageA, errorTypeIDs.messageB] },
    { measurement: row(ids.carriesAOnly), errorIDs: [errorTypeIDs.messageA] },
    { measurement: row(ids.carriesBOnly), errorIDs: [errorTypeIDs.messageB] },
    { measurement: row(ids.carriesEditableValidation), errorIDs: [errorTypeIDs.editableValidation] },
    { measurement: row(ids.duplicateErrorMember, { treeTag: INTERLEAVING_DUPLICATE_TREE_TAG }), errorIDs: [errorTypeIDs.messageA] },
    { measurement: row(ids.duplicateMate, { treeTag: INTERLEAVING_DUPLICATE_TREE_TAG }), errorIDs: [] },
    { measurement: row(ids.earliestWithA, { measurementDate: INTERLEAVING_EARLIEST_DATE }), errorIDs: [errorTypeIDs.messageA] },
    { measurement: row(ids.carriesAAndBAfter), errorIDs: [errorTypeIDs.messageA, errorTypeIDs.messageB] },
    { measurement: row(ids.carriesAOnlyLast), errorIDs: [errorTypeIDs.messageA] }
  ];
  return {
    plotIDs: [MAIN_PLOT_ID],
    censuses: [{ ...SIGNATURE_FIXTURE_CENSUS }],
    errorTypes: [
      ingestionType(errorTypeIDs.messageA, INTERLEAVING_MESSAGES.messageA),
      ingestionType(errorTypeIDs.messageB, INTERLEAVING_MESSAGES.messageB),
      ingestionType(errorTypeIDs.messageC, INTERLEAVING_MESSAGES.messageC),
      {
        errorID: errorTypeIDs.editableValidation,
        source: 'validation',
        code: String(INTERLEAVING_VALIDATION_ID),
        message: 'Interleave catalog message for the editable validation'
      }
    ],
    validations: [
      {
        validationID: INTERLEAVING_VALIDATION_ID,
        procedureName: 'ValidateInterleaving',
        description: INTERLEAVING_MESSAGES.editableValidationOriginal,
        criteria: 'treeTag'
      }
    ],
    measurements: carriers.map(carrier => carrier.measurement),
    logs: carriers.flatMap(carrier => carrier.errorIDs.map(errorID => ({ measurementID: carrier.measurement.coreMeasurementID, errorID, isResolved: false })))
  };
}
