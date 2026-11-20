import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { loadSchema } from './local-db-setup';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  FixtureSessionAlreadyOpenError,
  createRecordingExecutor,
  describeMismatch,
  EQUIVALENCE_GROUP_CONCAT_MAX_LEN,
  expectExplorerEqual,
  FIXTURE_CONNECTION_CHARSET,
  FIXTURE_ERROR_TYPE_IDS,
  firstDifferingPath,
  generateEquivalenceFixture,
  openFixtureDatabase,
  replaceFixture,
  resolveEquivalenceSeeds,
  setGroupConcatMaxLen,
  ATTRIBUTES_ONLY_TOKEN,
  SINGLE_ERROR_STEM_PAIR_TREE_TAG,
  SINGLE_ERROR_STEM_TAG_PAIR,
  SINGLE_ERROR_TREE_TAG_PAIR,
  ACCENT_ONLY_TREE_TAG_PAIR,
  SHARED_IDENTITY_ERROR_IDS,
  SINGLE_ERROR_SAME_BATCH_PAIR,
  SAME_BATCH_PLOT_MISMATCH_TREE_TAG,
  DECOY_PLOT_ID,
  FIRST_CENSUS_ID,
  SECOND_CENSUS_ID,
  MAIN_PLOT_ID,
  WITNESS_ERROR_STEM_TAGS,
  WITNESS_NON_ERROR_STEM_TAG,
  WITNESS_NON_ERROR_TREE_TAG,
  WITNESS_SAME_BATCH_ERROR_TREE_TAGS,
  WITNESS_SAME_BATCH_NON_ERROR_TREE_TAG,
  WITNESS_TREE_TAGS,
  type ExplorerFixture,
  type FixtureMeasurement
} from '../integration/helpers/errorsexplorerfixtures';

vi.mock('mysql2/promise', () => ({ default: { createConnection: vi.fn() } }));
vi.mock('./local-db-setup', async importOriginal => {
  const original = await importOriginal<typeof import('./local-db-setup')>();
  return { ...original, DEFAULT_TEST_CONFIG: { ...original.DEFAULT_TEST_CONFIG, host: '127.0.0.1' }, loadSchema: vi.fn() };
});

const DATABASE = 'forestgeo_test_fixture_errequiv';
const GROUP_CONCAT_STATEMENT = `SET SESSION group_concat_max_len = ${EQUIVALENCE_GROUP_CONCAT_MAX_LEN}`;
const DROP_STATEMENT = `DROP DATABASE IF EXISTS \`${DATABASE}\``;
const EXPECTED_TIMEZONE = 'Z';
const FIRST_CLEANUP_DROP_CALL = 2;
const TREE_TAG_COLUMN_LENGTH = 20;
const STEM_TAG_COLUMN_LENGTH = 10;
const SPECIES_CODE_COLUMN_LENGTH = 25;
const UPLOAD_BATCH_COLUMN_LENGTH = 36;
const RAW_CODES_COLUMN_LENGTH = 255;
const ATTRIBUTES_COLUMN_LENGTH = 255;
const SPECIES_NAME_COLUMN_LENGTH = 64;
const MIN_DISTINCT_COLUMN_VALUES = 50;
const OTHER_SEED = 545;
const FIRST_SEED = 544;
const RANDOM_CENSUS_TWO_ROW_COUNT = 100;
const PLANTED_CENSUS_TWO_ROW_COUNT = 1;

interface FakeOptions {
  dropFailure?: Error;
  endFailure?: Error;
  changeUserFailure?: Error;
  sessionFailure?: Error;
}

function fakeConnection(name: string, calls: string[], options: FakeOptions = {}) {
  let dropCalls = 0;
  return {
    query: vi.fn(async (sql: string) => {
      calls.push(`${name}.query ${sql}`);
      if (sql.startsWith('DROP DATABASE')) {
        dropCalls++;
        // The first DROP is the one createTestDatabaseStrict issues before CREATE; only the cleanup DROP fails.
        if (options.dropFailure && dropCalls >= FIRST_CLEANUP_DROP_CALL) throw options.dropFailure;
      }
      if (options.sessionFailure && sql.startsWith('SET SESSION')) throw options.sessionFailure;
      return [[], []];
    }),
    end: vi.fn(async () => {
      calls.push(`${name}.end`);
      if (options.endFailure) throw options.endFailure;
    }),
    changeUser: vi.fn(async () => {
      calls.push(`${name}.changeUser`);
      if (options.changeUserFailure) throw options.changeUserFailure;
    })
  };
}

type FakeConnection = ReturnType<typeof fakeConnection>;

function queueConnections(...connections: Array<FakeConnection | Error>) {
  connections.forEach(next => {
    if (next instanceof Error) vi.mocked(mysql.createConnection).mockRejectedValueOnce(next);
    else vi.mocked(mysql.createConnection).mockResolvedValueOnce(next as never);
  });
}

function cleanupCalls(calls: string[]): string[] {
  const afterCreate = calls.findIndex(call => call === 'setup.changeUser');
  return calls.slice(afterCreate + 1).filter(call => call.includes('DROP DATABASE') || call.endsWith('.end'));
}

beforeEach(() => {
  vi.mocked(loadSchema).mockResolvedValue(undefined);
});

describe('openFixtureDatabase success path', () => {
  it('opens the setup connection, then the explorer connection with charset, timezone and group_concat_max_len', async () => {
    const calls: string[] = [];
    queueConnections(fakeConnection('setup', calls), fakeConnection('explorer', calls));

    const fixtureDatabase = await openFixtureDatabase(DATABASE);

    console.log('[open] calls', calls);
    expect(vi.mocked(mysql.createConnection).mock.calls[1][0]).toMatchObject({
      database: DATABASE,
      charset: FIXTURE_CONNECTION_CHARSET,
      timezone: EXPECTED_TIMEZONE,
      multipleStatements: false
    });
    expect(calls).toEqual([
      `setup.query ${DROP_STATEMENT}`,
      expect.stringContaining('setup.query CREATE DATABASE'),
      'setup.changeUser',
      `explorer.query ${GROUP_CONCAT_STATEMENT}`
    ]);
    expect(fixtureDatabase.database).toBe(DATABASE);
  });

  it('refuses an unowned database name before opening any connection', async () => {
    await expect(openFixtureDatabase('production_schema')).rejects.toThrow('owned test database');
    expect(mysql.createConnection).not.toHaveBeenCalled();
  });
});

