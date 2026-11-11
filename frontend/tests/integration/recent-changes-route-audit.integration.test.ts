/**
 * Recent Changes audit atomicity for POST /api/bulkcrud (issue #507), proven against real MySQL.
 *
 * bulkcrud's measurementssummary branch stages rows into temporarymeasurements, runs
 * bulkingestionprocess inside its OWN transaction (the #527 caller-owns-transaction
 * pattern), and then — in the SAME transaction, before commit — calls
 * recordCommittedCoreMeasurementsAudit to write one `unifiedchangelog` row per
 * coremeasurements row the CALL just produced. This suite proves, against a real
 * local database rather than mocked SQL:
 *
 *   1. ChangedBy on every audit row is the AUTHENTICATED SESSION identity
 *      (authenticatedSessionIdentity(session.user)) — bulkcrud accepts no client
 *      `user` field in its body, so a caller cannot forge one; this is the
 *      bulkcrud half of #507's "never trust a client-supplied identity" contract
 *      (the sqlpacketload half is covered by app/api/sqlpacketload/route.test.ts).
 *   2. A write failure in the audit INSERT rolls back the WHOLE transaction —
 *      including the trees/stems/coremeasurements rows bulkingestionprocess already
 *      committed via its own savepoint under the caller-owns-transaction flag. There
 *      is no window where ingested data exists without its audit trail, or vice versa.
 *
 * ConnectionManager is mocked to proxy every call onto one real mysql2 connection
 * (begin/commit/rollback are the real InnoDB transaction), with a single
 * test-controlled failure hook on the audit INSERT itself — the same proxy-to-real-DB
 * pattern as reingest-routes.integration.test.ts. Only @/auth and @/ailogger are
 * mocked beyond that: auth() so the route's session gate passes without a live
 * NextAuth session, ailogger so error logging does not spam test output.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';

const AUTH_USER_EMAIL = 'recent-changes-audit-runner@forestgeo.test';
const BULK_CRUD_FILE_ID = 'sample_bulk_insert.csv';
const AUDIT_FAILURE_MESSAGE = 'SIMULATED_AUDIT_WRITE_FAILURE_507';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  /** Set by a test to make the recordCommittedCoreMeasurementsAudit INSERT fail. */
  auditInsertFailureError: null as Error | null,
  /** Set by a test to make a per-row recordMutation INSERT (sqlpacketload fixed-data path) fail. */
  perRowAuditFailureError: null as Error | null,
  /** When set, perRowAuditFailureError only fires for this specific RecordID (code), so an
   *  earlier row in the same request can commit before the targeted row's audit write fails. */
  perRowAuditFailureRecordID: null as string | null,
  /** Set by a test to make sqlpacketload's own file_upload summary changelog INSERT fail. */
  fileUploadAuditFailureError: null as Error | null,
  batchCounter: 0,
  /** The exact batchID the route used for its generateShortBatchID() call this test. */
  lastBatchID: null as string | null
}));

// Grants a 'global' role so the route's auth() gate and assertSchemaAccess pass
// without a live session. Mocking @/auth also keeps the real next-auth module
// (whose lib/env.js imports the extensionless `next/server` subpath) from being
// loaded by Node's native ESM resolver, which cannot resolve it.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// Deterministic batchID so the audit assertions below can scope their SELECTs to
// exactly this test's rows without parsing the generated ID out of the response.
vi.mock('@/config/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/utils')>();
  return {
    ...actual,
    generateShortBatchID: () => {
      sharedState.batchCounter += 1;
      const batchID = `507-audit-batch-${sharedState.batchCounter}`;
      sharedState.lastBatchID = batchID;
      return batchID;
    }
  };
});

