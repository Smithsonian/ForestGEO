/** Real-MySQL proofs for the all-or-nothing DBH re-score boundary. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { buildMeasurementScopeLockName } from '@/config/measurementscopelock';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import {
  finalizeValidatedRowsInTransaction,
  prepareDBHValidationDefinitions,
  runSharedDBHChangeValidationsInTransaction
} from '@/lib/validations/dbh-execution';
import { reconcileDbhRescoreAttempt, rescoreDbhCensus, type DbhRescoreDependencies } from '@/lib/validations/dbh-rescore';
import {
  cleanupTestMeasurements,
  createAdditionalCensus,
  insertCrossCensusMeasurements,
  setupTestDatabase,
  setupTwoCensusScenario,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

type Tx = { id: string; query(sql: string, params?: unknown[]): Promise<unknown> };
type Fault = (sql: string, params: unknown[]) => Promise<void> | void;
function managerFor(connection: Connection, fault?: Fault) {
  let sequence = 0;
  const locks = new Set<string>();
  const query = async (sql: string, params: unknown[] = []) => {
    await fault?.(sql, params);
    return (await connection.query(sql, params))[0];
  };
  return {
    executeQuery: query,
    withTransaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      await connection.beginTransaction();
      try {
        const value = await fn({ id: `dbh-real-${++sequence}`, query });
        await connection.commit();
        return value;
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          /* killed sessions roll back server-side */
        }
        throw error;
      } finally {
        for (const name of locks) await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined);
        locks.clear();
      }
    },
    acquireApplicationLock: async (name: string, _tx: string, timeoutMs: number) => {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS got', [name, Math.ceil(timeoutMs / 1000)]);
      if (Number(rows[0]?.got) === 1) locks.add(name);
      return Number(rows[0]?.got) === 1;
    }
  };
}
const bool = (value: unknown): boolean | null => (value == null ? null : Buffer.isBuffer(value) ? value[0] === 1 : Number(value) === 1);

