/**
 * Recent Changes audit for the admin mutation routes #507 left uncovered, proven against real MySQL:
 *
 *   - POST /api/clearcensus runs the REAL clearcensusmsmts / clearcensusfull procedures (loaded from
 *     db/sql/storedprocedures.sql by local-db-setup) in caller-owned mode and records one summary row
 *     with the delete counts they report; the summary and the deletes commit or roll back together —
 *     including when the procedure itself fails.
 *   - DELETE /api/admin/clear/failedmeasurements audits every failed row it removes.
 *   - POST/PATCH/DELETE /api/validations/crud audit every site-specific validation change, and their
 *     writes now actually run on the route transaction.
 *
 * ConnectionManager is proxied onto one real connection (begin/commit/rollback are real InnoDB
 * transactions) and rejects any statement not bound to the open transaction, as in
 * reingest-routes.integration.test.ts. A test can make every unifiedchangelog INSERT fail to prove
 * the data write rolls back with it.
 *
 * Test order matters: the last test clears the schema's only seeded census with type 'full', which
 * empties every reference table.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { NextRequest } from 'next/server';
import {
  cleanupTestMeasurements,
  createAdditionalCensus,
  getFailedMeasurements,
  insertDirectMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';
import { LOCK_WAIT_POLL_INTERVAL_MS } from '../setup/core-measurement-window-harness';

const AUTH_USER_EMAIL = 'admin-audit-runner@forestgeo.test';
const SIMULATED_AUDIT_FAILURE = 'SIMULATED_AUDIT_WRITE_FAILURE_507';
const CENSUS_DELETE_BLOCKED_MESSAGE = 'SIMULATED_CENSUS_DELETE_FAILURE_507';
const CENSUS_DELETE_BLOCKER_TRIGGER = 'test_507_block_census_delete';
const FORGED_VALIDATION_ID = 987654;
const LOCK_WAIT_DEADLINE_MS = 5000;
const MYSQL_NO_REFERENCED_ROW = 'ER_NO_REFERENCED_ROW_2';
const MYSQL_LOCK_DEADLOCK = 'ER_LOCK_DEADLOCK';
const FULL_CLEAR_REFERENCE_TABLES = ['attributes', 'personnel', 'roles', 'quadrats', 'species', 'specieslimits', 'genus', 'family', 'reference'] as const;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  failAuditInserts: false,
  /** Fails only the changelog INSERT this predicate picks, e.g. one table's rows after the CALL. */
  failAuditInsertWhen: null as ((params: unknown[] | undefined) => boolean) | null,
  /** Runs, on the test's own schedule, just before the route's CALL statement reaches MySQL. */
  beforeProcedureCall: null as (() => Promise<void>) | null,
  loggedErrors: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: sharedState.loggedErrors }
}));

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: async () => ({ success: false })
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const TRANSACTION_ID = 'admin-audit-tx';
  const { runQueryDispatch } = await vi.importActual<typeof import('../setup/runquerydispatch')>('../setup/runquerydispatch');
  const { SET_READ_COMMITTED_ISOLATION_SQL } = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');

  function assertBoundToActiveTransaction(sql: string, transactionID: string | undefined): void {
    const active = sharedState.activeTransactionID ?? undefined;
    if (active !== transactionID) {
      throw new Error(
        `executeQuery transaction mismatch: active=${active ?? 'none'} received=${transactionID ?? 'none'} for: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`
      );
    }
  }

  function requireConnection(): Connection {
    if (!sharedState.connection) throw new Error('Test DB connection not initialized');
    return sharedState.connection;
  }

  const manager = {
    executeQuery: async (sql: string, params?: unknown[], transactionID?: string) => {
      assertBoundToActiveTransaction(sql, transactionID);
      const isAuditInsert = /^\s*INSERT INTO\s+\S*unifiedchangelog/i.test(sql);
      if (isAuditInsert && (sharedState.failAuditInserts || sharedState.failAuditInsertWhen?.(params))) {
        throw new Error(SIMULATED_AUDIT_FAILURE);
      }
      if (/^\s*CALL /i.test(sql)) await sharedState.beforeProcedureCall?.();
      // Same text/prepared split as production's runQuery, so prepared-statement behaviour is exercised.
      return runQueryDispatch(requireConnection(), sql, params);
    },
    discardTransaction: (transactionID: string, reason: string) => {
      throw new Error(`discardTransaction must not run in this suite (transaction ${transactionID}: ${reason})`);
    },
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true,
    beginTransaction: async () => {
      // Production runs every transaction at READ COMMITTED; the race tests below depend on it.
      await requireConnection().query(SET_READ_COMMITTED_ISOLATION_SQL);
      await requireConnection().beginTransaction();
      sharedState.activeTransactionID = TRANSACTION_ID;
      return TRANSACTION_ID;
    },
    commitTransaction: async () => {
      await requireConnection().commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      await requireConnection().rollback();
      sharedState.activeTransactionID = null;
    }
  };

  return { default: { getInstance: () => manager } };
});

