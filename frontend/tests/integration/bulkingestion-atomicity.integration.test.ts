/**
 * bulkingestionprocess transaction ownership (#527), proven against real MySQL.
 *
 * Own mode: the procedure opens and commits its own transaction, so a late failure must leave
 * no trees/stems and must park every staged row as an unresolved SQL_EXCEPTION failure.
 *
 * Caller mode (@bulkingestion_caller_owns_transaction = 1): the procedure must never commit.
 * Each case writes an independent InnoDB sentinel row inside the caller transaction before the
 * CALL, observes the real writes BEFORE the caller finalizes, and then proves that only the
 * caller's COMMIT/ROLLBACK decides what survives. A late failure is injected with a trigger that
 * rejects only successful (StemGUID IS NOT NULL) measurement inserts, i.e. after trees and stems
 * already exist.
 *
 * Transaction loss: a genuine InnoDB deadlock and a released savepoint are produced with
 * test-only procedure variants built from the canonical source. The original SQL condition must
 * reach the caller and no diagnostics may be autocommitted after the transaction is gone.
 *
 * SAFETY: refuses to run unless the test database host is local.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import {
  cleanupTestMeasurements,
  DEFAULT_TEST_CONFIG,
  insertTestMeasurements,
  loadStoredProcedures,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import {
  assertIngestionOutcome,
  INGESTION_ALERT_TYPE,
  INGESTION_ERROR_CODE,
  readIngestionOutcome,
  type IngestionOutcome,
  type IngestionScope
} from '../setup/ingestion-outcome';
import { CALLER_OWNS_TRANSACTION_SQL, callBulkIngestionInCallerTransaction, type BulkIngestionExecutor } from '@/lib/ingestion/bulk-ingestion-call';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;
if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host as (typeof LOCAL_HOSTS)[number])) {
  throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${DEFAULT_TEST_CONFIG.host}', not local. This suite creates triggers and forces deadlocks.`);
}

const CANONICAL_PROCEDURE = 'bulkingestionprocess';
const DEADLOCK_PROCEDURE = 'bulkingestionprocess_deadlock_probe';
const LOST_SAVEPOINT_PROCEDURE = 'bulkingestionprocess_lost_savepoint_probe';
const READ_CALLER_FLAG_SQL = 'SELECT @bulkingestion_caller_owns_transaction AS flag';

const MEASUREMENT_DATE = '2024-06-15';
const BATCH_SIZE = 3;
const SUITE_TIMEOUT_MS = 120_000;
const SETUP_TIMEOUT_MS = 90_000;

const SENTINEL_TABLE = 'atomicity_caller_sentinel';
const LOCK_TABLE = 'atomicity_deadlock_lock';
const CALLER_LOCK_ID = 1;
const PROCEDURE_LOCK_ID = 2;
const BLOCKER_PADDING_FIRST_ID = 1000;
/** Rows the blocker modifies so InnoDB picks the (lighter) caller transaction as the deadlock victim. */
const BLOCKER_PADDING_ROW_COUNT = 5000;
const LOCK_WAIT_TIMEOUT_SECONDS = 20;
const LOCK_WAIT_OBSERVE_DEADLINE_MS = 30_000;
const DEADLOCK_SETTLE_DEADLINE_MS = 10_000;
const POLL_INTERVAL_MS = 50;

const LATE_FAILURE_TRIGGER = 'atomicity_late_failure';
const LATE_FAILURE_MARKER = 'ATOMICITY_527_LATE_FAILURE';
const LOST_SAVEPOINT_MARKER = 'ATOMICITY_527_LOST_SAVEPOINT';

const ER_LOCK_DEADLOCK = { code: 'ER_LOCK_DEADLOCK', errno: 1213, sqlState: '40001' } as const;
const ER_SIGNAL_EXCEPTION_ERRNO = 1644;
const ER_SP_DOES_NOT_EXIST_ERRNO = 1305;
const ER_SP_DOES_NOT_EXIST = 'ER_SP_DOES_NOT_EXIST';
const ER_NO_SUCH_TABLE = 'ER_NO_SUCH_TABLE';