vi.mock('@/lib/db/connectionmanager', () => {
  const TRANSACTION_ID = 'recent-changes-audit-tx';

  // Production routes a query with no (or another) transaction ID to a different pooled
  // connection, outside the route's transaction. This stub shares one connection, so it
  // must reject such a query instead of silently running it inside the transaction.
  function assertBoundToActiveTransaction(sql: string, transactionID: string | undefined): void {
    const active = sharedState.activeTransactionID ?? undefined;
    if (active !== transactionID) {
      throw new Error(
        `executeQuery transaction mismatch: active=${active ?? 'none'} received=${transactionID ?? 'none'} for: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`
      );
    }
  }

  // Identifies ONLY recordCommittedCoreMeasurementsAudit's INSERT (lib/changelog/ingestion-audit.ts):
  // `INSERT INTO ??.unifiedchangelog ... FROM ??.coremeasurements cm`. Nothing else bulkcrud's
  // measurementssummary branch runs matches both the table and the aliased source table.
  function isCoreMeasurementsAuditInsert(sql: string): boolean {
    return sql.trimStart().toUpperCase().startsWith('INSERT') && sql.includes('unifiedchangelog') && sql.includes('coremeasurements cm');
  }

  // Identifies ONLY recordMutation's per-row changelog INSERT (lib/changelog/record-mutation.ts)
  // for the sqlpacketload fixed-data (attributes) path: params[0] is always the mutated
  // tableName, never any other value a different write on this connection would pass first.
  function isPerRowAuditInsert(sql: string, params: unknown[] | undefined): boolean {
    return sql.trimStart().toUpperCase().startsWith('INSERT') && sql.includes('unifiedchangelog') && params?.[0] === 'attributes';
  }

  // Identifies ONLY sqlpacketload's own file_upload summary changelog INSERT
  // (app/api/sqlpacketload/route.ts): params[0] is the literal string 'file_upload'.
  function isFileUploadSummaryAuditInsert(sql: string, params: unknown[] | undefined): boolean {
    return sql.trimStart().toUpperCase().startsWith('INSERT') && sql.includes('unifiedchangelog') && params?.[0] === 'file_upload';
  }

  const manager = {
    executeQuery: async (sql: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      assertBoundToActiveTransaction(sql, transactionID);

      if (sharedState.auditInsertFailureError && isCoreMeasurementsAuditInsert(sql)) {
        throw sharedState.auditInsertFailureError;
      }
      if (
        sharedState.perRowAuditFailureError &&
        isPerRowAuditInsert(sql, params) &&
        (sharedState.perRowAuditFailureRecordID === null || params?.[1] === sharedState.perRowAuditFailureRecordID)
      ) {
        throw sharedState.perRowAuditFailureError;
      }
      if (sharedState.fileUploadAuditFailureError && isFileUploadSummaryAuditInsert(sql, params)) {
        throw sharedState.fileUploadAuditFailureError;
      }

      const [rows] = await sharedState.connection.query(sql, params as any[]);
      return rows;
    },
    discardTransaction: (transactionID: string, reason: string) => {
      throw new Error(`discardTransaction must not run in this suite (transaction ${transactionID}: ${reason})`);
    },
    closeConnection: async () => undefined,
    beginTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TRANSACTION_ID;
      return TRANSACTION_ID;
    },
    commitTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    }
  };

  return {
    default: {
      getInstance: () => manager
    }
  };
});

// sqlpacketload's fixed-data branch calls requireUploadSessionOwnership before writing;
// upload-session ownership itself is covered by app/api/sqlpacketload/route.test.ts, so it is
// stubbed here to isolate exactly what this suite tests: audit atomicity against real MySQL.
vi.mock('@/config/uploadsessiontracker', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/uploadsessiontracker')>()),
  requireUploadSessionOwnership: vi.fn(async () => undefined)
}));

// Imported AFTER the mocks above so the route picks up the mocked ConnectionManager/auth/utils.
import { POST } from '@/app/api/bulkcrud/route';
import { POST as sqlPacketLoadPOST } from '@/app/api/sqlpacketload/route';