describe('createFixtureDatabaseSession', () => {
  const SETTLE_TURNS = 5;

  async function letPendingWorkRun() {
    for (let turn = 0; turn < SETTLE_TURNS; turn++) await new Promise(resolve => setImmediate(resolve));
  }

  it('close() called while open() is pending waits for it, then ends the explorer connection and drops the schema', async () => {
    const calls: string[] = [];
    queueConnections(fakeConnection('setup', calls), fakeConnection('explorer', calls));
    let finishSchemaLoad: () => void = () => undefined;
    vi.mocked(loadSchema).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishSchemaLoad = resolve;
        })
    );
    const session = createFixtureDatabaseSession(DATABASE);

    const opening = session.open();
    let closed = false;
    const closing = session.close().then(() => {
      closed = true;
    });
    await letPendingWorkRun();
    console.log('[session pending] closed =', closed, 'cleanup calls =', cleanupCalls(calls));

    expect(closed, 'close() must not settle while the open is still loading the schema').toBe(false);
    expect(cleanupCalls(calls), 'nothing may be torn down while the open is pending').toEqual([]);

    finishSchemaLoad();
    await opening;
    await closing;
    console.log('[session closed] calls', calls);

    expect(cleanupCalls(calls)).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('close() after a rejected open() does not throw and does not tear down a second time', async () => {
    const calls: string[] = [];
    const schemaFailure = new Error('schema load sentinel');
    queueConnections(fakeConnection('setup', calls));
    vi.mocked(loadSchema).mockRejectedValueOnce(schemaFailure);
    const session = createFixtureDatabaseSession(DATABASE);

    const openError = await session.open().catch(caught => caught);
    const callsAfterFailedOpen = cleanupCalls(calls);
    await expect(session.close()).resolves.toBeUndefined();
    console.log('[session rejected] open error', openError, 'cleanup calls', cleanupCalls(calls));

    expect(openError).toBe(schemaFailure);
    expect(callsAfterFailedOpen, 'the failed open cleans up by itself').toEqual([`setup.query ${DROP_STATEMENT}`, 'setup.end']);
    expect(cleanupCalls(calls), 'close() must add no further DROP or end').toEqual(callsAfterFailedOpen);
  });

  it('close() called while open() is pending, when that open then fails, logs the failure with its parts and does not throw or tear down twice', async () => {
    const calls: string[] = [];
    const schemaFailure = new Error('late schema load sentinel');
    const cleanupFailure = new Error('late cleanup drop sentinel');
    queueConnections(fakeConnection('setup', calls, { dropFailure: cleanupFailure }));
    let failSchemaLoad: (error: Error) => void = () => undefined;
    vi.mocked(loadSchema).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSchemaLoad = reject;
        })
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const session = createFixtureDatabaseSession(DATABASE);

    const opening = session.open().catch(caught => caught);
    const closing = session.close();
    await letPendingWorkRun();
    expect(cleanupCalls(calls), 'nothing is torn down while the open is pending').toEqual([]);

    failSchemaLoad(schemaFailure);
    const openError = await opening;
    await expect(closing).resolves.toBeUndefined();
    const loggedText = logged.mock.calls.map(call => call.map(String).join(' ')).join('\n');
    console.log('[session late failure] open error', openError, 'logged', loggedText);

    expect(openError).toBeInstanceOf(AggregateError);
    expect(loggedText, 'the log names the database').toContain(DATABASE);
    expect(loggedText, 'the log carries the original failure').toContain('late schema load sentinel');
    expect(loggedText, 'the log carries the cleanup failure that may have left the schema behind').toContain('late cleanup drop sentinel');
    expect(
      cleanupCalls(calls).filter(call => call.includes('DROP DATABASE')),
      'close() issues no DROP of its own after a failed open'
    ).toEqual([`setup.query ${DROP_STATEMENT}`]);
  });

  it('open() rejects while a session is already open and keeps the first handle, and works again after close()', async () => {
    const calls: string[] = [];
    queueConnections(fakeConnection('setup', calls), fakeConnection('explorer', calls), fakeConnection('setup', calls), fakeConnection('explorer', calls));
    const session = createFixtureDatabaseSession(DATABASE);

    const first = await session.open();
    await expect(session.open()).rejects.toBeInstanceOf(FixtureSessionAlreadyOpenError);
    expect(mysql.createConnection, 'the refused open must not start a second setup').toHaveBeenCalledTimes(2);

    await session.close();
    expect(cleanupCalls(calls), 'close() tears down the first open, not a lost handle').toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
    expect(first.database).toBe(DATABASE);

    await expect(session.open()).resolves.toMatchObject({ database: DATABASE });
  });

  it('close() without open() does nothing, and a second close() tears down only once', async () => {
    const calls: string[] = [];
    queueConnections(fakeConnection('setup', calls), fakeConnection('explorer', calls));
    const session = createFixtureDatabaseSession(DATABASE);

    await session.close();
    expect(calls).toEqual([]);

    await session.open();
    await session.close();
    const callsAfterFirstClose = cleanupCalls(calls);
    await session.close();

    expect(callsAfterFirstClose).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
    expect(cleanupCalls(calls)).toEqual(callsAfterFirstClose);
  });
});