describe('rescoreDbhCensus transaction boundary', () => {
  let connection: Connection,
    schema: string,
    testData: TestData,
    plotID: number,
    census1ID: number,
    census2ID: number,
    speciesCode: string,
    quadratName: string;
  let serial = 0;
  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    schema = setup.config.database;
    testData = setup.testData;
    ({
      census1: { censusID: census1ID },
      census2: { censusID: census2ID }
    } = await setupTwoCensusScenario(connection, testData));
    plotID = testData.plots[0].plotID;
    speciesCode = testData.species[0].SpeciesCode || testData.species[0].Mnemonic;
    quadratName = testData.quadrats[0].QuadratName || testData.quadrats[0].Quadrat;
    await connection.query(
      "CREATE TABLE IF NOT EXISTS validation_runs (RunID INT AUTO_INCREMENT PRIMARY KEY, PlotID INT NOT NULL, CensusID INT NOT NULL, Status ENUM ('running','completed','failed','cancelled') NOT NULL DEFAULT 'running', TotalSteps INT NOT NULL DEFAULT 0, CompletedSteps INT NOT NULL DEFAULT 0, FailedSteps INT NOT NULL DEFAULT 0, CurrentStep VARCHAR(100), ErrorMessages JSON, StartedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CompletedAt DATETIME NULL) ENGINE=InnoDB"
    );
    await connection.query(
      "CREATE TABLE IF NOT EXISTS upload_sessions (session_id VARCHAR(64) PRIMARY KEY, schema_name VARCHAR(64), plot_id INT, census_id INT, user_id VARCHAR(255), state ENUM ('initialized','uploading','uploaded','processing','collapsing','completed','failed','abandoned','cleaned_up') NOT NULL DEFAULT 'initialized') ENGINE=InnoDB"
    );
    await connection.query('CREATE DATABASE IF NOT EXISTS catalog');
    await connection.query(
      "CREATE TABLE IF NOT EXISTS catalog.background_jobs (JobID INT AUTO_INCREMENT PRIMARY KEY, SchemaName VARCHAR(64), PlotID INT, CensusID INT, Status ENUM ('queued','running','cancel_requested','waiting_retry','completed','failed','cancelled') NOT NULL) ENGINE=InnoDB"
    );
  }, 120000);
  afterAll(async () => teardownTestDatabase(connection, { database: schema }));
  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    await connection.query('DELETE FROM validation_runs');
    await connection.query('DELETE FROM upload_sessions');
    await connection.query('DELETE FROM catalog.background_jobs WHERE SchemaName=?', [schema]);
  });
  async function pair(tag: string, prior: number, present: number) {
    serial += 1;
    const rows = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: `${tag}${serial}`,
        stemTag: `S${serial}`,
        speciesCode,
        quadratName,
        x: serial,
        y: serial,
        census1DBH: prior,
        census2DBH: present,
        hom: 1.3,
        census1Date: '2015-01-01',
        census2Date: '2025-01-01',
        codes: 'A'
      }
    ]);
    return { prior: rows.census1MeasurementIDs[0], present: rows.census2MeasurementIDs[0] };
  }
  function actual(connectionForRun = connection, fault?: Fault): DbhRescoreDependencies {
    return {
      connectionManager: managerFor(connectionForRun, fault) as any,
      writeArtifact: async () => undefined,
      attemptID: () => `dbh-it-${serial}`,
      prepareDefinitions: prepareDBHValidationDefinitions,
      runDbh: runSharedDBHChangeValidationsInTransaction,
      finalize: finalizeValidatedRowsInTransaction,
      refreshViews: refreshMeasurementViewsForScope
    };
  }
  async function snapshot() {
    const [measurements] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated, IsActive, StemGUID FROM coremeasurements WHERE CensusID=? ORDER BY CoreMeasurementID',
      [census2ID]
    );
    const [errors] = await connection.query<RowDataPacket[]>(
      'SELECT mel.MeasurementID, me.ErrorCode, mel.IsResolved, mel.ResolvedAt, mel.PriorCensusID, mel.PriorDBH, mel.PriorHOM FROM measurement_error_log mel JOIN measurement_errors me ON me.ErrorID=mel.ErrorID JOIN coremeasurements cm ON cm.CoreMeasurementID=mel.MeasurementID WHERE cm.CensusID=? ORDER BY mel.MeasurementID, me.ErrorCode',
      [census2ID]
    );
    const [summary] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated, Errors FROM measurementssummary WHERE CensusID=? ORDER BY CoreMeasurementID',
      [census2ID]
    );
    const [full] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated FROM viewfulltable WHERE CensusID=? ORDER BY CoreMeasurementID',
      [census2ID]
    );
    return JSON.parse(JSON.stringify({ measurements, errors, summary, full }));
  }
  async function assertRollback(run: Promise<unknown>, before: unknown) {
    await expect(run).resolves.toMatchObject({ outcome: 'failed' });
    expect(await snapshot()).toEqual(before);
    expect((await connection.query<RowDataPacket[]>('SELECT RunID FROM validation_runs'))[0]).toHaveLength(0);
  }

  it('uses the default ConnectionManager and deployed procedures for TRUE→FALSE and stale FALSE→TRUE', async () => {
    const violates = await pair('GROW', 100, 900),
      retired = await pair('RETIRED', 100, 105);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID IN (?,?)', [violates.present, retired.present]);
    const [growth] = await connection.query<RowDataPacket[]>("SELECT ErrorID FROM measurement_errors WHERE ErrorSource='validation' AND ErrorCode='1'");
    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, FALSE)', [retired.present, growth[0].ErrorID]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);
    const result = await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, { writeArtifact: async () => undefined, attemptID: () => 'default-real' });
    expect(result).toMatchObject({ outcome: 'completed', databaseOutcome: 'committed' });
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated FROM coremeasurements WHERE CoreMeasurementID IN (?,?) ORDER BY CoreMeasurementID',
      [violates.present, retired.present]
    );
    expect(rows.map(row => bool(row.IsValidated))).toEqual([false, true]);
  }, 120000);

  it('preserves unrelated unresolved errors and leaves inactive/null-stem rows untouched', async () => {
    const normal = await pair('OVERRIDE', 100, 105),
      inactive = await pair('INACTIVE', 100, 900);
    await connection.query('UPDATE coremeasurements SET IsValidated=FALSE WHERE CoreMeasurementID IN (?,?)', [normal.present, inactive.present]);
    await connection.query('UPDATE coremeasurements SET IsActive=FALSE WHERE CoreMeasurementID=?', [inactive.present]);
    await connection.query('UPDATE coremeasurements SET StemGUID=NULL, IsValidated=FALSE WHERE CoreMeasurementID=?', [inactive.prior]);
    // A non-DBH *validation* override must still drive the finalizer, while
    // its occurrence is left intact by the 1/2 scrub.
    const [error] = await connection.query<RowDataPacket[]>(
      "SELECT me.ErrorID FROM measurement_errors me JOIN sitespecificvalidations v ON v.ValidationID=CAST(me.ErrorCode AS UNSIGNED) WHERE me.ErrorSource='validation' AND me.ErrorCode NOT IN ('1','2') LIMIT 1"
    );
    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, FALSE)', [normal.present, error[0].ErrorID]);
    expect(await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, actual())).toMatchObject({ outcome: 'completed' });
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated FROM coremeasurements WHERE CoreMeasurementID IN (?,?) ORDER BY CoreMeasurementID',
      [normal.present, inactive.present]
    );
    expect(rows.map(r => bool(r.IsValidated))).toEqual([false, false]);
  });

  it.each(['before', 'prepared'] as const)('rolls back exact measurements, errors, and views when %s artifact fails', async event => {
    const seeded = await pair('ART', 100, 900);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [seeded.present]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);
    await assertRollback(
      rescoreDbhCensus(
        { schema, plotID, censusID: census2ID },
        {
          ...actual(),
          writeArtifact: async value => {
            if (value.event === event) throw new Error(`${event} unavailable`);
          }
        }
      ),
      await snapshot()
    );
  });

  it('rolls back after real DBH work, refresh work, and a terminal record error', async () => {
    const seeded = await pair('MID', 100, 900);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [seeded.present]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);
    const before = await snapshot();
    let called = false;
    await assertRollback(
      rescoreDbhCensus(
        { schema, plotID, censusID: census2ID },
        {
          ...actual(),
          runDbh: async input => {
            const out = await runSharedDBHChangeValidationsInTransaction(input);
            called = true;
            throw new Error('after DBH work');
          }
        }
      ),
      before
    );
    expect(called).toBe(true);
    let deleted = false;
    await assertRollback(
      rescoreDbhCensus(
        { schema, plotID, censusID: census2ID },
        actual(connection, sql => {
          if (/DELETE FROM .*measurementssummary/i.test(sql)) deleted = true;
          if (deleted && /INSERT IGNORE INTO .*measurementssummary/i.test(sql)) throw new Error('refresh failure');
        })
      ),
      before
    );
    await assertRollback(
      rescoreDbhCensus(
        { schema, plotID, censusID: census2ID },
        actual(connection, sql => {
          if (/UPDATE .*validation_runs.*Status = 'running'/i.test(sql)) throw new Error('terminal failure');
        })
      ),
      before
    );
  });

  it('reports a post-commit artifact error as committed', async () => {
    const seeded = await pair('POST', 100, 105);
    await connection.query('UPDATE coremeasurements SET IsValidated=FALSE WHERE CoreMeasurementID=?', [seeded.present]);
    expect(
      await rescoreDbhCensus(
        { schema, plotID, censusID: census2ID },
        {
          ...actual(),
          writeArtifact: async event => {
            if (event.event === 'committed') throw new Error('disk full');
          }
        }
      )
    ).toMatchObject({ outcome: 'artifact-failed', databaseOutcome: 'committed' });
  });

  it('reconciles a real lost COMMIT acknowledgement as committed without claiming rollback', async () => {
    const violates = await pair('ACKLOSS', 100, 900);
    const clean = await pair('ACKCLEAN', 100, 105);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID IN (?,?)', [violates.present, clean.present]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);

    const pool = await getPoolMonitorInstance().getUsablePool();
    const originalGetConnection = pool.getConnection.bind(pool);
    let injected = false;
    (pool as any).getConnection = async () => {
      const txConnection = await originalGetConnection();
      const actualCommit = txConnection.commit.bind(txConnection);
      txConnection.commit = async () => {
        await actualCommit();
        if (!injected) {
          injected = true;
          (pool as any).getConnection = originalGetConnection;
          throw new Error('simulated lost COMMIT acknowledgement');
        }
      };
      return txConnection;
    };
    try {
      const result = await rescoreDbhCensus(
        { schema, plotID, censusID: census2ID },
        { writeArtifact: async () => undefined, attemptID: () => 'lost-real-commit-ack' }
      );
      expect(injected).toBe(true);
      expect(result).toMatchObject({ outcome: 'failed', databaseOutcome: 'committed', runID: expect.any(Number), provisionalRunID: expect.any(Number) });
      expect(result.runID).toBe(result.provisionalRunID);
      const [run] = await connection.query<RowDataPacket[]>('SELECT Status, ErrorMessages FROM validation_runs WHERE RunID=?', [result.runID]);
      expect(run).toHaveLength(1);
      expect(run[0].Status).toBe('completed');
      expect(JSON.stringify(run[0].ErrorMessages)).toContain('dbh-rescore-attempt:lost-real-commit-ack');
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT CoreMeasurementID, IsValidated FROM coremeasurements WHERE CoreMeasurementID IN (?,?) ORDER BY CoreMeasurementID',
        [violates.present, clean.present]
      );
      expect(rows.map(row => bool(row.IsValidated))).toEqual([false, true]);
      const views = await snapshot();
      expect(views.summary).toHaveLength(2);
      expect(views.full).toHaveLength(2);
    } finally {
      (pool as any).getConnection = originalGetConnection;
    }
  }, 120000);

  it('rolls back exact durable state when the real execution connection dies after reset and DBH work', async () => {
    const seeded = await pair('KILL', 100, 900);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [seeded.present]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);
    const before = await snapshot();
    const execution = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'testpassword', database: schema });
    try {
      await assertRollback(
        rescoreDbhCensus(
          { schema, plotID, censusID: census2ID },
          {
            ...actual(execution),
            runDbh: async input => {
              const value = await runSharedDBHChangeValidationsInTransaction(input);
              const [id] = await execution.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
              await connection.query(`KILL CONNECTION ${Number(id[0].id)}`);
              return value;
            }
          }
        ),
        before
      );
      // A DBH-only retry is possible after the server has released transaction and advisory locks.
      expect(await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, actual())).toMatchObject({ outcome: 'completed', databaseOutcome: 'committed' });
    } finally {
      await execution.end().catch(() => undefined);
    }
  });

  it.each(['after-reset', 'after-refresh'] as const)('rolls back and permits a direct retry when the execution session is killed %s', async phase => {
    const seeded = await pair(`KILL${phase}`, 100, 900);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [seeded.present]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);
    const before = await snapshot();
    const execution = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'testpassword', database: schema });
    const kill = async () => {
      const [id] = await execution.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
      await connection.query(`KILL CONNECTION ${Number(id[0].id)}`);
    };
    try {
      const deps = actual(execution);
      if (phase === 'after-reset')
        deps.runDbh = async input => {
          await kill();
          return runSharedDBHChangeValidationsInTransaction(input);
        };
      else
        deps.refreshViews = async (...args) => {
          await refreshMeasurementViewsForScope(...args);
          await kill();
        };
      await assertRollback(rescoreDbhCensus({ schema, plotID, censusID: census2ID }, deps), before);
      expect(await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, actual())).toMatchObject({ outcome: 'completed', databaseOutcome: 'committed' });
    } finally {
      await execution.end().catch(() => undefined);
    }
  });

  it('never reports success when the actual ConnectionManager transaction times out', async () => {
    const seeded = await pair('TIMEOUT', 100, 900);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [seeded.present]);
    await refreshMeasurementViewsForScope(managerFor(connection) as any, schema, plotID, census2ID);
    const before = await snapshot();
    const result = await rescoreDbhCensus(
      { schema, plotID, censusID: census2ID },
      {
        writeArtifact: async () => undefined,
        attemptID: () => 'timeout-real',
        timeoutMs: 20,
        runDbh: async input => {
          await input.tx.query('SELECT SLEEP(0.2)');
          return runSharedDBHChangeValidationsInTransaction(input);
        }
      }
    );
    expect(result.outcome).toBe('failed');
    expect(result.databaseOutcome).not.toBe('committed');
    // The timeout cleanup has completed before the service reports the failure.
    expect(await snapshot()).toEqual(before);
  }, 120000);

  it.each(['running', 'pending', 'upload'] as const)('defers current/prior stale %s work before reset', async kind => {
    const seeded = await pair(`BUSY${kind}`, 100, 105);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [seeded.present]);
    const before = await snapshot();
    if (kind === 'running')
      await connection.query("INSERT INTO validation_runs (PlotID,CensusID,Status,StartedAt) VALUES (?,?,'running',DATE_SUB(NOW(), INTERVAL 2 HOUR))", [
        plotID,
        census1ID
      ]);
    if (kind === 'pending') await connection.query('UPDATE coremeasurements SET IsValidated=NULL WHERE CoreMeasurementID=?', [seeded.prior]);
    if (kind === 'upload')
      await connection.query(
        "INSERT INTO upload_sessions (session_id,schema_name,plot_id,census_id,user_id,state) VALUES ('old-upload',?,?,?,'test','processing')",
        [schema, plotID, census1ID]
      );
    expect(await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, actual())).toMatchObject({
      outcome: 'deferred-pending',
      databaseOutcome: 'not-started'
    });
    expect(await snapshot()).toEqual(before);
  });

  it('uses a second real session for lock conflicts and cleans up partial acquisition', async () => {
    const blocker = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'testpassword', database: schema });
    const current = buildMeasurementScopeLockName(schema, plotID, census2ID),
      prior = buildMeasurementScopeLockName(schema, plotID, census1ID);
    try {
      await blocker.query('SELECT GET_LOCK(?,0)', [current]);
      expect(await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, actual())).toMatchObject({ outcome: 'skipped-locked' });
      await blocker.query('SELECT RELEASE_LOCK(?)', [current]);
      await blocker.query('SELECT GET_LOCK(?,0)', [prior]);
      expect(await rescoreDbhCensus({ schema, plotID, censusID: census2ID }, actual())).toMatchObject({ outcome: 'skipped-locked' });
      expect(Number((await blocker.query<RowDataPacket[]>('SELECT IS_FREE_LOCK(?) AS free', [current]))[0][0].free)).toBe(1);
    } finally {
      await blocker.query('SELECT RELEASE_ALL_LOCKS()').catch(() => undefined);
      await blocker.end();
    }
  });

  it('re-evaluates N+1 comparisons when N changes validity, and treats a numbering gap as no comparison', async () => {
    expect(await rescoreDbhCensus({ schema, plotID, censusID: census1ID }, actual())).toMatchObject({ outcome: 'completed' });
    const c3 = await createAdditionalCensus(connection, testData, { plotCensusNumber: 3, startDate: '2030-01-01', endDate: '2030-12-31' });
    const chain = await insertCrossCensusMeasurements(connection, testData, census2ID, c3.censusID, [
      {
        treeTag: `CHAIN${++serial}`,
        stemTag: `S${serial}`,
        speciesCode,
        quadratName,
        x: serial,
        y: serial,
        census1DBH: 100,
        census2DBH: 900,
        hom: 1.3,
        census1Date: '2025-01-01',
        census2Date: '2030-01-01',
        codes: 'A'
      }
    ]);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [chain.census2MeasurementIDs[0]]);
    expect(await rescoreDbhCensus({ schema, plotID, censusID: c3.censusID }, actual())).toMatchObject({ outcome: 'completed' });
    expect(
      bool(
        (await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID=?', [chain.census2MeasurementIDs[0]]))[0][0]
          .IsValidated
      )
    ).toBe(false);
    await connection.query('UPDATE coremeasurements SET IsValidated=FALSE WHERE CoreMeasurementID=?', [chain.census1MeasurementIDs[0]]);
    expect(await rescoreDbhCensus({ schema, plotID, censusID: c3.censusID }, actual())).toMatchObject({ outcome: 'completed' });
    expect(
      bool(
        (await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID=?', [chain.census2MeasurementIDs[0]]))[0][0]
          .IsValidated
      )
    ).toBe(true);
    await connection.query('UPDATE census SET PlotCensusNumber=4 WHERE CensusID=?', [c3.censusID]);
    expect(await rescoreDbhCensus({ schema, plotID, censusID: c3.censusID }, actual())).toMatchObject({ outcome: 'completed', databaseOutcome: 'committed' });
  });

  it('requires original session and InnoDB transaction termination before an absent attempt is rolled back', async () => {
    const scope = { schema, plotID, censusID: census2ID };
    expect((await reconcileDbhRescoreAttempt(scope, 'missing', { queryFresh: async () => [] })).databaseOutcome).toBe('unknown');
    const transactionStillLive = await reconcileDbhRescoreAttempt(scope, 'missing', {
      originalConnectionID: 777,
      queryFresh: async sql => {
        if (sql.includes('validation_runs')) return [];
        if (sql.includes('PROCESSLIST')) return [{ sessionCount: 0 }];
        return [{ transactionCount: 1 }];
      }
    });
    expect(transactionStillLive.databaseOutcome).toBe('unknown');
    const unavailableCount = await reconcileDbhRescoreAttempt(scope, 'missing', {
      originalConnectionID: 777,
      queryFresh: async sql => {
        if (sql.includes('validation_runs')) return [];
        return sql.includes('PROCESSLIST') ? [{ sessionCount: null }] : [{ transactionCount: 0 }];
      }
    });
    expect(unavailableCount.databaseOutcome).toBe('unknown');
    const bothGone = await reconcileDbhRescoreAttempt(scope, 'missing', {
      originalConnectionID: 777,
      queryFresh: async sql => {
        if (sql.includes('validation_runs')) return [];
        return sql.includes('PROCESSLIST') ? [{ sessionCount: 0 }] : [{ transactionCount: 0 }];
      }
    });
    expect(bothGone.databaseOutcome).toBe('rolled-back');
  });

  it('recognizes a completed marker from a fresh session while the original session remains alive', async () => {
    const attempt = 'live-session-committed';
    const [insert] = await connection.query<mysql.ResultSetHeader>(
      "INSERT INTO validation_runs (PlotID,CensusID,TotalSteps,Status,ErrorMessages) VALUES (?, ?, 2, 'completed', JSON_ARRAY(?))",
      [plotID, census2ID, `dbh-rescore-attempt:${attempt}`]
    );
    const [owner] = await connection.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
    const fresh = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'testpassword', database: schema });
    try {
      expect(
        await reconcileDbhRescoreAttempt({ schema, plotID, censusID: census2ID }, attempt, {
          originalConnectionID: Number(owner[0].id),
          queryFresh: async (sql, params) => (await fresh.query(sql, params ?? []))[0] as any
        })
      ).toMatchObject({ databaseOutcome: 'committed', runID: insert.insertId });
    } finally {
      await fresh.end();
    }
  });
});