describe('Recent Changes audit atomicity (#507): POST /api/bulkcrud measurementssummary', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90_000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.auditInsertFailureError = null;
    sharedState.lastBatchID = null;
    await cleanupTestMeasurements(connection, testData);
    vi.clearAllMocks();
  });

  function buildRequest(treeTag: string) {
    return new Request('http://localhost/api/bulkcrud', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gridType: 'measurementssummary',
        schema: config.database,
        plot: { plotID: testData.plots[0].plotID },
        census: { dateRanges: [{ censusID: testData.census[0].censusID }] },
        // bulkcrud reads no `user` field from the body at all (#507) — included here only
        // to prove a forged identity field is inert even if a future change starts parsing it.
        user: 'Forged Attacker Identity',
        fileRowSet: {
          'row-1': {
            tag: treeTag,
            stemtag: 'S1',
            spcode: testData.species[0].SpeciesCode,
            quadrat: testData.quadrats[0].QuadratName,
            lx: 5,
            ly: 5,
            dbh: 12.5,
            hom: 1.3,
            date: '2024-06-15',
            codes: '',
            description: ''
          }
        }
      })
    }) as any;
  }

  async function committedCoreMeasurementRows(batchID: string): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID, UploadFileID, UploadBatchID, CensusID FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ?`,
      [BULK_CRUD_FILE_ID, batchID]
    );
    return rows;
  }

  async function auditRowsFor(coreMeasurementIDs: number[]): Promise<RowDataPacket[]> {
    if (coreMeasurementIDs.length === 0) return [];
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, ChangedBy, PlotID, CensusID, NewRowState FROM unifiedchangelog
       WHERE TableName = 'coremeasurements' AND RecordID IN (${coreMeasurementIDs.map(() => '?').join(',')})`,
      coreMeasurementIDs
    );
    return rows;
  }

  async function treeExists(treeTag: string): Promise<boolean> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM trees WHERE TreeTag = ?`, [treeTag]);
    return Number(rows[0].total) > 0;
  }

  it('commits coremeasurements and their unifiedchangelog audit rows together, with ChangedBy set to the authenticated session identity', async () => {
    const treeTag = 'RC507_OK';

    const res = await POST(buildRequest(treeTag) as any);
    const body = await res.json();

    expect(res.status, `response body: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    expect(sharedState.lastBatchID, 'the route must have generated a batchID').not.toBeNull();

    const cmRows = await committedCoreMeasurementRows(sharedState.lastBatchID!);
    expect(cmRows, 'bulkingestionprocess must have committed exactly one coremeasurements row').toHaveLength(1);
    expect(cmRows[0].StemGUID, 'the row must be a successful (non-parked) ingest').not.toBeNull();

    const auditRows = await auditRowsFor(cmRows.map(row => Number(row.CoreMeasurementID)));
    expect(auditRows, 'exactly one audit row per committed coremeasurements row').toHaveLength(1);
    expect(auditRows[0].ChangedBy, 'ChangedBy must be the authenticated session identity, never the forged body.user').toBe(AUTH_USER_EMAIL);
    expect(auditRows[0].ChangedBy).not.toBe('Forged Attacker Identity');
    expect(auditRows[0].PlotID).toBe(testData.plots[0].plotID);
    expect(auditRows[0].CensusID).toBe(testData.census[0].censusID);

    const newRowState = typeof auditRows[0].NewRowState === 'string' ? JSON.parse(auditRows[0].NewRowState) : auditRows[0].NewRowState;
    expect(newRowState.UploadBatchID).toBe(sharedState.lastBatchID);
    expect(newRowState.UploadFileID).toBe(BULK_CRUD_FILE_ID);

    expect(await treeExists(treeTag)).toBe(true);
  });

  it('rolls back the ENTIRE transaction — including coremeasurements/stems/trees bulkingestionprocess already committed via savepoint — when the audit write fails', async () => {
    const treeTag = 'RC507_AUDIT_FAIL';
    sharedState.auditInsertFailureError = new Error(AUDIT_FAILURE_MESSAGE);

    const res = await POST(buildRequest(treeTag) as any);
    const body = await res.json();

    expect(res.status, `response body: ${JSON.stringify(body)}`).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(body.error).toContain(AUDIT_FAILURE_MESSAGE);
    expect(sharedState.lastBatchID, 'the route must still have generated a batchID before failing').not.toBeNull();

    // The connection must be usable afterward: ROLLBACK, not an abandoned transaction.
    expect(sharedState.activeTransactionID, 'rollbackTransaction must have cleared the active transaction').toBeNull();

    expect(
      await committedCoreMeasurementRows(sharedState.lastBatchID!),
      'the coremeasurements rows the procedure committed via savepoint must be gone after the caller ROLLBACK'
    ).toHaveLength(0);
    expect(await treeExists(treeTag), 'the tree bulkingestionprocess created must not survive the rollback').toBe(false);

    const [changelogCount] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND JSON_EXTRACT(NewRowState, '$.UploadBatchID') = ?`,
      [sharedState.lastBatchID]
    );
    expect(Number(changelogCount[0].total), 'no audit row may survive for a batch whose data was rolled back').toBe(0);
  });
});

/**
 * Recent Changes audit atomicity for POST /api/sqlpacketload (issue #507), proven against real MySQL.
 *
 * sqlpacketload's fixed-data `attributes` branch calls upsertAttributeRows
 * (lib/uploads/reference-data-writers.ts), which writes each row AND its `unifiedchangelog`
 * audit row (via recordMutation) in the SAME transaction, then the route writes its own
 * `file_upload` summary changelog row before commit — all three kinds of write share one
 * transaction. This suite proves, against a real local database rather than mocked SQL:
 *
 *   1. ChangedBy on every audit row is the AUTHENTICATED SESSION identity, never the
 *      client-supplied `body.user` a caller could forge (#507's generic-path regression,
 *      proven end-to-end here instead of against a mocked insertOrUpdate).
 *   2. A per-row changelog write failure (recordMutation inside upsertAttributeRows) rolls
 *      back that row's own data write AND every other row already written in the same
 *      request — no row may commit without its audit, and no audit may survive without its row.
 *   3. A failure in the route's own file_upload SUMMARY changelog write — issued only after
 *      every row committed successfully — still rolls the whole request back, including the
 *      rows that already succeeded individually.
 *
 * Uses the same proxy-to-real-DB ConnectionManager mock as the bulkcrud suite above, plus a
 * stub for requireUploadSessionOwnership (covered separately by
 * app/api/sqlpacketload/route.test.ts) so this suite isolates audit atomicity specifically.
 */
describe('Recent Changes audit atomicity (#507): POST /api/sqlpacketload fixed-data (attributes)', () => {
  const SQLPACKETLOAD_FILE_NAME = 'rc507-attributes.csv';
  const SQLPACKETLOAD_UPLOAD_SESSION_ID = 'recent-changes-audit-sqlpacketload-session';
  const PER_ROW_AUDIT_FAILURE_MESSAGE = 'SIMULATED_PER_ROW_ATTRIBUTE_AUDIT_FAILURE_507';
  const FILE_SUMMARY_AUDIT_FAILURE_MESSAGE = 'SIMULATED_FILE_SUMMARY_AUDIT_FAILURE_507';

  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90_000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.perRowAuditFailureError = null;
    sharedState.perRowAuditFailureRecordID = null;
    sharedState.fileUploadAuditFailureError = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // These tests write only `attributes` rows (never present in the seed set below RC507ATTR)
    // and their changelog trail; clean both so codes are reusable across tests without collision.
    await connection.query(`DELETE FROM attributes WHERE Code LIKE 'RC507ATTR%'`);
    await connection.query(
      `DELETE FROM unifiedchangelog WHERE (TableName = 'attributes' AND RecordID LIKE 'RC507ATTR%') OR (TableName = 'file_upload' AND RecordID = ?)`,
      [SQLPACKETLOAD_FILE_NAME]
    );
  });

  function buildAttributesRequest(rows: Record<string, { code: string; description: string; status: string }>) {
    return new Request('http://localhost/api/sqlpacketload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-upload-session-id': SQLPACKETLOAD_UPLOAD_SESSION_ID },
      body: JSON.stringify({
        schema: config.database,
        formType: 'attributes',
        fileName: SQLPACKETLOAD_FILE_NAME,
        uploadMode: 'revisions',
        plot: { plotID: testData.plots[0].plotID },
        census: { dateRanges: [{ censusID: testData.census[0].censusID }] },
        // sqlpacketload's fixed-data branch reads no identity field from the body (#507) — included
        // here only to prove a forged identity field is inert even if a future change starts parsing it.
        user: 'Forged Attacker Identity',
        fileRowSet: rows
      })
    }) as any;
  }

  async function attributeRow(code: string): Promise<RowDataPacket | undefined> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT Code, Description, Status, IsActive FROM attributes WHERE Code = ?`, [code]);
    return rows[0];
  }

  async function attributeAuditRows(code: string): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, Operation, ChangedBy, NewRowState FROM unifiedchangelog WHERE TableName = 'attributes' AND RecordID = ?`,
      [code]
    );
    return rows;
  }

  async function fileUploadAuditRows(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, ChangedBy, NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload' AND RecordID = ?`,
      [SQLPACKETLOAD_FILE_NAME]
    );
    return rows;
  }

  it('commits each attribute row with its per-row audit row and the file_upload summary row, ChangedBy set to the authenticated session identity', async () => {
    const code = 'RC507ATTR1';

    const res = await sqlPacketLoadPOST(buildAttributesRequest({ 'row-1': { code, description: 'Recent Changes audit OK', status: 'alive' } }) as any);
    const body = await res.json();

    expect(res.status, `response body: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);

    const row = await attributeRow(code);
    expect(row, 'the attribute row must have been written').toBeDefined();

    const auditRows = await attributeAuditRows(code);
    expect(auditRows, 'exactly one per-row audit row for a single new attribute').toHaveLength(1);
    expect(auditRows[0].Operation).toBe('INSERT');
    expect(auditRows[0].ChangedBy, 'ChangedBy must be the authenticated session identity, never the forged body.user').toBe(AUTH_USER_EMAIL);
    expect(auditRows[0].ChangedBy).not.toBe('Forged Attacker Identity');

    const summaryRows = await fileUploadAuditRows();
    expect(summaryRows, 'the file_upload summary changelog row must have been written').toHaveLength(1);
    expect(summaryRows[0].ChangedBy).toBe(AUTH_USER_EMAIL);
    expect(summaryRows[0].ChangedBy).not.toBe('Forged Attacker Identity');
  });

  it("rolls back an earlier, individually-successful row in the same request when a LATER row's per-row changelog audit write fails", async () => {
    const okCode = 'RC507ATTR2';
    const failingCode = 'RC507ATTR3';
    // Row 1 (okCode) writes AND audits successfully; only row 2's (failingCode) audit write fails
    // -- proving the first row's individually-successful commit does not escape the rollback.
    sharedState.perRowAuditFailureError = new Error(PER_ROW_AUDIT_FAILURE_MESSAGE);
    sharedState.perRowAuditFailureRecordID = failingCode;

    const res = await sqlPacketLoadPOST(
      buildAttributesRequest({
        'row-1': { code: okCode, description: 'Writes and audits successfully on its own', status: 'alive' },
        'row-2': { code: failingCode, description: 'Audit write fails for this row', status: 'alive' }
      }) as any
    );
    const body = await res.json();

    expect(res.status, `response body: ${JSON.stringify(body)}`).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(body.error).toContain(PER_ROW_AUDIT_FAILURE_MESSAGE);

    // The connection must be usable afterward: ROLLBACK, not an abandoned transaction.
    expect(sharedState.activeTransactionID, 'rollbackTransaction must have cleared the active transaction').toBeNull();

    expect(await attributeRow(okCode), "row 1 committed its write+audit individually but must not survive row 2's failure").toBeUndefined();
    expect(await attributeRow(failingCode)).toBeUndefined();
    expect(await attributeAuditRows(okCode)).toHaveLength(0);
    expect(await attributeAuditRows(failingCode)).toHaveLength(0);
    expect(await fileUploadAuditRows(), 'the file_upload summary must never be written for a request that never reached commit').toHaveLength(0);
  });

  it('rolls back every already-committed row and its audit trail when the file_upload summary changelog write fails', async () => {
    const firstCode = 'RC507ATTR4';
    const secondCode = 'RC507ATTR5';
    sharedState.fileUploadAuditFailureError = new Error(FILE_SUMMARY_AUDIT_FAILURE_MESSAGE);

    const res = await sqlPacketLoadPOST(
      buildAttributesRequest({
        'row-1': { code: firstCode, description: 'Row succeeds individually', status: 'alive' },
        'row-2': { code: secondCode, description: 'Row succeeds individually too', status: 'alive' }
      }) as any
    );
    const body = await res.json();

    expect(res.status, `response body: ${JSON.stringify(body)}`).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(body.error).toContain(FILE_SUMMARY_AUDIT_FAILURE_MESSAGE);
    expect(sharedState.activeTransactionID, 'rollbackTransaction must have cleared the active transaction').toBeNull();

    // Both rows wrote successfully (and were individually auditable) before the summary write
    // failed; proving THOSE are gone too is the point — a row-level commit is not durable until
    // the whole request's transaction commits.
    expect(await attributeRow(firstCode), 'a row that individually succeeded must not survive the file_upload summary rollback').toBeUndefined();
    expect(await attributeRow(secondCode)).toBeUndefined();
    expect(await attributeAuditRows(firstCode), "that row's own per-row audit must not survive either").toHaveLength(0);
    expect(await attributeAuditRows(secondCode)).toHaveLength(0);
    expect(await fileUploadAuditRows()).toHaveLength(0);
  });
});