describe('FixtureDatabase.teardown', () => {
  async function openWith(setup: FakeOptions, explorer: FakeOptions) {
    const calls: string[] = [];
    queueConnections(fakeConnection('setup', calls, setup), fakeConnection('explorer', calls, explorer));
    const fixtureDatabase = await openFixtureDatabase(DATABASE);
    calls.length = 0;
    return { fixtureDatabase, calls };
  }

  it('ends the explorer connection first, then drops through the setup connection, which it ends', async () => {
    const { fixtureDatabase, calls } = await openWith({}, {});

    await fixtureDatabase.teardown();

    console.log('[teardown] calls', calls);
    expect(calls).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('still drops and closes when ending the explorer connection fails, and reports that failure by identity', async () => {
    const explorerEnd = new Error('explorer end sentinel');
    const { fixtureDatabase, calls } = await openWith({}, { endFailure: explorerEnd });

    const error = await fixtureDatabase.teardown().catch(caught => caught);

    console.log('[teardown explorer end fails] calls', calls);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([explorerEnd]);
    expect(error.errors[0]).toBe(explorerEnd);
    expect(calls).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('retains the explorer end, DROP and setup end failures in that order', async () => {
    const explorerEnd = new Error('explorer end');
    const dropFailure = new Error('drop');
    const setupEnd = new Error('setup end');
    const { fixtureDatabase, calls } = await openWith({ dropFailure, endFailure: setupEnd }, { endFailure: explorerEnd });

    const error = await fixtureDatabase.teardown().catch(caught => caught);

    console.log('[teardown all fail] calls', calls);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([explorerEnd, dropFailure, setupEnd]);
    expect(error.errors[0]).toBe(explorerEnd);
    expect(error.errors[1]).toBe(dropFailure);
    expect(error.errors[2]).toBe(setupEnd);
    expect(calls).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });
});

describe('openFixtureDatabase partial setup failure', () => {
  it('after loadSchema fails: drops and closes, rethrows the same error, never opens the explorer connection', async () => {
    const calls: string[] = [];
    const schemaFailure = new Error('loadSchema sentinel');
    vi.mocked(loadSchema).mockRejectedValue(schemaFailure);
    queueConnections(fakeConnection('setup', calls));

    await expect(openFixtureDatabase(DATABASE)).rejects.toBe(schemaFailure);

    console.log('[loadSchema fails] calls', calls);
    expect(mysql.createConnection).toHaveBeenCalledTimes(1);
    expect(cleanupCalls(calls)).toEqual([`setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('after loadSchema fails with DROP and close failing: retains all three failures in order', async () => {
    const calls: string[] = [];
    const schemaFailure = new Error('loadSchema');
    const dropFailure = new Error('drop');
    const closeFailure = new Error('close');
    vi.mocked(loadSchema).mockRejectedValue(schemaFailure);
    queueConnections(fakeConnection('setup', calls, { dropFailure, endFailure: closeFailure }));

    const error = await openFixtureDatabase(DATABASE).catch(caught => caught);

    console.log('[loadSchema + DROP + close fail] calls', calls);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([schemaFailure, dropFailure, closeFailure]);
    expect(error.errors[0]).toBe(schemaFailure);
    expect(error.errors[1]).toBe(dropFailure);
    expect(error.errors[2]).toBe(closeFailure);
    expect(cleanupCalls(calls)).toEqual([`setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('when the explorer connection cannot be opened: drops and closes the setup connection and rethrows the same error', async () => {
    const calls: string[] = [];
    const connectFailure = new Error('connect sentinel');
    queueConnections(fakeConnection('setup', calls), connectFailure);

    await expect(openFixtureDatabase(DATABASE)).rejects.toBe(connectFailure);

    console.log('[explorer connect fails] calls', calls);
    expect(cleanupCalls(calls)).toEqual([`setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('when SET SESSION fails: ends the explorer connection, then drops and closes the setup connection', async () => {
    const calls: string[] = [];
    const sessionFailure = new Error('session sentinel');
    queueConnections(fakeConnection('setup', calls), fakeConnection('explorer', calls, { sessionFailure }));

    await expect(openFixtureDatabase(DATABASE)).rejects.toBe(sessionFailure);

    console.log('[SET SESSION fails] calls', calls);
    expect(cleanupCalls(calls)).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('when SET SESSION fails and every cleanup step fails: retains the primary then each cleanup failure in order', async () => {
    const calls: string[] = [];
    const sessionFailure = new Error('session');
    const explorerEnd = new Error('explorer end');
    const dropFailure = new Error('drop');
    const setupEnd = new Error('setup end');
    queueConnections(
      fakeConnection('setup', calls, { dropFailure, endFailure: setupEnd }),
      fakeConnection('explorer', calls, { sessionFailure, endFailure: explorerEnd })
    );

    const error = await openFixtureDatabase(DATABASE).catch(caught => caught);

    console.log('[SET SESSION + all cleanup fail] calls', calls);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([sessionFailure, explorerEnd, dropFailure, setupEnd]);
    expect(cleanupCalls(calls)).toEqual(['explorer.end', `setup.query ${DROP_STATEMENT}`, 'setup.end']);
  });

  it('after CREATE but before the setup connection is returned: retains the changeUser, DROP and close failures in order', async () => {
    const calls: string[] = [];
    const changeUserFailure = new Error('changeUser');
    const dropFailure = new Error('drop');
    const closeFailure = new Error('close');
    queueConnections(fakeConnection('setup', calls, { changeUserFailure, dropFailure, endFailure: closeFailure }));

    const error = await openFixtureDatabase(DATABASE).catch(caught => caught);

    console.log('[after-CREATE branch, DROP + close fail] calls', calls);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([changeUserFailure, dropFailure, closeFailure]);
    expect(error.errors[0]).toBe(changeUserFailure);
    expect(error.errors[1]).toBe(dropFailure);
    expect(error.errors[2]).toBe(closeFailure);
    expect(mysql.createConnection).toHaveBeenCalledTimes(1);
    expect(loadSchema).not.toHaveBeenCalled();
    expect(calls.filter(call => call.includes('DROP DATABASE'))).toHaveLength(FIRST_CLEANUP_DROP_CALL);
    expect(calls.filter(call => call.endsWith('.end'))).toEqual(['setup.end']);
  });

  it('after CREATE but before the setup connection is returned: drops, closes and rethrows the same error when cleanup works', async () => {
    const calls: string[] = [];
    const changeUserFailure = new Error('changeUser sentinel');
    queueConnections(fakeConnection('setup', calls, { changeUserFailure }));

    await expect(openFixtureDatabase(DATABASE)).rejects.toBe(changeUserFailure);

    console.log('[after-CREATE branch] calls', calls);
    expect(calls.filter(call => call.includes('DROP DATABASE'))).toHaveLength(FIRST_CLEANUP_DROP_CALL);
    expect(calls.at(-1)).toBe('setup.end');
  });
});

describe('local-host guard', () => {
  it.each([
    ['127.0.0.1', '127.0.0.1'],
    ['localhost', 'localhost']
  ])('accepts AZURE_SQL_SERVER %s with test host %s', (azureServer, testHost) => {
    expect(() => assertLocalOrRefuse(azureServer, testHost)).not.toThrow();
  });

  it.each([
    ['forestgeo-mysqldataserver.mysql.database.azure.com', '127.0.0.1'],
    ['', '127.0.0.1'],
    ['127.0.0.1', 'forestgeo-mysqldataserver.mysql.database.azure.com'],
    ['127.0.0.1', '']
  ])('refuses AZURE_SQL_SERVER %j with test host %j', (azureServer, testHost) => {
    expect(() => assertLocalOrRefuse(azureServer, testHost)).toThrow('REFUSING TO RUN');
  });
});

describe('local-host guard reading the environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses when AZURE_SQL_SERVER is not set', () => {
    vi.stubEnv('AZURE_SQL_SERVER', undefined);
    expect(() => assertLocalOrRefuse(undefined, '127.0.0.1')).toThrow('REFUSING TO RUN');
  });

  it('refuses a remote AZURE_SQL_SERVER read from the environment, and accepts a local one', () => {
    vi.stubEnv('AZURE_SQL_SERVER', 'forestgeo-mysqldataserver.mysql.database.azure.com');
    expect(() => assertLocalOrRefuse()).toThrow('REFUSING TO RUN');
    vi.stubEnv('AZURE_SQL_SERVER', '127.0.0.1');
    expect(() => assertLocalOrRefuse()).not.toThrow();
  });
});

describe('seed selection and group_concat_max_len', () => {
  it('uses the three fixed seeds by default and the environment list when given', () => {
    expect(resolveEquivalenceSeeds(undefined)).toEqual([544, 20261104, 4242]);
    expect(resolveEquivalenceSeeds('')).toEqual([544, 20261104, 4242]);
    expect(resolveEquivalenceSeeds('1, 2,3')).toEqual([1, 2, 3]);
  });

  it('rejects a seed list that is not integers', () => {
    expect(() => resolveEquivalenceSeeds('1,two')).toThrow(RangeError);
    expect(() => resolveEquivalenceSeeds('1.5')).toThrow(RangeError);
  });

  it.each([['544,,4242'], ['544,'], [',544'], [' , '], ['544, ,4242']])('rejects the empty seed entry in %j instead of reading it as seed 0', rawList => {
    expect(() => resolveEquivalenceSeeds(rawList)).toThrow(RangeError);
  });

  it('sets the session variable to the given byte count and refuses a non-positive one', async () => {
    const calls: string[] = [];
    const connection = fakeConnection('explorer', calls);
    await setGroupConcatMaxLen(connection as never, 14);
    expect(calls).toEqual(['explorer.query SET SESSION group_concat_max_len = 14']);
    await expect(setGroupConcatMaxLen(connection as never, 0)).rejects.toThrow(RangeError);
    await expect(setGroupConcatMaxLen(connection as never, 1.5)).rejects.toThrow(RangeError);
  });
});

describe('generateEquivalenceFixture', () => {
  const fixture = generateEquivalenceFixture(FIRST_SEED);

  it('is deterministic per seed and differs between seeds', () => {
    expect(generateEquivalenceFixture(FIRST_SEED)).toEqual(fixture);
    expect(generateEquivalenceFixture(OTHER_SEED)).not.toEqual(fixture);
  });

  it('produces a referentially consistent fixture that fits the table constraints', () => {
    const measurementIDs = new Set(fixture.measurements.map(row => row.coreMeasurementID));
    const errorIDs = new Set(fixture.errorTypes.map(type => type.errorID));
    const censusByID = new Map(fixture.censuses.map(census => [census.censusID, census]));
    const logKeys = fixture.logs.map(log => `${log.measurementID}:${log.errorID}`);
    const codedTypeKeys = fixture.errorTypes.filter(type => type.code !== null).map(type => `${type.source}:${type.code}`);
    const validationCodes = new Set(fixture.errorTypes.filter(type => type.source === 'validation').map(type => type.code));
    console.log(`[fixture ${FIRST_SEED}] measurements=${fixture.measurements.length} logs=${fixture.logs.length}`);

    expect(measurementIDs.size).toBe(fixture.measurements.length);
    expect(new Set(logKeys).size).toBe(logKeys.length);
    expect(new Set(codedTypeKeys).size, 'uq_measurement_error_source_code is unique over (source, code) and admits any number of NULL codes').toBe(
      codedTypeKeys.length
    );
    expect(fixture.logs.every(log => measurementIDs.has(log.measurementID) && errorIDs.has(log.errorID))).toBe(true);
    expect(fixture.measurements.filter(row => censusByID.get(row.censusID)?.plotID !== row.plotID).map(row => row.coreMeasurementID)).toEqual(
      fixture.mismatchedPlotRowIDs
    );
    expect(fixture.validations.every(validation => validationCodes.has(String(validation.validationID)))).toBe(true);
    expect(new Set(fixture.validations.map(validation => validation.procedureName)).size).toBe(fixture.validations.length);
    expect(fixture.measurements.every(row => (row.treeTag ?? '').length <= TREE_TAG_COLUMN_LENGTH)).toBe(true);
    expect(fixture.measurements.every(row => (row.stemTag ?? '').length <= STEM_TAG_COLUMN_LENGTH)).toBe(true);
    expect(fixture.measurements.every(row => (row.speciesCode ?? '').length <= SPECIES_CODE_COLUMN_LENGTH)).toBe(true);
    expect(fixture.measurements.every(row => (row.uploadBatchID ?? '').length <= UPLOAD_BATCH_COLUMN_LENGTH)).toBe(true);
    expect(fixture.measurements.every(row => (row.rawCodes ?? '').length <= RAW_CODES_COLUMN_LENGTH)).toBe(true);
    expect(fixture.measurements.every(row => (row.attributes ?? '').length <= ATTRIBUTES_COLUMN_LENGTH)).toBe(true);
    expect(fixture.measurements.every(row => (row.speciesName ?? '').length <= SPECIES_NAME_COLUMN_LENGTH)).toBe(true);
  });

  it('keeps the shared-identity pair as two NULL-code ingestion entries that carry one message', () => {
    const sharedIdentityErrorIDs: readonly number[] = Object.values(SHARED_IDENTITY_ERROR_IDS);
    const pair = fixture.errorTypes.filter(type => sharedIdentityErrorIDs.includes(type.errorID));

    expect(pair.map(type => type.errorID)).toEqual(sharedIdentityErrorIDs);
    expect(pair.map(type => `${type.source}:${type.code}`)).toEqual(['ingestion:null', 'ingestion:null']);
    expect(new Set(pair.map(type => type.message)).size).toBe(1);
  });

  it('fills the nine display columns with values that differ by row and by column', () => {
    const distinctValues = (pick: (row: FixtureMeasurement) => unknown) => new Set(fixture.measurements.map(row => JSON.stringify(pick(row)))).size;
    const columns: Array<[string, (row: FixtureMeasurement) => unknown]> = [
      ['treeID', row => row.treeID],
      ['stemPlotX', row => row.stemPlotX],
      ['stemPlotY', row => row.stemPlotY],
      ['speciesName', row => row.speciesName],
      ['subspeciesName', row => row.subspeciesName],
      ['userDefinedFields', row => row.userDefinedFields]
    ];
    columns.forEach(([name, pick]) => expect(distinctValues(pick), `${name} must differ across rows`).toBeGreaterThan(MIN_DISTINCT_COLUMN_VALUES));
    expect(distinctValues(row => row.quadratID)).toBeGreaterThan(1);
    expect(distinctValues(row => row.speciesID)).toBeGreaterThan(1);
    expect(distinctValues(row => row.attributes)).toBeGreaterThan(1);
    expect(fixture.measurements.some(row => row.subspeciesName === null)).toBe(true);
    expect(fixture.measurements.every(row => row.stemPlotX !== row.stemPlotY && row.speciesName !== row.subspeciesName)).toBe(true);
    expect(fixture.measurements.every(row => row.quadratID !== null && row.userDefinedFields !== null)).toBe(true);
    expect(fixture.measurements.filter(row => row.attributes === ATTRIBUTES_ONLY_TOKEN)).toHaveLength(1);
  });

  it('plants a plot-2 row in census 1 that shares its tag pair with a plot-1 duplicate pair', () => {
    const [mismatchedID] = fixture.mismatchedPlotRowIDs;
    const mismatched = fixture.measurements.find(row => row.coreMeasurementID === mismatchedID);
    const mates = fixture.measurements.filter(
      row => row.plotID === MAIN_PLOT_ID && row.censusID === mismatched?.censusID && row.treeTag === mismatched?.treeTag && row.stemTag === mismatched?.stemTag
    );
    expect(mismatched?.plotID).toBe(DECOY_PLOT_ID);
    expect(mismatched?.censusID).toBe(FIRST_CENSUS_ID);
    expect(mates.length).toBeGreaterThanOrEqual(2);
  });

  it('plants a second plot-2 row that shares an agreeing same-batch group with plot 1 and would make it conflict', () => {
    const [, sameBatchMismatchedID] = fixture.mismatchedPlotRowIDs;
    const mismatched = fixture.measurements.find(row => row.coreMeasurementID === sameBatchMismatchedID) as FixtureMeasurement;
    const mates = fixture.measurements.filter(
      row => row.plotID === MAIN_PLOT_ID && row.censusID === mismatched.censusID && row.treeTag === SAME_BATCH_PLOT_MISMATCH_TREE_TAG && row.isActive
    );
    expect(fixture.mismatchedPlotRowIDs).toHaveLength(2);
    expect(mismatched).toMatchObject({ plotID: DECOY_PLOT_ID, censusID: FIRST_CENSUS_ID, isActive: true, speciesCode: 'BBB', stemTag: '1' });
    expect(mates.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mates.map(row => (row.speciesCode ?? '').toLowerCase()))).toEqual(new Set(['aaa']));
    expect(mates.every(row => row.uploadFileID === mismatched.uploadFileID && row.uploadBatchID === mismatched.uploadBatchID)).toBe(true);
  });

  it('holds the three censuses at the planned sizes plus the planted rows', () => {
    const countIn = (censusID: number) => fixture.measurements.filter(row => row.censusID === censusID).length;
    expect(countIn(1)).toBeGreaterThanOrEqual(260);
    expect(countIn(2)).toBe(RANDOM_CENSUS_TWO_ROW_COUNT + PLANTED_CENSUS_TWO_ROW_COUNT);
    expect(countIn(3)).toBe(40);
    expect(fixture.censuses.map(census => census.plotCensusNumber)).toEqual([null, null, null]);
  });

  it('plants one errored row per census that ties on date and error count and holds no contradiction', () => {
    const { firstCensusRow, secondCensusRow } = fixture.plantedCases.censusTie;
    const [first, second] = [firstCensusRow, secondCensusRow].map(id => fixture.measurements.find(row => row.coreMeasurementID === id) as FixtureMeasurement);
    const unresolvedLogCount = (id: number) => fixture.logs.filter(log => log.measurementID === id && !log.isResolved).length;

    expect([first.censusID, second.censusID]).toEqual([FIRST_CENSUS_ID, SECOND_CENSUS_ID]);
    expect(secondCensusRow, 'the census 2 row is planted first, so it takes the lower measurement ID').toBeLessThan(firstCensusRow);
    expect(first.measurementDate).toBe(second.measurementDate);
    expect(unresolvedLogCount(firstCensusRow)).toBe(1);
    expect(unresolvedLogCount(secondCensusRow)).toBe(1);
    expect(first.treeTag, 'distinct trees, so neither row is a duplicate-tag contradiction').not.toBe(second.treeTag);
    expect(first.uploadFileID, 'no upload, so neither row is a same-batch contradiction').toBeNull();
    expect(second.uploadFileID).toBeNull();
  });

  const rowsOf = (ids: number[]) => ids.map(id => fixture.measurements.find(row => row.coreMeasurementID === id) as FixtureMeasurement);
  const hasUnresolvedLog = (row: FixtureMeasurement) => fixture.logs.some(log => log.measurementID === row.coreMeasurementID && !log.isResolved);

  it('plants three witness groups whose spellings differ only by case or accent, each with a non-error member', () => {
    const { treeTagVariants, stemTagVariants, sameBatchVariants } = fixture.witnessGroups;

    expect(rowsOf(treeTagVariants).map(row => row.treeTag)).toEqual([...WITNESS_TREE_TAGS, WITNESS_NON_ERROR_TREE_TAG]);
    expect(new Set(rowsOf(treeTagVariants).map(row => row.stemTag)).size).toBe(1);
    expect(rowsOf(stemTagVariants).map(row => row.stemTag)).toEqual([...WITNESS_ERROR_STEM_TAGS, WITNESS_NON_ERROR_STEM_TAG]);
    expect(new Set(rowsOf(stemTagVariants).map(row => row.treeTag)).size).toBe(1);
    expect(rowsOf(sameBatchVariants).map(row => row.treeTag)).toEqual([...WITNESS_SAME_BATCH_ERROR_TREE_TAGS, WITNESS_SAME_BATCH_NON_ERROR_TREE_TAG]);
    expect(new Set(rowsOf(sameBatchVariants).map(row => row.speciesCode)).size).toBe(sameBatchVariants.length);
    expect(new Set(rowsOf(sameBatchVariants).map(row => `${row.uploadFileID}/${row.uploadBatchID}`)).size).toBe(1);
    expect(rowsOf(treeTagVariants).map(hasUnresolvedLog)).toEqual([true, true, true, false]);
    expect(rowsOf(stemTagVariants).map(hasUnresolvedLog)).toEqual([true, true, false]);
    expect(rowsOf(sameBatchVariants).map(hasUnresolvedLog)).toEqual([true, true, false]);
    expect(treeTagVariants.length).toBe(WITNESS_TREE_TAGS.length + 1);
  });

  it('plants four pairs with exactly one error member and one non-error member, and lists every witness row in order', () => {
    const {
      treeTagVariants,
      stemTagVariants,
      sameBatchVariants,
      singleErrorTreeTagPair,
      accentOnlyTreeTagPair,
      singleErrorStemTagPair,
      singleErrorSameBatchPair
    } = fixture.witnessGroups;

    expect(rowsOf(singleErrorTreeTagPair).map(row => row.treeTag)).toEqual([...SINGLE_ERROR_TREE_TAG_PAIR]);
    expect(new Set(rowsOf(singleErrorTreeTagPair).map(row => row.stemTag)).size).toBe(1);
    expect(rowsOf(accentOnlyTreeTagPair).map(row => row.treeTag)).toEqual([...ACCENT_ONLY_TREE_TAG_PAIR]);
    expect(new Set(rowsOf(accentOnlyTreeTagPair).map(row => row.stemTag))).toEqual(new Set(rowsOf(singleErrorTreeTagPair).map(row => row.stemTag)));
    expect(rowsOf(singleErrorStemTagPair).map(row => row.stemTag)).toEqual([...SINGLE_ERROR_STEM_TAG_PAIR]);
    expect(new Set(rowsOf(singleErrorStemTagPair).map(row => row.treeTag))).toEqual(new Set([SINGLE_ERROR_STEM_PAIR_TREE_TAG]));
    expect(rowsOf(singleErrorSameBatchPair).map(row => row.treeTag)).toEqual([...SINGLE_ERROR_SAME_BATCH_PAIR]);
    expect(rowsOf(singleErrorSameBatchPair).map(row => [row.speciesCode, row.stemTag, row.uploadFileID, row.uploadBatchID])).toEqual([
      ['AAA', '1', 'file-a', 'batch-1'],
      ['BBB', '2', 'file-a', 'batch-1']
    ]);
    [singleErrorTreeTagPair, accentOnlyTreeTagPair, singleErrorStemTagPair, singleErrorSameBatchPair].forEach(pair => {
      expect(rowsOf(pair).map(hasUnresolvedLog)).toEqual([true, false]);
    });
    expect(fixture.witnessRowIDs).toEqual([
      ...treeTagVariants,
      ...stemTagVariants,
      ...sameBatchVariants,
      ...singleErrorTreeTagPair,
      ...accentOnlyTreeTagPair,
      ...singleErrorStemTagPair,
      ...singleErrorSameBatchPair
    ]);
  });

  it('plants the semicolon message type', () => {
    expect(fixture.errorTypes.find(type => type.errorID === FIXTURE_ERROR_TYPE_IDS.semicolonMessage)?.message).toContain(';');
  });
});

describe('replaceFixture', () => {
  const miniFixture: ExplorerFixture = {
    plotIDs: [1],
    censuses: [{ censusID: 1, plotID: 1, plotCensusNumber: null }],
    errorTypes: [{ errorID: 1, source: 'ingestion', code: null, message: 'm' }],
    validations: [],
    measurements: [
      {
        coreMeasurementID: 7,
        plotID: 1,
        censusID: 1,
        isActive: true,
        coreStemGUID: 7,
        summaryStemGUID: null,
        coreIsValidated: false,
        summaryIsValidated: null,
        treeTag: 'T1',
        stemTag: '1',
        speciesCode: 'AAA',
        quadratName: 'Q01',
        measurementDate: '2020-03-01',
        measuredDBH: 12.5,
        measuredHOM: null,
        rawCodes: null,
        stemLocalX: 1.5,
        stemLocalY: null,
        quadratID: 301,
        treeID: 100007,
        speciesID: 5007,
        speciesName: 'Genus 7',
        subspeciesName: null,
        stemPlotX: 1.125,
        stemPlotY: '2.5',
        attributes: 'fluted',
        userDefinedFields: { ordinal: 7 },
        description: null,
        uploadFileID: null,
        uploadBatchID: null
      }
    ],
    logs: [{ measurementID: 7, errorID: 1, isResolved: false }]
  };

  function recordingConnection(failOn?: { matching: RegExp; error: Error; failRestore?: Error }) {
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    return {
      statements,
      connection: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          statements.push({ sql, params });
          if (failOn?.failRestore && sql === 'SET FOREIGN_KEY_CHECKS = 1') throw failOn.failRestore;
          if (failOn?.matching.test(sql)) throw failOn.error;
          return [[], []];
        })
      }
    };
  }

  it('disables foreign key checks, clears children before parents, inserts every table, and re-enables checks', async () => {
    const { statements, connection } = recordingConnection();

    await replaceFixture(connection as never, miniFixture);

    const sqlList = statements.map(statement => statement.sql);
    console.log('[replaceFixture] statements', sqlList);
    expect(sqlList[0]).toBe('SET FOREIGN_KEY_CHECKS = 0');
    expect(sqlList.slice(1, 8)).toEqual([
      'DELETE FROM measurement_error_log',
      'DELETE FROM measurement_errors',
      'DELETE FROM sitespecificvalidations',
      'DELETE FROM measurementssummary',
      'DELETE FROM coremeasurements',
      'DELETE FROM census',
      'DELETE FROM plots'
    ]);
    expect(sqlList.at(-1)).toBe('SET FOREIGN_KEY_CHECKS = 1');
    const inserted = statements.filter(statement => statement.sql.startsWith('INSERT INTO'));
    expect(inserted.map(statement => statement.sql.split(' ')[2])).toEqual([
      'plots',
      'census',
      'measurement_errors',
      'coremeasurements',
      'measurementssummary',
      'measurement_error_log'
    ]);
    expect(inserted.find(statement => statement.sql.includes('measurementssummary'))?.params).toEqual([
      [
        [
          7,
          null,
          1,
          1,
          'T1',
          '1',
          'AAA',
          'Q01',
          1.5,
          null,
          '2020-03-01',
          12.5,
          null,
          null,
          null,
          301,
          100007,
          5007,
          'Genus 7',
          null,
          1.125,
          '2.5',
          'fluted',
          '{"ordinal":7}'
        ]
      ]
    ]);
    expect(inserted.find(statement => statement.sql.includes('coremeasurements'))?.params).toEqual([
      [[7, 1, 7, false, '2020-03-01', 12.5, null, null, null, null, true]]
    ]);
  });

  it('re-enables foreign key checks and rethrows the same error when an insert fails', async () => {
    const insertFailure = new Error('insert sentinel');
    const { statements, connection } = recordingConnection({ matching: /^INSERT INTO coremeasurements/, error: insertFailure });

    await expect(replaceFixture(connection as never, miniFixture)).rejects.toBe(insertFailure);

    expect(statements.at(-1)?.sql).toBe('SET FOREIGN_KEY_CHECKS = 1');
  });

  it('retains both the insert failure and the failure to re-enable checks', async () => {
    const insertFailure = new Error('insert');
    const restoreFailure = new Error('restore');
    const { connection } = recordingConnection({ matching: /^INSERT INTO coremeasurements/, error: insertFailure, failRestore: restoreFailure });

    const error = await replaceFixture(connection as never, miniFixture).catch(caught => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([insertFailure, restoreFailure]);
  });

  it('reports a failure to re-enable checks after a successful replacement', async () => {
    const restoreFailure = new Error('restore');
    const { connection } = recordingConnection({ matching: /never/, error: new Error('unused'), failRestore: restoreFailure });
    await expect(replaceFixture(connection as never, miniFixture)).rejects.toBe(restoreFailure);
  });
});

describe('createRecordingExecutor', () => {
  const LABELLED_SELECT = '/* errors-explorer:totals */\nSELECT a FROM t WHERE b = ?';

  function fakeTarget(rows: unknown[]) {
    return { query: vi.fn(async () => [rows, []]), execute: vi.fn(async () => [rows, []]) };
  }

  it('records the label, copied params, row count and serialized size of each statement', async () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const executor = createRecordingExecutor(fakeTarget(rows) as never);
    const params = [5];

    const returned = await executor.executeQuery(LABELLED_SELECT, params);
    params.push(99);

    console.log('[recording] statements', JSON.stringify(executor.statements));
    expect(returned).toEqual(rows);
    expect(executor.statements).toEqual([
      { label: '/* errors-explorer:totals */', sql: LABELLED_SELECT, params: [5], rows: 2, jsonBytes: JSON.stringify(rows).length }
    ]);
  });

  it('records an unlabelled statement with a null label and counts a non-array result as zero rows', async () => {
    const executor = createRecordingExecutor({ query: vi.fn(), execute: vi.fn(async () => [{ affectedRows: 1 }, []]) } as never);
    await executor.executeQuery('SELECT 1');
    expect(executor.statements.map(statement => [statement.label, statement.rows])).toEqual([[null, 0]]);
  });

  it('runs a hook once, after the first statement with the matching label has been recorded', async () => {
    const executor = createRecordingExecutor(fakeTarget([{ a: 1 }]) as never);
    const observedStatementCounts: number[] = [];
    executor.afterStatementOnce('/* errors-explorer:totals */', async () => {
      observedStatementCounts.push(executor.statements.length);
    });

    await executor.executeQuery('SELECT 1');
    await executor.executeQuery(LABELLED_SELECT, [1]);
    await executor.executeQuery(LABELLED_SELECT, [2]);

    expect(observedStatementCounts).toEqual([2]);
    expect(executor.statements).toHaveLength(3);
  });

  it('refuses a second hook for a label whose first hook has not fired, leaving the first in place', async () => {
    const executor = createRecordingExecutor(fakeTarget([]) as never);
    const fired: string[] = [];
    executor.afterStatementOnce('/* errors-explorer:totals */', async () => {
      fired.push('first');
    });

    expect(() =>
      executor.afterStatementOnce('/* errors-explorer:totals */', async () => {
        fired.push('second');
      })
    ).toThrow('already registered');
    await executor.executeQuery(LABELLED_SELECT, [1]);

    expect(fired).toEqual(['first']);
  });

  it('accepts a new hook for a label once the earlier hook has fired', async () => {
    const executor = createRecordingExecutor(fakeTarget([]) as never);
    const fired: string[] = [];
    executor.afterStatementOnce('/* errors-explorer:totals */', async () => void fired.push('first'));
    await executor.executeQuery(LABELLED_SELECT, [1]);
    executor.afterStatementOnce('/* errors-explorer:totals */', async () => void fired.push('second'));
    await executor.executeQuery(LABELLED_SELECT, [2]);
    expect(fired).toEqual(['first', 'second']);
  });

  it('assertAllHooksFired names every hook that never fired and passes once they all have', async () => {
    const executor = createRecordingExecutor(fakeTarget([]) as never);
    expect(() => executor.assertAllHooksFired()).not.toThrow();
    executor.afterStatementOnce('/* errors-explorer:totals */', async () => undefined);
    executor.afterStatementOnce('/* errors-explorer:page */', async () => undefined);
    await executor.executeQuery(LABELLED_SELECT, [1]);

    expect(() => executor.assertAllHooksFired()).toThrow('/* errors-explorer:page */');
    expect(() => executor.assertAllHooksFired()).not.toThrow('totals');

    await executor.executeQuery('/* errors-explorer:page */\nSELECT 1');
    expect(() => executor.assertAllHooksFired()).not.toThrow();
  });

  it('propagates a hook failure to the caller of the statement that triggered it', async () => {
    const executor = createRecordingExecutor(fakeTarget([]) as never);
    const hookFailure = new Error('hook sentinel');
    executor.afterStatementOnce('/* errors-explorer:totals */', async () => {
      throw hookFailure;
    });
    await expect(executor.executeQuery(LABELLED_SELECT, [1])).rejects.toBe(hookFailure);
  });

  it('empties the statement list on reset', async () => {
    const executor = createRecordingExecutor(fakeTarget([]) as never);
    await executor.executeQuery('SELECT 1');
    executor.reset();
    expect(executor.statements).toEqual([]);
  });
});

describe('firstDifferingPath', () => {
  it('returns null for equal scalars, nested structures, dates and buffers', () => {
    const value = () => ({ rows: [{ id: 1, at: new Date('2020-03-01T00:00:00Z'), bit: Buffer.from([1]), tags: ['a', null], nested: { x: NaN } }] });
    expect(firstDifferingPath(value(), value())).toBeNull();
  });

  it('treats an undefined property as a missing one, as toEqual does', () => {
    expect(firstDifferingPath({ a: 1, b: undefined }, { a: 1 })).toBeNull();
  });

  it.each([
    ['a scalar', { a: 1 }, { a: 2 }, '$.a', 1, 2],
    ['null against undefined', { a: null }, { a: undefined }, '$.a', null, undefined],
    ['null against a string', { a: null }, { a: '' }, '$.a', null, ''],
    ['a number against its string', { a: 1 }, { a: '1' }, '$.a', 1, '1'],
    ['an array length', { rows: [1, 2] }, { rows: [1] }, '$.rows.length', 2, 1],
    ['an element deep in an array', { rows: [{ ids: [1, 2] }, { ids: [3, 4] }] }, { rows: [{ ids: [1, 2] }, { ids: [3, 5] }] }, '$.rows[1].ids[1]', 4, 5],
    ['an extra property', { a: 1, b: 2 }, { a: 1 }, '$.b', 2, undefined]
  ])('reports %s', (_name, actual, expected, path, actualValue, expectedValue) => {
    expect(firstDifferingPath(actual, expected)).toEqual({ path, actual: actualValue, expected: expectedValue });
  });

  it('compares dates by time and buffers by content', () => {
    const early = new Date('2020-03-01T00:00:00Z');
    const late = new Date('2020-03-02T00:00:00Z');
    expect(firstDifferingPath({ at: early }, { at: late })).toEqual({ path: '$.at', actual: early, expected: late });
    expect(firstDifferingPath({ bit: Buffer.from([1]) }, { bit: Buffer.from([0]) })?.path).toBe('$.bit');
    expect(firstDifferingPath({ at: new Date(early) }, { at: early })).toBeNull();
  });

  it('reports the first differing property in actual-then-expected key order', () => {
    expect(firstDifferingPath({ a: 1, b: 1 }, { a: 2, b: 2 })?.path).toBe('$.a');
  });
});

describe('expectExplorerEqual', () => {
  const WITNESS_ID = 5017;
  const witnessIDs = new Set([WITNESS_ID]);
  const context = { seed: FIRST_SEED, scenario: 'unit', page: 3 };

  function collationConnection(same: number) {
    return { query: vi.fn(async () => [[{ same }], []]) };
  }
  const rowWithKey = (coreMeasurementID: number, contradictionGroupKey: string | null, errorCount = 1) => ({
    rows: [{ coreMeasurementID, contradictionGroupKey, errorCount }]
  });

  it('resolves for equal results without asking the database anything', async () => {
    const connection = collationConnection(1);
    await expectExplorerEqual(connection as never, context, rowWithKey(1, 'k'), rowWithKey(1, 'k'), witnessIDs);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('does not ask the database about a witness key that is byte-identical on both sides, and asks about one that is not', async () => {
    const connection = collationConnection(1);
    await expectExplorerEqual(
      connection as never,
      context,
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1'),
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1'),
      witnessIDs
    );
    expect(connection.query).not.toHaveBeenCalled();

    await expectExplorerEqual(
      connection as never,
      context,
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1'),
      rowWithKey(WITNESS_ID, 'duplicate:1:aB1:1'),
      witnessIDs
    );
    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it('rejects with the seed, scenario, page, path and both values on a mismatch', async () => {
    const error = await expectExplorerEqual(collationConnection(1) as never, context, rowWithKey(1, 'k', 1), rowWithKey(1, 'k', 2)).catch(caught => caught);
    console.log(error.message);
    expect(error.message).toContain('seed: 544');
    expect(error.message).toContain("scenario: 'unit'");
    expect(error.message).toContain('page: 3');
    expect(error.message).toContain('first differing path: $.rows[0].errorCount');
    expect(error.message).toContain('actual:   1');
    expect(error.message).toContain('expected: 2');
  });

  it('accepts witness group keys that the collation treats as equal, and still compares every other field of that row', async () => {
    const connection = collationConnection(1);
    await expectExplorerEqual(
      connection as never,
      context,
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1'),
      rowWithKey(WITNESS_ID, 'duplicate:1:ab1:1'),
      witnessIDs
    );
    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining('COLLATE utf8mb4_0900_ai_ci'), ['duplicate:1:Ab1:1', 'duplicate:1:ab1:1']);

    const error = await expectExplorerEqual(
      connection as never,
      context,
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1', 1),
      rowWithKey(WITNESS_ID, 'duplicate:1:ab1:1', 2),
      witnessIDs
    ).catch(caught => caught);
    expect(error.message).toContain('$.rows[0].errorCount');
  });

  it('rejects witness group keys that the collation distinguishes', async () => {
    const error = await expectExplorerEqual(
      collationConnection(0) as never,
      context,
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1'),
      rowWithKey(WITNESS_ID, 'duplicate:1:Xy9:1'),
      witnessIDs
    ).catch(caught => caught);
    expect(error.message).toContain(`contradictionGroupKey of row ${WITNESS_ID}`);
  });

  it('rejects a null group key against a string key on a witness row', async () => {
    const error = await expectExplorerEqual(
      collationConnection(1) as never,
      context,
      rowWithKey(WITNESS_ID, null),
      rowWithKey(WITNESS_ID, 'duplicate:1:Ab1:1'),
      witnessIDs
    ).catch(caught => caught);
    expect(error.message).toContain(`contradictionGroupKey of row ${WITNESS_ID}`);
  });

  it('compares group keys strictly for rows outside the witness set', async () => {
    const error = await expectExplorerEqual(
      collationConnection(1) as never,
      context,
      rowWithKey(1, 'duplicate:1:Ab1:1'),
      rowWithKey(1, 'duplicate:1:ab1:1'),
      witnessIDs
    ).catch(caught => caught);
    expect(error.message).toContain('$.rows[0].contradictionGroupKey');
  });

  it('formats a mismatch with every part the plan requires', () => {
    const message = describeMismatch({ seed: 1, filters: { source: 'all' } }, { path: '$.totalRows', actual: 3, expected: 4 });
    expect(message).toContain('seed: 1');
    expect(message).toContain("source: 'all'");
    expect(message).toContain('$.totalRows');
  });
});
