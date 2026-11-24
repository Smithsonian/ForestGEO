/**
 * Recent Changes audit for the admin mutation routes #507 left uncovered, proven against real MySQL:
 *
 *   - POST /api/clearcensus runs the REAL clearcensusmsmts / clearcensusfull procedures (loaded from
 *     db/sql/storedprocedures.sql by local-db-setup) in caller-owned mode, so its audit rows and the
 *     deletes they describe commit or roll back together — including when the procedure itself fails.
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
import type { Connection, RowDataPacket } from 'mysql2/promise';
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

const AUTH_USER_EMAIL = 'admin-audit-runner@forestgeo.test';
const SIMULATED_AUDIT_FAILURE = 'SIMULATED_AUDIT_WRITE_FAILURE_507';
const CENSUS_DELETE_BLOCKED_MESSAGE = 'SIMULATED_CENSUS_DELETE_FAILURE_507';
const CENSUS_DELETE_BLOCKER_TRIGGER = 'test_507_block_census_delete';
const FULL_CLEAR_REFERENCE_TABLES = ['attributes', 'personnel', 'roles', 'quadrats', 'species', 'specieslimits', 'genus', 'family', 'reference'] as const;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  failAuditInserts: false
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: async () => ({ success: false })
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const TRANSACTION_ID = 'admin-audit-tx';

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
      if (sharedState.failAuditInserts && /^\s*INSERT INTO\s+\S*unifiedchangelog/i.test(sql)) {
        throw new Error(SIMULATED_AUDIT_FAILURE);
      }
      const [rows] = await requireConnection().query(sql, params as any[]);
      return rows;
    },
    discardTransaction: (transactionID: string, reason: string) => {
      throw new Error(`discardTransaction must not run in this suite (transaction ${transactionID}: ${reason})`);
    },
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true,
    beginTransaction: async () => {
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
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.failAuditInserts = false;
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
    it('msmts: deletes the census and audits it and each of its measurements in the ingestion-snapshot shape, as the session user', async () => {
      const censusID = await createLatestCensus();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 3, 'CLR');
      const [measurementsBefore] = await connection.query<RowDataPacket[]>(
        'SELECT CoreMeasurementID, MeasuredDBH, RawTreeTag FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID',
        [censusID]
      );

      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));
      expect(response.status, await response.clone().text()).toBe(HTTPResponses.OK);

      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(0);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?', [censusID])).toBe(0);

      const measurementAudits = await loadAuditRows('coremeasurements');
      const dump = JSON.stringify(measurementAudits, null, 2);
      expect(measurementAudits.map(row => [Number(row.RecordID), row.Operation]).sort(), dump).toEqual(measurementIDs.map(id => [id, 'DELETE']).sort());
      for (const audit of measurementAudits) {
        const before = measurementsBefore.find(row => row.CoreMeasurementID === Number(audit.RecordID))!;
        expect(audit.NewRowState, dump).toBeNull();
        expect(Number(audit.OldRowState?.MeasuredDBH), dump).toBe(Number(before.MeasuredDBH));
        expect(audit.OldRowState?.RawTreeTag, dump).toBe(before.RawTreeTag);
        expect(audit.OldRowState, 'the #592 export rolls up only ingestion-snapshot rows').toHaveProperty('UploadBatchID');
        expect(audit.OldRowState).not.toHaveProperty('UserDefinedFields');
        expect([audit.ChangedBy, audit.PlotID, audit.CensusID]).toEqual([AUTH_USER_EMAIL, testData.plots[0].plotID, censusID]);
      }

      const censusAudits = await loadAuditRows('census');
      expect(
        censusAudits.map(row => [row.RecordID, row.Operation, row.ChangedBy]),
        JSON.stringify(censusAudits)
      ).toEqual([[String(censusID), 'DELETE', AUTH_USER_EMAIL]]);
      expect(censusAudits[0].OldRowState).toMatchObject({ CensusID: censusID, PlotID: testData.plots[0].plotID });
      expect(await loadAuditRows('species'), 'msmts leaves reference data alone').toEqual([]);

      const [[flagRow]] = await connection.query<RowDataPacket[]>('SELECT @clearcensus_caller_owns_transaction AS flag, @@foreign_key_checks AS fkChecks');
      expect(flagRow, 'the caller flag and foreign_key_checks must not leak onto the pooled connection').toEqual({ flag: null, fkChecks: 1 });
    });

    it('rolls back the audit rows and every delete when the procedure fails mid-way in caller-owned mode', async () => {
      const censusID = await createLatestCensus();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'FAIL');
      await connection.query(
        `CREATE TRIGGER ${CENSUS_DELETE_BLOCKER_TRIGGER} BEFORE DELETE ON census FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${CENSUS_DELETE_BLOCKED_MESSAGE}'`
      );

      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));
      await connection.query(`DROP TRIGGER IF EXISTS ${CENSUS_DELETE_BLOCKER_TRIGGER}`);

      expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      expect(await response.text()).toContain(CENSUS_DELETE_BLOCKED_MESSAGE);
      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(1);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [measurementIDs])).toBe(2);
      expect(await countRows("SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName IN ('census', 'coremeasurements')")).toBe(0);
      const [[flagRow]] = await connection.query<RowDataPacket[]>('SELECT @clearcensus_caller_owns_transaction AS flag, @@foreign_key_checks AS fkChecks');
      expect(flagRow).toEqual({ flag: null, fkChecks: 1 });
    });

    it('leaves the census and its measurements untouched when its audit rows cannot be written', async () => {
      const censusID = await createLatestCensus();
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'NOAUD');
      sharedState.failAuditInserts = true;

      const response = await clearCensusPost(clearCensusRequest(censusID, 'msmts'));

      expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      expect(await countRows('SELECT COUNT(*) AS total FROM census WHERE CensusID = ?', [censusID])).toBe(1);
      expect(await countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [measurementIDs])).toBe(2);
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
        validationsRequest('POST', { procedureName: 'audit_507_check', description: 'first', criteria: 'dbh', definition: 'SELECT 1', isEnabled: false })
      );
      const createdBody = await created.json();
      expect(created.status, JSON.stringify(createdBody)).toBe(HTTPResponses.OK);
      const validationID = Number(createdBody.validationID);

      const updated = await validationsPatch(
        validationsRequest('PATCH', {
          validationID,
          procedureName: 'audit_507_check',
          description: 'second',
          criteria: 'dbh',
          definition: 'SELECT 1',
          isEnabled: false
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
      expect(audits[1].OldRowState, dump).toMatchObject({ Description: 'first' });
      expect(audits[1].NewRowState, dump).toMatchObject({ Description: 'second' });
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
    it('audits every reference row the procedure removes, schema-wide, alongside the census and its measurements', async () => {
      await connection.query('DELETE FROM census WHERE PlotID = ? AND PlotCensusNumber > 1', [testData.plots[0].plotID]);
      const censusID = testData.census.find(entry => entry.plotCensusNumber === 1)!.censusID;
      const measurementIDs = await seedMeasurementsInCensus(censusID, 2, 'FULL');
      const referenceCountsBefore = new Map<string, number>();
      for (const table of FULL_CLEAR_REFERENCE_TABLES) {
        referenceCountsBefore.set(table, await countRows(`SELECT COUNT(*) AS total FROM ${table}`));
      }
      expect(await countRows('SELECT COUNT(*) AS total FROM census')).toBe(1);
      expect(referenceCountsBefore.get('species'), 'the seed must hold reference rows for this test to mean anything').toBeGreaterThan(0);

      const response = await clearCensusPost(clearCensusRequest(censusID, 'full'));
      expect(response.status, await response.clone().text()).toBe(HTTPResponses.OK);

      for (const table of FULL_CLEAR_REFERENCE_TABLES) {
        expect(await countRows(`SELECT COUNT(*) AS total FROM ${table}`), `${table} should be empty`).toBe(0);
        const audits = await loadAuditRows(table);
        const dump = JSON.stringify(audits.slice(0, 3), null, 2);
        expect(audits, `${table}: one DELETE per removed row\n${dump}`).toHaveLength(referenceCountsBefore.get(table)!);
        for (const audit of audits) {
          expect([audit.Operation, audit.ChangedBy, audit.PlotID, audit.CensusID, audit.NewRowState], dump).toEqual([
            'DELETE',
            AUTH_USER_EMAIL,
            null,
            null,
            null
          ]);
          expect(audit.OldRowState, dump).not.toBeNull();
        }
      }
      const speciesAudit = (await loadAuditRows('species'))[0];
      expect(speciesAudit.RecordID).toBe(String(speciesAudit.OldRowState?.SpeciesID));
      const attributeAudits = await loadAuditRows('attributes');
      for (const audit of attributeAudits) expect(audit.RecordID).toBe(audit.OldRowState?.Code);

      expect((await loadAuditRows('coremeasurements')).map(row => Number(row.RecordID)).sort()).toEqual([...measurementIDs].sort());
      expect((await loadAuditRows('census')).map(row => row.RecordID)).toEqual([String(censusID)]);
    });
  });
});