/** Scratch tables that exist when the injected probes fire (STAGE 7); none may outlive the CALL. */
const SCRATCH_TABLES_AT_PROBE = ['hard_failure_rows', 'filtered', 'classified_filtered', 'current_stem_lookup', 'resolved_batch_rows'] as const;

/** Opens the STAGE 7 block: trees and stems are inserted, resolved measurements are not. */
const STAGE_7_ANCHOR = ['    -- =====================================================', '    -- STAGE 7: STEMCROSSID SELF-ASSIGN FOR NEW STEMS'].join('\n');

const DEADLOCK_PROBE_SQL = `    -- TEST-ONLY deadlock probe
    UPDATE ${LOCK_TABLE} SET LockVersion = LockVersion + 1 WHERE LockID = ${PROCEDURE_LOCK_ID};

`;

const LOST_SAVEPOINT_PROBE_SQL = `    -- TEST-ONLY lost-savepoint probe
    RELEASE SAVEPOINT bulkingestion_batch;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${LOST_SAVEPOINT_MARKER}';

`;

interface MysqlDriverError extends Error {
  code?: string;
  errno?: number;
  sqlState?: string;
}

type Settled<T> = { status: 'resolved'; value: T } | { status: 'rejected'; error: MysqlDriverError };

interface CaseBatch {
  scope: IngestionScope;
  tagPrefix: string;
}

let caseCounter = 0;
function nextCaseIdentity(label: string): { tagPrefix: string; sentinelMarker: string } {
  caseCounter += 1;
  return { tagPrefix: `A${caseCounter}${label}_`, sentinelMarker: `sentinel_${label}_${caseCounter}_${Date.now()}` };
}

function buildValidRows(testData: TestData, tagPrefix: string) {
  return Array.from({ length: BATCH_SIZE }, (_, index) => ({
    treeTag: `${tagPrefix}${index + 1}`,
    stemTag: `S${index + 1}`,
    speciesCode: testData.species[0].SpeciesCode,
    quadratName: testData.quadrats[0].QuadratName,
    x: index + 1,
    y: index + 1,
    dbh: 10 + index,
    hom: 1.3,
    date: MEASUREMENT_DATE
  }));
}

async function stageBatch(connection: Connection, testData: TestData, tagPrefix: string): Promise<CaseBatch> {
  const censusID = testData.census[0].censusID;
  const { fileID, batchID } = await insertTestMeasurements(connection, testData, buildValidRows(testData, tagPrefix), { censusID });
  return { scope: { fileID, batchID, censusID }, tagPrefix };
}

async function treeStemFootprint(connection: Connection, batch: CaseBatch): Promise<{ trees: number; stems: number }> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM trees WHERE TreeTag LIKE CONCAT(?, '%') AND CensusID = ?) AS trees,
       (SELECT COUNT(*) FROM stems s JOIN trees t ON t.TreeID = s.TreeID
         WHERE t.TreeTag LIKE CONCAT(?, '%') AND s.CensusID = ?) AS stems`,
    [batch.tagPrefix, batch.scope.censusID, batch.tagPrefix, batch.scope.censusID]
  );
  return { trees: Number(rows[0].trees), stems: Number(rows[0].stems) };
}

async function insertSentinel(connection: Connection, marker: string): Promise<void> {
  await connection.query(`INSERT INTO ${SENTINEL_TABLE} (Marker) VALUES (?)`, [marker]);
}

async function sentinelVisible(connection: Connection, marker: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${SENTINEL_TABLE} WHERE Marker = ?`, [marker]);
  return Number(rows[0].total) === 1;
}

async function readCallerFlag(connection: Connection): Promise<unknown> {
  const [rows] = await connection.query<RowDataPacket[]>(READ_CALLER_FLAG_SQL);
  return rows[0].flag;
}

async function readStoredErrorMessage(connection: Connection, scope: IngestionScope): Promise<string | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT errorMessage FROM uploadmetrics WHERE fileID = ? AND batchID = ? AND censusID = ? ORDER BY id DESC LIMIT 1',
    [scope.fileID, scope.batchID, scope.censusID]
  );
  return rows[0]?.errorMessage ?? null;
}