import { POST as clearCensusPost } from '@/app/api/clearcensus/route';
import { DELETE as adminClearDelete } from '@/app/api/admin/clear/[tableType]/[schema]/[plotID]/[censusID]/route';
import { DELETE as validationsDelete, PATCH as validationsPatch, POST as validationsPost } from '@/app/api/validations/crud/route';

interface AuditRow {
  TableName: string;
  RecordID: string;
  Operation: string;
  OldRowState: Record<string, unknown> | null;
  NewRowState: Record<string, unknown> | null;
  ChangedBy: string | null;
  PlotID: number | null;
  CensusID: number | null;
}

describe('Recent Changes audit for admin mutation routes (#507)', () => {
  let connection: Connection;
  /** A second session, for writes that race the route's transaction. */
  let concurrentSession: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
    concurrentSession = await mysql.createConnection(config);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await concurrentSession.end();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.failAuditInserts = false;
    sharedState.failAuditInsertWhen = null;
    sharedState.beforeProcedureCall = null;
    await connection.query(`DROP TRIGGER IF EXISTS ${CENSUS_DELETE_BLOCKER_TRIGGER}`);
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['uploadintegrityalerts', 'uploadmetrics', 'unifiedchangelog'] });
  });

  async function loadAuditRows(tableName: string): Promise<AuditRow[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT TableName, RecordID, Operation, OldRowState, NewRowState, ChangedBy, PlotID, CensusID
       FROM unifiedchangelog WHERE TableName = ? ORDER BY ChangeID`,
      [tableName]
    );
    return rows as AuditRow[];
  }

  /** Resolves once InnoDB reports `threadID`'s transaction waiting on a row lock; fails the test otherwise. */
  async function waitUntilSessionIsBlocked(threadID: number): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
    while (Date.now() < deadline) {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = ? AND trx_state = 'LOCK WAIT'",
        [threadID]
      );
      if (Number(rows[0].total) > 0) return;
      await new Promise(resolve => setTimeout(resolve, LOCK_WAIT_POLL_INTERVAL_MS));
    }
    throw new Error(`Session ${threadID} never waited on a lock within ${LOCK_WAIT_DEADLINE_MS} ms: the row it references was not locked by the clear.`);
  }

  async function countRows(sql: string, params: unknown[] = []): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(sql, params);
    return Number(rows[0]?.total ?? 0);
  }

  function seedSpeciesCode(): string {
    return testData.species[0].SpeciesCode ?? testData.species[0].Mnemonic!;
  }

  async function seedMeasurementsInCensus(censusID: number, count: number, tagPrefix: string): Promise<number[]> {
    const { coreMeasurementIDs } = await insertDirectMeasurements(
      connection,
      testData,
      censusID,
      Array.from({ length: count }, (_, index) => ({
        treeTag: `${tagPrefix}${index + 1}`,
        stemTag: 'S1',
        speciesCode: seedSpeciesCode(),
        quadratName: testData.quadrats[0].QuadratName,
        x: 1 + index,
        y: 2 + index,
        dbh: 100 + index,
        hom: 1.3,
        date: '2025-06-15'
      }))
    );
    return coreMeasurementIDs;
  }

  async function createLatestCensus(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COALESCE(MAX(PlotCensusNumber), 0) AS maxNumber FROM census WHERE PlotID = ?', [
      testData.plots[0].plotID
    ]);
    const census = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: Number(rows[0].maxNumber) + 1,
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    });
    // Not kept in testData.census, so the next cleanupTestMeasurements removes it if a test leaves it behind.
    testData.census = testData.census.filter(entry => entry.plotCensusNumber === 1);
    return census.censusID;
  }

  function clearCensusRequest(censusID: number, type: string): NextRequest {
    return new NextRequest('http://localhost/api/clearcensus', { method: 'POST', body: JSON.stringify({ schema: config.database, censusID, type }) });
  }

  function validationsRequest(method: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/validations/crud?schema=${config.database}`, { method, body: JSON.stringify(body) });
  }

  describe('POST /api/clearcensus', () => {
    it('msmts: deletes the census and records one summary row with its last state and the measurement count, as the session user', async () => {
      const censusID = await createLatestCensus();
      await seedMeasurementsInCensus(censusID, 3, 'CLR');

      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));
      expect(response.status, await response.clone().text()).toBe(HTTPResponses.OK);

      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(0);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?', [censusID])).toBe(0);

      const allAudits = await connection.query<RowDataPacket[]>('SELECT TableName, RecordID FROM unifiedchangelog').then(([rows]) => rows);
      expect(allAudits, 'one row for the whole clear, none per measurement').toEqual([{ TableName: 'census', RecordID: String(censusID) }]);
      const [summary] = await loadAuditRows('census');
      console.log('[clearcensus msmts] summary row:', JSON.stringify(summary));
      expect([summary.Operation, summary.NewRowState, summary.ChangedBy, summary.PlotID, summary.CensusID]).toEqual([
        'DELETE',
        null,
        AUTH_USER_EMAIL,
        testData.plots[0].plotID,
        censusID
      ]);
      expect(summary.OldRowState).toMatchObject({
        CensusID: censusID,
        PlotID: testData.plots[0].plotID,
        summaryKind: 'census-delete',
        clearType: 'msmts',
        deletedRowCounts: { coremeasurements: 3 }
      });
      expect(summary.OldRowState?.IsActive, 'BIT columns are recorded as 0/1, not a Buffer').toBe(1);

      const [[flagRow]] = await connection.query<RowDataPacket[]>('SELECT @clearcensus_caller_owns_transaction AS flag, @@foreign_key_checks AS fkChecks');
      expect(flagRow, 'the caller flag and foreign_key_checks must not leak onto the pooled connection').toEqual({ flag: null, fkChecks: 1 });
    });

    it('rolls back the summary row and every delete when the procedure fails mid-way in caller-owned mode', async () => {
      const censusID = await createLatestCensus();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'FAIL');
      await connection.query(
        `CREATE TRIGGER ${CENSUS_DELETE_BLOCKER_TRIGGER} BEFORE DELETE ON census FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${CENSUS_DELETE_BLOCKED_MESSAGE}'`
      );

      sharedState.loggedErrors.mockClear();
      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));
      await connection.query(`DROP TRIGGER IF EXISTS ${CENSUS_DELETE_BLOCKER_TRIGGER}`);

      const responseText = await response.text();
      expect(response.status, responseText).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      expect(JSON.parse(responseText), 'the procedure error must stay out of the response body (#574)').toEqual({ error: INTERNAL_SERVER_ERROR_MESSAGE });
      const loggedErrorMessages = sharedState.loggedErrors.mock.calls.flat().map(logged => (logged instanceof Error ? logged.message : String(logged)));
      expect(
        loggedErrorMessages.some(message => message.includes(CENSUS_DELETE_BLOCKED_MESSAGE)),
        `the 500 must come from the simulated census delete failure; logged: ${JSON.stringify(loggedErrorMessages)}`
      ).toBe(true);
      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(1);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [measurementIDs])).toBe(2);
      expect(await countRows('SELECT COUNT(*) AS total FROM unifiedchangelog')).toBe(0);
      const [[flagRow]] = await connection.query<RowDataPacket[]>('SELECT @clearcensus_caller_owns_transaction AS flag, @@foreign_key_checks AS fkChecks');
      expect(flagRow).toEqual({ flag: null, fkChecks: 1 });
    });

    it('leaves the census and its measurements untouched when its summary row cannot be written', async () => {
      const censusID = await createLatestCensus();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'NOAUD');
      sharedState.failAuditInserts = true;

      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));

      expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(1);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [measurementIDs])).toBe(2);
    });

    it('counts a measurement another session adds just before the delete, because the count comes from the delete itself', async () => {
      const censusID = await createLatestCensus();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'RACEINS');
      let latecomerID = 0;
      // An ordinary insert waits on the census row the clear holds (its FK check takes a shared
      // lock on the parent). Writers that run with foreign_key_checks = 0, as several procedures
      // do, are not held back, and the procedure deletes their rows too.
      sharedState.beforeProcedureCall = async () => {
        await concurrentSession.query('SET foreign_key_checks = 0');
        const [result] = await concurrentSession.query<mysql.ResultSetHeader>(
          'INSERT INTO coremeasurements (CensusID, MeasuredDBH, MeasurementDate) VALUES (?, 77, ?)',
          [censusID, '2025-06-16']
        );
        await concurrentSession.query('SET foreign_key_checks = 1');
        latecomerID = result.insertId;
      };

      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));

      expect(response.status, await response.clone().text()).toBe(HTTPResponses.OK);
      expect(latecomerID, 'the racing insert must have committed for this test to mean anything').toBeGreaterThan(0);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [[...measurementIDs, latecomerID]])).toBe(0);
      const [summary] = await loadAuditRows('census');
      expect(summary.OldRowState?.deletedRowCounts, JSON.stringify(summary)).toEqual({ coremeasurements: measurementIDs.length + 1 });
    });
  });

  describe('DELETE /api/admin/clear/failedmeasurements', () => {
    it('deletes every failed row of the census and audits each one in the ingestion-snapshot shape', async () => {
      const censusID = testData.census[0].censusID;
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [1, 2].map(index => ({
          treeTag: `ADMCLR${index}`,
          stemTag: 'S1',
          speciesCode: `NOSUCHSPECIES${index}`,
          quadratName: testData.quadrats[0].QuadratName,
          x: index,
          y: index,
          dbh: 50 + index,
          hom: 1.3,
          date: '2024-06-15'
        }))
      );
      expect((await runBulkIngestion(connection, fileID, batchID)).batch_failed).toBe(false);
      const failedIDs = (await getFailedMeasurements(connection, { fileID, batchID })).map(row => row.FailedMeasurementID);
      expect(failedIDs).toHaveLength(2);

      const plotID = testData.plots[0].plotID;
      const response = await adminClearDelete(
        new NextRequest(`http://localhost/api/admin/clear/failedmeasurements/${config.database}/${plotID}/${censusID}`, { method: 'DELETE' }),
        { params: Promise.resolve({ tableType: 'failedmeasurements', schema: config.database, plotID: String(plotID), censusID: String(censusID) }) }
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);
      expect(body.recordsCleared).toBe(2);

      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [failedIDs])).toBe(0);
      const audits = await loadAuditRows('coremeasurements');
      const dump = JSON.stringify(audits, null, 2);
      expect(audits.map(row => [Number(row.RecordID), row.Operation]).sort(), dump).toEqual(failedIDs.map(id => [id, 'DELETE']).sort());
      for (const audit of audits) {
        expect(audit.OldRowState, dump).toMatchObject({ StemGUID: null, UploadFileID: fileID, UploadBatchID: batchID });
        expect([audit.ChangedBy, audit.PlotID, audit.CensusID]).toEqual([AUTH_USER_EMAIL, plotID, censusID]);
      }
    });
  });

  describe('/api/validations/crud', () => {
    it('records the insert, update and delete of a site-specific validation with full row images, schema-wide', async () => {
      const created = await validationsPost(
        validationsRequest('POST', {
          validationID: FORGED_VALIDATION_ID,
          procedureName: 'audit_507_check',
          description: 'first',
          criteria: 'dbh',
          definition: 'SELECT 1',
          isEnabled: false
        })
      );
      const createdBody = await created.json();
      expect(created.status, JSON.stringify(createdBody)).toBe(HTTPResponses.OK);
      const validationID = Number(createdBody.validationID);
      expect(validationID, 'a client must not choose the primary key').not.toBe(FORGED_VALIDATION_ID);
      expect(await countRows('SELECT COUNT(*) AS total FROM sitespecificvalidations WHERE ValidationID = ?', [FORGED_VALIDATION_ID])).toBe(0);

      const updated = await validationsPatch(
        validationsRequest('PATCH', {
          validationID,
          procedureName: 'audit_507_check',
          description: 'second',
          criteria: 'dbh',
          definition: 'SELECT 1',
          isEnabled: true
        })
      );
      expect(updated.status, await updated.clone().text()).toBe(HTTPResponses.OK);
      const deleted = await validationsDelete(validationsRequest('DELETE', { validationID }));
      expect(deleted.status, await deleted.clone().text()).toBe(HTTPResponses.OK);

      const audits = await loadAuditRows('sitespecificvalidations');
      const dump = JSON.stringify(audits, null, 2);
      expect(
        audits.map(row => [row.RecordID, row.Operation]),
        dump
      ).toEqual([
        [String(validationID), 'INSERT'],
        [String(validationID), 'UPDATE'],
        [String(validationID), 'DELETE']
      ]);
      expect(audits[0].NewRowState, dump).toMatchObject({ ValidationID: validationID, Description: 'first' });
      expect(audits[1].OldRowState, dump).toMatchObject({ Description: 'first', IsEnabled: 0 });
      expect(audits[1].NewRowState, 'a BIT column is recorded as 0/1, not a Buffer object').toMatchObject({ Description: 'second', IsEnabled: 1 });
      expect(audits[2].OldRowState, dump).toMatchObject({ Description: 'second' });
      for (const audit of audits) {
        expect([audit.ChangedBy, audit.PlotID, audit.CensusID]).toEqual([AUTH_USER_EMAIL, null, null]);
      }
      expect(await countRows('SELECT COUNT(*) AS total FROM sitespecificvalidations WHERE ValidationID = ?', [validationID])).toBe(0);
    });

    it('does not keep a new validation whose audit row cannot be written', async () => {
      const before = await countRows("SELECT COUNT(*) AS total FROM sitespecificvalidations WHERE ProcedureName = 'audit_507_rollback'");
      sharedState.failAuditInserts = true;

      const response = await validationsPost(
        validationsRequest('POST', { procedureName: 'audit_507_rollback', description: 'x', criteria: 'dbh', definition: 'SELECT 1', isEnabled: false })
      );

      expect(response.status).toBe(HTTPResponses.CONFLICT);
      expect(await countRows("SELECT COUNT(*) AS total FROM sitespecificvalidations WHERE ProcedureName = 'audit_507_rollback'")).toBe(before);
    });

    it('returns 404 and writes nothing when the validation to delete does not exist', async () => {
      const response = await validationsDelete(validationsRequest('DELETE', { validationID: 987654 }));

      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
      expect(await loadAuditRows('sitespecificvalidations')).toEqual([]);
    });
  });

  describe('POST /api/clearcensus full on the last census (runs last: empties reference data)', () => {
    async function prepareLastCensusWithEveryReferenceTable(): Promise<number> {
      await connection.query('DELETE FROM census WHERE PlotID = ? AND PlotCensusNumber > 1', [testData.plots[0].plotID]);
      const censusID = testData.census.find(entry => entry.plotCensusNumber === 1)!.censusID;
      const [referenceRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM reference');
      if (Number(referenceRows[0].total) === 0) {
        const [reference] = await connection.query<mysql.ResultSetHeader>("INSERT INTO reference (PublicationTitle) VALUES ('Audit 507 flora')");
        const [family] = await connection.query<mysql.ResultSetHeader>("INSERT INTO family (Family, ReferenceID) VALUES ('Auditaceae', ?)", [
          reference.insertId
        ]);
        await connection.query("INSERT INTO genus (FamilyID, Genus, ReferenceID) VALUES (?, 'Auditus', ?)", [family.insertId, reference.insertId]);
        const [role] = await connection.query<mysql.ResultSetHeader>("INSERT INTO roles (RoleName) VALUES ('Audit 507 role')");
        await connection.query("INSERT INTO personnel (FirstName, LastName, RoleID) VALUES ('Ada', 'Auditor', ?)", [role.insertId]);
        const [[species]] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
        await connection.query("INSERT INTO specieslimits (SpeciesID, PlotID, CensusID, LimitType, UpperBound, LowerBound) VALUES (?, ?, ?, 'DBH', 500, 1)", [
          species.SpeciesID,
          testData.plots[0].plotID,
          censusID
        ]);
        await connection.query("INSERT INTO attributes (Code, Description, IsActive) VALUES ('AUD7', 'active', 1), ('AUD7', 'retired', 0)");
      }
      for (const table of FULL_CLEAR_REFERENCE_TABLES) {
        expect(await countRows(`SELECT COUNT(*) AS total FROM ${table}`), `${table} must hold a row for this test to mean anything`).toBeGreaterThan(0);
      }
      expect(await countRows('SELECT COUNT(*) AS total FROM census')).toBe(1);
      return censusID;
    }

    it('rolls back the census, its measurements and every reference table when the summary row fails after the CALL', async () => {
      const censusID = await prepareLastCensusWithEveryReferenceTable();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 1, 'FULLRB');
      const countsBefore = new Map<string, number>();
      for (const table of FULL_CLEAR_REFERENCE_TABLES) countsBefore.set(table, await countRows(`SELECT COUNT(*) AS total FROM ${table}`));
      let procedureRan = false;
      sharedState.beforeProcedureCall = async () => {
        procedureRan = true;
      };
      sharedState.failAuditInsertWhen = params => params?.[0] === 'census';

      const response = await clearCensusPost(clearCensusRequest(censusID, 'full'));

      expect(procedureRan, 'the summary fails after the procedure deleted everything').toBe(true);
      expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      for (const table of FULL_CLEAR_REFERENCE_TABLES) {
        expect(await countRows(`SELECT COUNT(*) AS total FROM ${table}`), `${table} must be restored`).toBe(countsBefore.get(table));
      }
      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(1);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [measurementIDs])).toBe(1);
      expect(await countRows('SELECT COUNT(*) AS total FROM unifiedchangelog')).toBe(0);
    });

    it('refuses with 409 and deletes nothing when a fixed-data row is added after the lock', async () => {
      const censusID = await prepareLastCensusWithEveryReferenceTable();
      sharedState.beforeProcedureCall = async () => {
        await concurrentSession.query("INSERT INTO attributes (Code, Description, IsActive) VALUES ('LATE7', 'added mid-clear', 1)");
      };

      const response = await clearCensusPost(clearCensusRequest(censusID, 'full'));
      await connection.query("DELETE FROM attributes WHERE Code = 'LATE7'");

      expect(response.status, await response.clone().text()).toBe(HTTPResponses.CONFLICT);
      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(1);
      for (const table of FULL_CLEAR_REFERENCE_TABLES) {
        expect(await countRows(`SELECT COUNT(*) AS total FROM ${table}`), `${table} must be untouched`).toBeGreaterThan(0);
      }
      expect(await countRows('SELECT COUNT(*) AS total FROM unifiedchangelog')).toBe(0);
    });

    // One test, because a committed full clear empties the census and every fixed-data table for the rest of the file.
    it('records one summary row with every count it emptied, and holds a species insert naming an existing genus until it fails', async () => {
      const censusID = await prepareLastCensusWithEveryReferenceTable();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'FULL');
      const expectedCounts: Record<string, number> = { coremeasurements: measurementIDs.length };
      for (const table of FULL_CLEAR_REFERENCE_TABLES) expectedCounts[table] = await countRows(`SELECT COUNT(*) AS total FROM ${table}`);
      const [[{ GenusID: genusID }]] = await connection.query<RowDataPacket[]>('SELECT GenusID FROM genus LIMIT 1');
      // The procedure deletes species before genus with foreign_key_checks off. Without the genus row
      // locked, this insert could land between those deletes and leave a species without its genus.
      let concurrentInsert: Promise<unknown> | undefined;
      sharedState.beforeProcedureCall = async () => {
        concurrentInsert = concurrentSession
          .query("INSERT INTO species (GenusID, SpeciesCode, SpeciesName) VALUES (?, 'LATESP', 'added mid-clear')", [genusID])
          .then(
            () => 'inserted',
            (error: { code?: string }) => error.code
          );
        await waitUntilSessionIsBlocked(concurrentSession.threadId);
      };

      const response = await clearCensusPost(clearCensusRequest(censusID, 'full'));
      expect(response.status, await response.clone().text()).toBe(HTTPResponses.OK);

      const insertOutcome = await concurrentInsert;
      console.log(`[full clear] concurrent species insert outcome: ${String(insertOutcome)}`);
      // InnoDB either lets the insert finish waiting and fail its foreign-key check, or picks it as the victim of a
      // deadlock with the clear's species DELETE. Both refuse it; what must never happen is a committed species.
      expect([MYSQL_NO_REFERENCED_ROW, MYSQL_LOCK_DEADLOCK], 'the insert waited on the locked genus and was refused').toContain(insertOutcome);
      for (const table of FULL_CLEAR_REFERENCE_TABLES) {
        expect(await countRows(`SELECT COUNT(*) AS total FROM ${table}`), `${table} should be empty`).toBe(0);
      }
      const [allAudits] = await connection.query<RowDataPacket[]>('SELECT TableName, RecordID FROM unifiedchangelog');
      expect(allAudits, 'one row for the whole clear, none per deleted row').toEqual([{ TableName: 'census', RecordID: String(censusID) }]);
      const [summary] = await loadAuditRows('census');
      console.log('[clearcensus full] summary row:', JSON.stringify(summary));
      expect(summary.OldRowState).toMatchObject({ CensusID: censusID, summaryKind: 'census-delete', clearType: 'full' });
      expect(summary.OldRowState?.deletedRowCounts).toEqual(expectedCounts);
      expect([summary.ChangedBy, summary.PlotID, summary.CensusID]).toEqual([AUTH_USER_EMAIL, testData.plots[0].plotID, censusID]);
    });
  });
});