function firstResultRow(callResult: unknown): RowDataPacket | undefined {
  const [resultSets] = callResult as [unknown, unknown];
  const firstSet = Array.isArray(resultSets) ? resultSets[0] : resultSets;
  return Array.isArray(firstSet) ? (firstSet[0] as RowDataPacket | undefined) : undefined;
}

async function callProcedure(connection: Connection, procedure: string, scope: IngestionScope): Promise<RowDataPacket | undefined> {
  return firstResultRow(await connection.query(`CALL ${procedure}(?, ?)`, [scope.fileID, scope.batchID]));
}

async function callInCallerTransaction(connection: Connection, procedure: string, scope: IngestionScope): Promise<RowDataPacket | undefined> {
  await connection.query(CALLER_OWNS_TRANSACTION_SQL);
  return callProcedure(connection, procedure, scope);
}

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    value => ({ status: 'resolved', value }) as const,
    (error: MysqlDriverError) => ({ status: 'rejected', error }) as const
  );
}

async function settleWithin<T>(promise: Promise<Settled<T>>, deadlineMs: number): Promise<Settled<T> | 'pending'> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'pending'>(resolve => {
    timer = setTimeout(() => resolve('pending'), deadlineMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function pollUntil(description: string, deadlineMs: number, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${deadlineMs}ms waiting for: ${description}`);
}

/** Scratch tables still present on this session; a table that is gone raises ER_NO_SUCH_TABLE. */
async function lingeringScratchTables(connection: Connection): Promise<string[]> {
  const lingering: string[] = [];
  for (const table of SCRATCH_TABLES_AT_PROBE) {
    try {
      await connection.query(`SELECT 1 FROM ${table} LIMIT 0`);
      lingering.push(table);
    } catch (error: unknown) {
      if ((error as MysqlDriverError).code !== ER_NO_SUCH_TABLE) throw error;
    }
  }
  return lingering;
}

function emptyOutcome(): Partial<IngestionOutcome> {
  return {
    sourceRecords: null,
    successfulRows: 0,
    failedRows: 0,
    remainingTemporaryRows: 0,
    metricProcessedRecords: null,
    metricFailedRecords: null,
    metricMissingRecords: null,
    unresolvedSqlExceptionRows: 0,
    errorCodes: [],
    alertTypes: []
  };
}

function successfulOutcome(): Partial<IngestionOutcome> {
  return {
    sourceRecords: BATCH_SIZE,
    successfulRows: BATCH_SIZE,
    failedRows: 0,
    remainingTemporaryRows: 0,
    metricProcessedRecords: BATCH_SIZE,
    metricFailedRecords: 0,
    unresolvedSqlExceptionRows: 0,
    errorCodes: []
  };
}

function parkedBatchOutcome(): Partial<IngestionOutcome> {
  return {
    sourceRecords: BATCH_SIZE,
    successfulRows: 0,
    failedRows: BATCH_SIZE,
    remainingTemporaryRows: 0,
    metricProcessedRecords: 0,
    metricFailedRecords: BATCH_SIZE,
    unresolvedSqlExceptionRows: BATCH_SIZE,
    errorCodes: [INGESTION_ERROR_CODE.SQL_EXCEPTION],
    alertTypes: [INGESTION_ALERT_TYPE.PROCEDURE_EXCEPTION]
  };
}

function buildProcedureVariant(variantName: string, probeSql: string): string {
  const proceduresPath = join(process.cwd(), 'db/sql', 'storedprocedures.sql');
  const statements = splitSqlFile(readFileSync(proceduresPath, 'utf-8'));
  const createStatement = statements.find(({ sql }) => sql.startsWith('CREATE ') && sql.includes(`PROCEDURE ${CANONICAL_PROCEDURE}(`));
  if (!createStatement) throw new Error(`Could not locate the CREATE for ${CANONICAL_PROCEDURE} in ${proceduresPath}`);

  const renamed = createStatement.sql
    .replace(/definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi, '')
    .replace(`PROCEDURE ${CANONICAL_PROCEDURE}(`, `PROCEDURE ${variantName}(`);

  const anchorMatches = renamed.split(STAGE_7_ANCHOR).length - 1;
  if (anchorMatches !== 1) {
    throw new Error(`STAGE 7 anchor matched ${anchorMatches} times in ${CANONICAL_PROCEDURE}; expected exactly 1. Update STAGE_7_ANCHOR.`);
  }
  return renamed.replace(STAGE_7_ANCHOR, `${probeSql}${STAGE_7_ANCHOR}`);
}

async function openSessionConnection(config: TestDatabaseConfig): Promise<Connection> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    timezone: config.timezone,
    multipleStatements: false
  });
  await connection.query('SET SESSION innodb_lock_wait_timeout = ?', [LOCK_WAIT_TIMEOUT_SECONDS]);
  return connection;
}

async function closeQuietly(connection: Connection | null): Promise<void> {
  if (!connection) return;
  try {
    await connection.rollback();
  } finally {
    await connection.end().catch(() => connection.destroy());
  }
}

function describeError(error: MysqlDriverError): string {
  return `code=${error.code} errno=${error.errno} sqlState=${error.sqlState} message=${error.message}`;
}

describe('bulkingestionprocess transaction ownership (#527)', () => {
  let connection: Connection | null = null;
  let observer: Connection | null = null;
  let testData: TestData;
  let config: TestDatabaseConfig;
  const openedCallers: Connection[] = [];

  async function openCaller(): Promise<Connection> {
    const caller = await openSessionConnection(config);
    openedCallers.push(caller);
    return caller;
  }

  async function withLateFailureTrigger(run: () => Promise<void>): Promise<void> {
    await connection!.query(`DROP TRIGGER IF EXISTS ${LATE_FAILURE_TRIGGER}`);
    await connection!.query(
      `CREATE TRIGGER ${LATE_FAILURE_TRIGGER} BEFORE INSERT ON coremeasurements FOR EACH ROW
       BEGIN
         IF NEW.StemGUID IS NOT NULL THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${LATE_FAILURE_MARKER}';
         END IF;
       END`
    );
    try {
      await run();
    } finally {
      for (const caller of openedCallers) await caller.rollback();
      await connection!.query(`DROP TRIGGER IF EXISTS ${LATE_FAILURE_TRIGGER}`);
    }
  }

  async function expectNothingCommitted(batch: CaseBatch, sentinelMarker: string, reader: Connection): Promise<void> {
    expect(await sentinelVisible(reader, sentinelMarker), 'caller sentinel must not be visible').toBe(false);
    expect(await treeStemFootprint(reader, batch), 'no trees or stems may exist for this batch').toEqual({ trees: 0, stems: 0 });
    assertIngestionOutcome(await readIngestionOutcome(reader, batch.scope), emptyOutcome());
  }

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    await connection.query(`CREATE TABLE ${SENTINEL_TABLE} (SentinelID INT AUTO_INCREMENT PRIMARY KEY, Marker VARCHAR(80) NOT NULL UNIQUE) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE ${LOCK_TABLE} (LockID INT PRIMARY KEY, LockVersion INT NOT NULL) ENGINE=InnoDB`);
    const lockRows = [CALLER_LOCK_ID, PROCEDURE_LOCK_ID, ...Array.from({ length: BLOCKER_PADDING_ROW_COUNT }, (_, i) => BLOCKER_PADDING_FIRST_ID + i)].map(
      lockID => [lockID, 0]
    );
    await connection.query(`INSERT INTO ${LOCK_TABLE} (LockID, LockVersion) VALUES ?`, [lockRows]);

    observer = await openSessionConnection(config);
    await observer.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    while (openedCallers.length > 0) await closeQuietly(openedCallers.pop() ?? null);
    if (connection) {
      await connection.query(`DROP TRIGGER IF EXISTS ${LATE_FAILURE_TRIGGER}`);
      await cleanupTestMeasurements(connection, testData);
    }
  });

  afterAll(async () => {
    if (observer) await observer.end().catch(() => observer?.destroy());
    if (connection) await teardownTestDatabase(connection, config);
  });

  describe('own mode', () => {
    it(
      'rolls back trees and stems on a late failure and durably parks every row as an unresolved SQL_EXCEPTION',
      async () => {
        const { tagPrefix } = nextCaseIdentity('own');
        await withLateFailureTrigger(async () => {
          const batch = await stageBatch(connection!, testData, tagPrefix);
          const result = await callProcedure(connection!, CANONICAL_PROCEDURE, batch.scope);

          expect(Boolean(result?.batch_failed), `the handler must report batch_failed: ${JSON.stringify(result)}`).toBe(true);
          expect(await readStoredErrorMessage(connection!, batch.scope), 'the stored diagnostic must come from the injected late failure').toContain(
            LATE_FAILURE_MARKER
          );
          expect(await treeStemFootprint(connection!, batch), 'trees/stems inserted before the failure must be rolled back').toEqual({ trees: 0, stems: 0 });
          assertIngestionOutcome(await readIngestionOutcome(connection!, batch.scope), parkedBatchOutcome());

          assertIngestionOutcome(await readIngestionOutcome(observer!, batch.scope), parkedBatchOutcome());
          expect(await treeStemFootprint(observer!, batch)).toEqual({ trees: 0, stems: 0 });
        });
      },
      SUITE_TIMEOUT_MS
    );
  });

  describe('caller mode', () => {
    it(
      'success: writes are visible only inside the caller transaction and caller ROLLBACK removes all of them',
      async () => {
        const { tagPrefix, sentinelMarker } = nextCaseIdentity('ok');
        const caller = await openCaller();
        await caller.beginTransaction();
        await insertSentinel(caller, sentinelMarker);
        const batch = await stageBatch(caller, testData, tagPrefix);

        const result = await callInCallerTransaction(caller, CANONICAL_PROCEDURE, batch.scope);
        const flagAfterCall = await readCallerFlag(caller);

        expect(Boolean(result?.batch_failed), `a clean batch must succeed: ${JSON.stringify(result)}`).toBe(false);
        expect(await sentinelVisible(caller, sentinelMarker)).toBe(true);
        expect(await treeStemFootprint(caller, batch)).toEqual({ trees: BATCH_SIZE, stems: BATCH_SIZE });
        assertIngestionOutcome(await readIngestionOutcome(caller, batch.scope), successfulOutcome());

        await expectNothingCommitted(batch, sentinelMarker, observer!);
        expect(flagAfterCall, 'the procedure must clear the caller flag on entry').toBeNull();

        await caller.rollback();

        await expectNothingCommitted(batch, sentinelMarker, caller);
        await expectNothingCommitted(batch, sentinelMarker, observer!);
      },
      SUITE_TIMEOUT_MS
    );

    for (const finalization of ['commit', 'rollback'] as const) {
      it(
        `handled late failure then caller ${finalization.toUpperCase()}: procedure rolls back only its own work and leaves diagnostics to the caller`,
        async () => {
          const { tagPrefix, sentinelMarker } = nextCaseIdentity(finalization === 'commit' ? 'fc' : 'fr');
          const caller = await openCaller();

          await withLateFailureTrigger(async () => {
            await caller.beginTransaction();
            await insertSentinel(caller, sentinelMarker);
            const batch = await stageBatch(caller, testData, tagPrefix);

            const result = await callInCallerTransaction(caller, CANONICAL_PROCEDURE, batch.scope);
            const flagAfterCall = await readCallerFlag(caller);

            expect(Boolean(result?.batch_failed), `the handler must report batch_failed: ${JSON.stringify(result)}`).toBe(true);
            expect(await sentinelVisible(caller, sentinelMarker), 'savepoint rollback must spare caller work done before the CALL').toBe(true);
            expect(await treeStemFootprint(caller, batch)).toEqual({ trees: 0, stems: 0 });
            assertIngestionOutcome(await readIngestionOutcome(caller, batch.scope), parkedBatchOutcome());
            expect(await readStoredErrorMessage(caller, batch.scope)).toContain(LATE_FAILURE_MARKER);

            await expectNothingCommitted(batch, sentinelMarker, observer!);
            expect(flagAfterCall, 'the procedure must clear the caller flag on entry').toBeNull();

            if (finalization === 'commit') {
              await caller.commit();
              expect(await sentinelVisible(observer!, sentinelMarker), 'committed caller sentinel must persist').toBe(true);
              expect(await treeStemFootprint(observer!, batch)).toEqual({ trees: 0, stems: 0 });
              assertIngestionOutcome(await readIngestionOutcome(observer!, batch.scope), parkedBatchOutcome());
              expect(await readStoredErrorMessage(observer!, batch.scope)).toContain(LATE_FAILURE_MARKER);
            } else {
              await caller.rollback();
              await expectNothingCommitted(batch, sentinelMarker, caller);
              await expectNothingCommitted(batch, sentinelMarker, observer!);
            }
          });
        },
        SUITE_TIMEOUT_MS
      );
    }
  });

  describe('session reuse', () => {
    for (const path of ['success', 'handled failure'] as const) {
      it(
        `clears the flag after a caller-mode ${path} so a later unflagged batch on the same connection commits on its own`,
        async () => {
          const caller = await openCaller();
          const flagged = nextCaseIdentity(path === 'success' ? 'rs' : 'rf');

          const runFlagged = async () => {
            await caller.beginTransaction();
            const batch = await stageBatch(caller, testData, flagged.tagPrefix);
            const result = await callInCallerTransaction(caller, CANONICAL_PROCEDURE, batch.scope);
            const flagAfterCall = await readCallerFlag(caller);
            expect(Boolean(result?.batch_failed)).toBe(path === 'handled failure');
            await caller.commit();
            expect(flagAfterCall, `flag must be NULL immediately after a caller-mode ${path}`).toBeNull();
          };
          if (path === 'handled failure') await withLateFailureTrigger(runFlagged);
          else await runFlagged();

          const unflagged = nextCaseIdentity('ru');
          const batch = await stageBatch(caller, testData, unflagged.tagPrefix);
          const result = await callProcedure(caller, CANONICAL_PROCEDURE, batch.scope);

          expect(Boolean(result?.batch_failed), `unflagged batch must succeed: ${JSON.stringify(result)}`).toBe(false);
          assertIngestionOutcome(await readIngestionOutcome(observer!, batch.scope), successfulOutcome());
          expect(await treeStemFootprint(observer!, batch)).toEqual({ trees: BATCH_SIZE, stems: BATCH_SIZE });
        },
        SUITE_TIMEOUT_MS
      );
    }
  });

  describe('transaction loss', () => {
    beforeAll(async () => {
      await connection!.query(`DROP PROCEDURE IF EXISTS ${DEADLOCK_PROCEDURE}`);
      await connection!.query(buildProcedureVariant(DEADLOCK_PROCEDURE, DEADLOCK_PROBE_SQL));
      await connection!.query(`DROP PROCEDURE IF EXISTS ${LOST_SAVEPOINT_PROCEDURE}`);
      await connection!.query(buildProcedureVariant(LOST_SAVEPOINT_PROCEDURE, LOST_SAVEPOINT_PROBE_SQL));
    });

    afterAll(async () => {
      await connection?.query(`DROP PROCEDURE IF EXISTS ${DEADLOCK_PROCEDURE}`);
      await connection?.query(`DROP PROCEDURE IF EXISTS ${LOST_SAVEPOINT_PROCEDURE}`);
    });

    async function callerIsWaitingOnLockTable(caller: Connection): Promise<boolean> {
      const [rows] = await observer!.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS waits
         FROM performance_schema.data_lock_waits w
         JOIN performance_schema.threads th ON th.THREAD_ID = w.REQUESTING_THREAD_ID
         JOIN performance_schema.data_locks dl ON dl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
         WHERE th.PROCESSLIST_ID = ? AND dl.OBJECT_SCHEMA = DATABASE() AND dl.OBJECT_NAME = ?`,
        [caller.threadId, LOCK_TABLE]
      );
      return Number(rows[0].waits) > 0;
    }

    it(
      'a real InnoDB deadlock reaches the caller as the original ER_LOCK_DEADLOCK and autocommits nothing',
      async () => {
        const { tagPrefix, sentinelMarker } = nextCaseIdentity('dl');
        const caller = await openCaller();
        const blocker = await openCaller();

        await caller.beginTransaction();
        await insertSentinel(caller, sentinelMarker);
        await caller.query(`UPDATE ${LOCK_TABLE} SET LockVersion = LockVersion + 1 WHERE LockID = ?`, [CALLER_LOCK_ID]);
        const batch = await stageBatch(caller, testData, tagPrefix);

        await blocker.beginTransaction();
        await blocker.query(`UPDATE ${LOCK_TABLE} SET LockVersion = LockVersion + 1 WHERE LockID = ? OR LockID >= ?`, [
          PROCEDURE_LOCK_ID,
          BLOCKER_PADDING_FIRST_ID
        ]);

        const callerCall = settle(callInCallerTransaction(caller, DEADLOCK_PROCEDURE, batch.scope));
        await pollUntil('the caller CALL to wait on the probe lock', LOCK_WAIT_OBSERVE_DEADLINE_MS, async () => {
          const early = await settleWithin(callerCall, 0);
          if (early !== 'pending') {
            throw new Error(
              `caller CALL settled before reaching the probe: ${JSON.stringify(early.status === 'rejected' ? describeError(early.error) : early.value)}`
            );
          }
          return callerIsWaitingOnLockTable(caller);
        });

        const blockerRequest = settle(blocker.query(`UPDATE ${LOCK_TABLE} SET LockVersion = LockVersion + 1 WHERE LockID = ?`, [CALLER_LOCK_ID]));
        const callerOutcome = await settleWithin(callerCall, DEADLOCK_SETTLE_DEADLINE_MS);
        const blockerOutcome = await settleWithin(blockerRequest, DEADLOCK_SETTLE_DEADLINE_MS);

        if (blockerOutcome !== 'pending' && blockerOutcome.status === 'rejected') {
          throw new Error(
            `fixture error: InnoDB chose the blocker as the deadlock victim (${describeError(blockerOutcome.error)}); raise BLOCKER_PADDING_ROW_COUNT`
          );
        }
        if (callerOutcome === 'pending') {
          const blockerState = blockerOutcome === 'pending' ? 'the blocker is still waiting too' : 'the blocker took the caller lock without waiting';
          await blocker.rollback();
          await settle(callerCall);
          throw new Error(
            `no deadlock formed within ${DEADLOCK_SETTLE_DEADLINE_MS}ms: ${blockerState}, so the caller transaction no longer held its lock ` +
              '(was the caller transaction committed before STAGE 7?)'
          );
        }
        if (callerOutcome.status === 'resolved') {
          throw new Error(`caller CALL resolved instead of propagating the deadlock: ${JSON.stringify(callerOutcome.value)}`);
        }

        expect(
          { code: callerOutcome.error.code, errno: callerOutcome.error.errno, sqlState: callerOutcome.error.sqlState },
          `original deadlock must escape unchanged (got ${describeError(callerOutcome.error)})`
        ).toEqual(ER_LOCK_DEADLOCK);
        expect(await readCallerFlag(caller)).toBeNull();
        expect(await lingeringScratchTables(caller), 'procedure scratch tables must be dropped on the propagated path').toEqual([]);

        await blocker.rollback();
        await expectNothingCommitted(batch, sentinelMarker, observer!);
        await caller.rollback();
        await expectNothingCommitted(batch, sentinelMarker, observer!);

        const recovery = nextCaseIdentity('dr');
        await caller.beginTransaction();
        const recoveryBatch = await stageBatch(caller, testData, recovery.tagPrefix);
        const recoveryResult = await callInCallerTransaction(caller, CANONICAL_PROCEDURE, recoveryBatch.scope);
        await caller.commit();
        expect(Boolean(recoveryResult?.batch_failed), `fresh transaction after the deadlock must ingest: ${JSON.stringify(recoveryResult)}`).toBe(false);
        assertIngestionOutcome(await readIngestionOutcome(observer!, recoveryBatch.scope), successfulOutcome());
      },
      SUITE_TIMEOUT_MS
    );

    it(
      'a lost savepoint propagates the original error instead of ER_SP_DOES_NOT_EXIST and leaves rollback to the caller',
      async () => {
        const { tagPrefix, sentinelMarker } = nextCaseIdentity('ls');
        const caller = await openCaller();
        await caller.beginTransaction();
        await insertSentinel(caller, sentinelMarker);
        const batch = await stageBatch(caller, testData, tagPrefix);

        const outcome = await settle(callInCallerTransaction(caller, LOST_SAVEPOINT_PROCEDURE, batch.scope));

        if (outcome.status === 'resolved') {
          throw new Error(`CALL resolved instead of propagating the original error: ${JSON.stringify(outcome.value)}`);
        }
        expect(outcome.error.errno, `expected the signaled condition, got ${describeError(outcome.error)}`).not.toBe(ER_SP_DOES_NOT_EXIST_ERRNO);
        expect(outcome.error.errno, describeError(outcome.error)).toBe(ER_SIGNAL_EXCEPTION_ERRNO);
        expect(outcome.error.message).toContain(LOST_SAVEPOINT_MARKER);
        expect(await readCallerFlag(caller)).toBeNull();
        expect(await lingeringScratchTables(caller)).toEqual([]);
        expect(await treeStemFootprint(caller, batch), 'caller transaction still holds the trees/stems until it rolls back').toEqual({
          trees: BATCH_SIZE,
          stems: BATCH_SIZE
        });

        await expectNothingCommitted(batch, sentinelMarker, observer!);
        await caller.rollback();
        await expectNothingCommitted(batch, sentinelMarker, caller);
        await expectNothingCommitted(batch, sentinelMarker, observer!);
      },
      SUITE_TIMEOUT_MS
    );
  });

  describe('helper session hygiene', () => {
    function executorBoundTo(caller: Connection): BulkIngestionExecutor {
      return {
        query: async (sql, params) => {
          const [rows] = await caller.query(sql, params);
          return rows as never;
        },
        discard: reason => {
          throw new Error(`discard must not run when CLEAR succeeds (reason: ${reason})`);
        }
      };
    }

    it(
      'clears the flag when the CALL is rejected before the procedure could, so the next unflagged batch commits on its own',
      async () => {
        const caller = await openCaller();
        const rejected = nextCaseIdentity('pe');
        await connection!.query(`DROP PROCEDURE IF EXISTS ${CANONICAL_PROCEDURE}`);
        try {
          await caller.beginTransaction();
          const batch = await stageBatch(caller, testData, rejected.tagPrefix);

          const outcome = await settle(callBulkIngestionInCallerTransaction(executorBoundTo(caller), config.database, batch.scope.fileID, batch.scope.batchID));

          if (outcome.status === 'resolved') throw new Error(`CALL of a dropped procedure resolved: ${JSON.stringify(outcome.value)}`);
          expect({ code: outcome.error.code, errno: outcome.error.errno }, describeError(outcome.error)).toEqual({
            code: ER_SP_DOES_NOT_EXIST,
            errno: ER_SP_DOES_NOT_EXIST_ERRNO
          });
          expect(await readCallerFlag(caller), 'the helper must clear a flag the procedure never consumed').toBeNull();
        } finally {
          await caller.rollback();
          await loadStoredProcedures(connection!);
        }

        const unflagged = nextCaseIdentity('pu');
        const batch = await stageBatch(caller, testData, unflagged.tagPrefix);
        const result = await callProcedure(caller, CANONICAL_PROCEDURE, batch.scope);

        expect(Boolean(result?.batch_failed), `unflagged batch must succeed: ${JSON.stringify(result)}`).toBe(false);
        assertIngestionOutcome(await readIngestionOutcome(observer!, batch.scope), successfulOutcome());
      },
      SUITE_TIMEOUT_MS
    );
  });
});
