/**
 * Reference-data changelog audit — Integration Tests (#507)
 *
 * `lib/uploads/reference-data-writers.ts` and `components/processors/{processspecies,
 * processpersonnel}.tsx` write attributes, species/genus/family, personnel/roles and
 * the census↔personnel link. Before this work:
 *
 *  - A CLEAN_REUPLOAD's bulk DELETE of the previous active rows (attributes, species,
 *    censusactivepersonnel links, and the personnel rows that became orphaned once those
 *    links were gone) went completely unaudited — the row simply vanished from
 *    unifiedchangelog's point of view.
 *  - `censusactivepersonnel` INSERTs from the bulk writer were never audited at all.
 *  - `processSpecies` / `processPersonnel` — the manual single-row grid-edit path,
 *    reached via `insertOrUpdate` for formType "species"/"personnel" — made their
 *    handleUpsert calls with no audit whatsoever.
 *
 * These tests drive the PRODUCTION writer + processor functions against real local
 * MySQL — real ConnectionManager, real SQL — and then read `unifiedchangelog` and the
 * underlying tables directly. No hand-built INSERT, no reimplemented writer.
 *
 * SAFETY: identical guard to coreapifunctions-patch-atomicity / metadata-changelog-audit —
 * the suite HARD-FAILS before any write if the ConnectionManager pool host is not local.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/recent-changes-reference-audit.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { UploadMode } from '@/config/uploadmodes';
import type { FileRow } from '@/config/macros/formdetails';
import { upsertAttributeRows, upsertPersonnelRows, upsertSpeciesRows } from '@/lib/uploads/reference-data-writers';
import { processSpecies } from '@/components/processors/processspecies';
import { processPersonnel } from '@/components/processors/processpersonnel';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { resetUploadSessionReplacementMarkerCacheForTests } from '@/lib/uploads/upload-session-replacement-marker';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const TEST_CHANGED_BY = 'recent-changes-reference-audit@forestgeo.test';
const SESSION_USER = 'recent-changes-reference-audit-session@forestgeo.test';

const CHANGELOG_OPERATION = { INSERT: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE' } as const;

let setupConnection: Connection | null = null;
/** A second real connection, standing in for a concurrent writer. */
let peerConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;
let testData: TestData;
let plotID: number;
let censusID: number;

const connectionManager = ConnectionManager.getInstance();

interface ChangelogRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: string;
  OldRowState: Record<string, unknown> | string | null;
  NewRowState: Record<string, unknown> | string | null;
  ChangedBy: string | null;
  PlotID: number | null;
  CensusID: number | null;
}

/** The MySQL driver may hand back JSON columns already parsed. */
function rowState(value: ChangelogRow['OldRowState']): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function readChangelog(tableName?: string): Promise<ChangelogRow[]> {
  const [rows] = await setupConnection!.query<RowDataPacket[]>(
    tableName
      ? `SELECT * FROM \`${schema}\`.unifiedchangelog WHERE TableName = ? ORDER BY ChangeID`
      : `SELECT * FROM \`${schema}\`.unifiedchangelog ORDER BY ChangeID`,
    tableName ? [tableName] : []
  );
  return rows as unknown as ChangelogRow[];
}

async function truncateChangelog(): Promise<void> {
  await setupConnection!.query(`DELETE FROM \`${schema}\`.unifiedchangelog`);
}

function logChangelog(label: string, rows: ChangelogRow[]): void {
  // eslint-disable-next-line no-console
  console.log(
    `[recent-changes-reference-audit] ${label}:`,
    rows.map(row => ({
      TableName: row.TableName,
      RecordID: row.RecordID,
      Operation: row.Operation,
      OldRowState: rowState(row.OldRowState),
      NewRowState: rowState(row.NewRowState),
      ChangedBy: row.ChangedBy,
      CensusID: row.CensusID
    }))
  );
}

// Dependency order: censusactivepersonnel/species before the rows they reference.
const RESET_TABLES_IN_ORDER = ['censusactivepersonnel', 'personnel', 'roles', 'species', 'genus', 'family', 'attributes', 'upload_sessions'];

async function resetReferenceTables(): Promise<void> {
  for (const table of RESET_TABLES_IN_ORDER) {
    await setupConnection!.query(`DELETE FROM \`${schema}\`.${table}`);
  }
  resetUploadSessionReplacementMarkerCacheForTests();
}

function speciesRow(code: string, overrides: Partial<FileRow> = {}): FileRow {
  return { spcode: code, family: 'Fabaceae', genus: 'Inga', species: `species-${code.toLowerCase()}`, authority: 'Testus', ...overrides };
}

function attributeRow(code: string, overrides: Partial<FileRow> = {}): FileRow {
  return { code, description: `description for ${code}`, status: 'alive', ...overrides };
}

function personnelRow(firstName: string, overrides: Partial<FileRow> = {}): FileRow {
  return { firstname: firstName, lastname: 'Fieldworker', role: 'field crew', roledescription: 'audit test crew', ...overrides };
}

/** One request, its own transaction — commits on success, rolls back on throw, exactly
 *  like every production caller of these writers/processors (sqlpacketload, bulkcrud). */
async function inTransaction<T>(fn: (transactionID: string) => Promise<T>): Promise<T> {
  const transactionID = await connectionManager.beginTransaction();
  try {
    const result = await fn(transactionID);
    await connectionManager.commitTransaction(transactionID);
    return result;
  } catch (error) {
    await connectionManager.rollbackTransaction(transactionID);
    throw error;
  }
}

async function seedUploadSession(sessionID: string): Promise<void> {
  await setupConnection!.query(
    `INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state)
     VALUES (?, ?, ?, ?, ?, 'uploading')`,
    [sessionID, schema, plotID, censusID, SESSION_USER]
  );
}

async function completeUploadSession(sessionID: string): Promise<void> {
  await setupConnection!.query(`UPDATE upload_sessions SET state = 'completed' WHERE session_id = ?`, [sessionID]);
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[recent-changes-reference-audit] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  testData = setup.testData;
  schema = config.database;
  plotID = testData.plots[0].plotID;
  censusID = testData.census[0].censusID;

  await ensureUploadSessionsTable(schema);
  peerConnection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database
  });
}, 90000);

beforeEach(async () => {
  await truncateChangelog();
  await resetReferenceTables();
});

afterAll(async () => {
  await peerConnection?.end();
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('bulk reference writers: CLEAN_REUPLOAD audits the rows it deletes (#507)', () => {
  it('audits a DELETE for every active attribute row a later CLEAN_REUPLOAD session removes', async () => {
    const sessionOne = 'ref-audit-attributes-session-one';
    const sessionTwo = 'ref-audit-attributes-session-two';
    await seedUploadSession(sessionOne);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('AUD01')], UploadMode.CLEAN_REUPLOAD, sessionOne, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionOne);
    await truncateChangelog(); // isolate the delete under test from the first session's insert

    await seedUploadSession(sessionTwo);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('AUD02')], UploadMode.CLEAN_REUPLOAD, sessionTwo, tx, TEST_CHANGED_BY)
    );

    const rows = await readChangelog('attributes');
    logChangelog('attributes CLEAN_REUPLOAD session two', rows);

    const deletes = rows.filter(row => row.Operation === CHANGELOG_OPERATION.DELETE);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].RecordID).toBe('AUD01');
    expect(rowState(deletes[0].OldRowState)?.Code).toBe('AUD01');
    expect(deletes[0].NewRowState).toBeNull();
    expect(deletes[0].ChangedBy).toBe(TEST_CHANGED_BY);

    const inserts = rows.filter(row => row.Operation === CHANGELOG_OPERATION.INSERT);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].RecordID).toBe('AUD02');
  });

  it('captures, deletes and audits only the active row when an inactive sibling shares the same Code (real PRIMARY KEY (Code, IsActive))', async () => {
    const sessionOne = 'ref-audit-attributes-pk-session-one';
    const sessionTwo = 'ref-audit-attributes-pk-session-two';
    await seedUploadSession(sessionOne);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('PKDUP')], UploadMode.CLEAN_REUPLOAD, sessionOne, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionOne);

    // A historical soft-deleted sibling sharing this Code. attributes' real PK is
    // (Code, IsActive), so this row coexists with the active one above.
    await setupConnection!.query(`INSERT INTO \`${schema}\`.attributes (Code, Description, Status, IsActive, DeletedAt) VALUES (?, ?, ?, 0, NOW())`, [
      'PKDUP',
      'historical inactive sibling',
      'dead'
    ]);
    await truncateChangelog();

    await seedUploadSession(sessionTwo);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('PKDUP2')], UploadMode.CLEAN_REUPLOAD, sessionTwo, tx, TEST_CHANGED_BY)
    );

    const deletes = (await readChangelog('attributes')).filter(row => row.Operation === CHANGELOG_OPERATION.DELETE);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].RecordID).toBe('PKDUP');
    expect(rowState(deletes[0].OldRowState)?.IsActive).toBe(1);

    const [survivingInactiveSibling] = await setupConnection!.query<RowDataPacket[]>(
      `SELECT * FROM \`${schema}\`.attributes WHERE Code = 'PKDUP' AND IsActive = 0`
    );
    expect(survivingInactiveSibling, 'the inactive sibling sharing this Code must survive the CLEAN_REUPLOAD delete').toHaveLength(1);
  });

  it('audits a DELETE for every active species row a later CLEAN_REUPLOAD session removes', async () => {
    const sessionOne = 'ref-audit-species-session-one';
    const sessionTwo = 'ref-audit-species-session-two';
    await seedUploadSession(sessionOne);
    await inTransaction(tx => upsertSpeciesRows(connectionManager, schema, [speciesRow('AUDSP1')], UploadMode.CLEAN_REUPLOAD, sessionOne, tx, TEST_CHANGED_BY));
    await completeUploadSession(sessionOne);

    const [[survivingRow]] = [(await setupConnection!.query<RowDataPacket[]>(`SELECT SpeciesID FROM \`${schema}\`.species WHERE SpeciesCode = 'AUDSP1'`))[0]];
    await truncateChangelog();

    await seedUploadSession(sessionTwo);
    await inTransaction(tx => upsertSpeciesRows(connectionManager, schema, [speciesRow('AUDSP2')], UploadMode.CLEAN_REUPLOAD, sessionTwo, tx, TEST_CHANGED_BY));

    const deletes = (await readChangelog('species')).filter(row => row.Operation === CHANGELOG_OPERATION.DELETE);
    logChangelog('species CLEAN_REUPLOAD deletes', deletes);

    expect(deletes).toHaveLength(1);
    expect(deletes[0].RecordID).toBe(String(survivingRow.SpeciesID));
    expect(rowState(deletes[0].OldRowState)?.SpeciesCode).toBe('AUDSP1');
    expect(deletes[0].NewRowState).toBeNull();
  });

  it('audits a DELETE for the removed censusactivepersonnel link AND the personnel row that becomes orphaned', async () => {
    const sessionOne = 'ref-audit-personnel-session-one';
    const sessionTwo = 'ref-audit-personnel-session-two';
    await seedUploadSession(sessionOne);
    await inTransaction(tx =>
      upsertPersonnelRows(connectionManager, schema, censusID, [personnelRow('Orphaned')], UploadMode.CLEAN_REUPLOAD, sessionOne, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionOne);

    const [[orphanedPersonnelRow]] = [
      (await setupConnection!.query<RowDataPacket[]>(`SELECT PersonnelID FROM \`${schema}\`.personnel WHERE FirstName = 'Orphaned'`))[0]
    ];
    await truncateChangelog();

    await seedUploadSession(sessionTwo);
    await inTransaction(tx =>
      upsertPersonnelRows(connectionManager, schema, censusID, [personnelRow('Replacement')], UploadMode.CLEAN_REUPLOAD, sessionTwo, tx, TEST_CHANGED_BY)
    );

    const rows = await readChangelog();
    logChangelog('personnel CLEAN_REUPLOAD session two', rows);

    const capDeletes = rows.filter(row => row.TableName === 'censusactivepersonnel' && row.Operation === CHANGELOG_OPERATION.DELETE);
    expect(capDeletes).toHaveLength(1);
    expect(rowState(capDeletes[0].OldRowState)?.PersonnelID).toBe(orphanedPersonnelRow.PersonnelID);
    expect(capDeletes[0].CensusID).toBe(censusID);

    const personnelDeletes = rows.filter(row => row.TableName === 'personnel' && row.Operation === CHANGELOG_OPERATION.DELETE);
    expect(personnelDeletes).toHaveLength(1);
    expect(personnelDeletes[0].RecordID).toBe(String(orphanedPersonnelRow.PersonnelID));
    expect(rowState(personnelDeletes[0].OldRowState)?.FirstName).toBe('Orphaned');

    const [stillPresent] = await setupConnection!.query<RowDataPacket[]>(`SELECT PersonnelID FROM \`${schema}\`.personnel WHERE FirstName = 'Orphaned'`);
    expect(stillPresent, 'the orphaned personnel row must actually be gone, matching what the DELETE audit claims').toHaveLength(0);
  });

  it('audits an INSERT for the censusactivepersonnel link the bulk writer creates, and does not re-audit a retry of the same link', async () => {
    const session = 'ref-audit-personnel-link-insert';
    await seedUploadSession(session);
    await inTransaction(tx =>
      upsertPersonnelRows(connectionManager, schema, censusID, [personnelRow('Linked')], UploadMode.CLEAN_REUPLOAD, session, tx, TEST_CHANGED_BY)
    );

    const linkInserts = (await readChangelog('censusactivepersonnel')).filter(row => row.Operation === CHANGELOG_OPERATION.INSERT);
    expect(linkInserts).toHaveLength(1);
    expect(linkInserts[0].CensusID).toBe(censusID);
    expect(rowState(linkInserts[0].NewRowState)?.PersonnelID).toBeTypeOf('number');

    await truncateChangelog();

    // A retry of the identical file (REVISIONS: additive, no reset) must find the same
    // person and the same link already exist — INSERT IGNORE reports affectedRows: 0 —
    // and must NOT fabricate a second "link created" row.
    await inTransaction(tx =>
      upsertPersonnelRows(connectionManager, schema, censusID, [personnelRow('Linked')], UploadMode.REVISIONS, null, tx, TEST_CHANGED_BY)
    );

    const retryLinkRows = await readChangelog('censusactivepersonnel');
    expect(retryLinkRows, 'retrying an already-linked person must not produce a second INSERT audit row').toHaveLength(0);
  });
});

describe('processSpecies: manual single-row grid-edit path audits family/genus/species (#507)', () => {
  const basePayload: FileRow = { family: 'Testaceae', genus: 'Testus', spcode: 'MANUAL1', species: 'manualis', authority: 'Testus' };

  it('throws before touching the database when transactionID is missing', async () => {
    await expect(processSpecies({ connectionManager, rowData: basePayload, schema, fullName: TEST_CHANGED_BY })).rejects.toThrow(/transactionID/);

    const [rows] = await setupConnection!.query<RowDataPacket[]>(`SELECT * FROM \`${schema}\`.family WHERE Family = 'Testaceae'`);
    expect(rows).toHaveLength(0);
  });

  it('throws when fullName is missing, so a mutation can never be attributed to nobody', async () => {
    await expect(inTransaction(tx => processSpecies({ connectionManager, rowData: basePayload, schema, transactionID: tx }))).rejects.toThrow(/fullName/);
  });

  it('audits an INSERT for family, genus and species on first write, and an UPDATE on the next edit', async () => {
    await inTransaction(tx => processSpecies({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: TEST_CHANGED_BY }));

    const insertRows = await readChangelog();
    logChangelog('processSpecies first write', insertRows);
    expect(insertRows.map(row => row.TableName)).toEqual(['family', 'genus', 'species']);
    expect(insertRows.every(row => row.Operation === CHANGELOG_OPERATION.INSERT)).toBe(true);
    expect(insertRows.every(row => row.ChangedBy === TEST_CHANGED_BY)).toBe(true);

    await truncateChangelog();

    await inTransaction(tx =>
      processSpecies({ connectionManager, rowData: { ...basePayload, authority: 'Revisedus' }, schema, transactionID: tx, fullName: TEST_CHANGED_BY })
    );

    const updateRows = await readChangelog('species');
    logChangelog('processSpecies second write (authority edit)', updateRows);
    expect(updateRows).toHaveLength(1);
    expect(updateRows[0].Operation).toBe(CHANGELOG_OPERATION.UPDATE);
    expect(rowState(updateRows[0].NewRowState)?.SpeciesAuthority).toBe('Revisedus');
    // handleUpsert's INSERT ... ON DUPLICATE KEY UPDATE overwrites before anything can
    // read the prior row — recording oldRowState: null is the honest answer, not a
    // fabricated snapshot. See auditHandleUpsertResult's doc comment.
    expect(updateRows[0].OldRowState).toBeNull();
  });

  it('truncates a changedBy identity longer than the ChangedBy column before writing it', async () => {
    const longIdentity = 'x'.repeat(CHANGED_BY_MAX_LENGTH + 40);
    await inTransaction(tx => processSpecies({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: longIdentity }));

    const rows = await readChangelog('family');
    expect(rows[0].ChangedBy).toBe(longIdentity.slice(0, CHANGED_BY_MAX_LENGTH));
    expect(rows[0].ChangedBy).toHaveLength(CHANGED_BY_MAX_LENGTH);
  });

  it('re-submitting an identical row is a true no-op: handleUpsert classifies family, genus and species all as unchanged, with no extra changelog rows', async () => {
    await inTransaction(tx => processSpecies({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: TEST_CHANGED_BY }));
    await truncateChangelog();

    await inTransaction(tx => processSpecies({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: TEST_CHANGED_BY }));

    const rows = await readChangelog();
    logChangelog('processSpecies identical second write (true no-op)', rows);
    expect(rows, 'family/genus/species are byte-for-byte unchanged -- no table may log a mutation').toHaveLength(0);
  });
});

describe('processPersonnel: manual single-row grid-edit path audits roles/personnel (#507)', () => {
  const basePayload: FileRow = { firstname: 'Manualis', lastname: 'Fieldworker', role: 'field crew', roledescription: 'manual grid audit test' };

  it('throws before touching the database when transactionID is missing', async () => {
    await expect(processPersonnel({ connectionManager, rowData: basePayload, schema, fullName: TEST_CHANGED_BY })).rejects.toThrow(/transactionID/);

    const [rows] = await setupConnection!.query<RowDataPacket[]>(`SELECT * FROM \`${schema}\`.personnel WHERE FirstName = 'Manualis'`);
    expect(rows).toHaveLength(0);
  });

  it('throws when fullName is missing', async () => {
    await expect(inTransaction(tx => processPersonnel({ connectionManager, rowData: basePayload, schema, transactionID: tx }))).rejects.toThrow(/fullName/);
  });

  it("audits an INSERT for roles and personnel. It does not touch censusactivepersonnel — that roster link is the bulk reference writer's responsibility, not this manual single-row grid-edit path", async () => {
    await inTransaction(tx => processPersonnel({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: TEST_CHANGED_BY }));

    const rows = await readChangelog();
    logChangelog('processPersonnel first write', rows);
    expect(rows.map(row => row.TableName).sort()).toEqual(['personnel', 'roles']);
    expect(rows.every(row => row.Operation === CHANGELOG_OPERATION.INSERT)).toBe(true);

    const [linkRows] = await setupConnection!.query<RowDataPacket[]>(
      `SELECT cap.* FROM \`${schema}\`.censusactivepersonnel cap
         JOIN \`${schema}\`.personnel p ON p.PersonnelID = cap.PersonnelID
        WHERE p.FirstName = ?`,
      [basePayload.firstname]
    );
    expect(linkRows, 'the manual grid-edit path must not write a roster link on its own — only the bulk reference writer does').toHaveLength(0);
  });

  it('does not re-audit the unchanged personnel/roles rows on an identical second edit', async () => {
    await inTransaction(tx => processPersonnel({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: TEST_CHANGED_BY }));
    await truncateChangelog();

    await inTransaction(tx => processPersonnel({ connectionManager, rowData: basePayload, schema, transactionID: tx, fullName: TEST_CHANGED_BY }));

    const rows = await readChangelog();
    logChangelog('processPersonnel identical second write', rows);
    expect(rows, 'an identical re-edit is not a mutation anywhere: roles and personnel are both unchanged').toHaveLength(0);
  });
});

describe('recordMutation JSON binding survives INSERT, UPDATE and DELETE back-to-back on one prepared-statement connection (#507)', () => {
  it('writes all three operations inside a single transaction without the ER_INVALID_JSON_CHARSET prepared-statement regression', async () => {
    // Seeding phase: two separate, serial sessions (upload_sessions has one active
    // row per (schema, plot, census) at a time -- uq_upload_sessions_active_scope).
    // Only the assertions below need to share one transaction/connection.
    const sessionAttrSeed = 'ref-audit-mixed-ops-session-attr-seed';
    await seedUploadSession(sessionAttrSeed);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('MIX01')], UploadMode.CLEAN_REUPLOAD, sessionAttrSeed, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionAttrSeed);

    const sessionSpeciesSeed = 'ref-audit-mixed-ops-session-species-seed';
    await seedUploadSession(sessionSpeciesSeed);
    await inTransaction(tx =>
      upsertSpeciesRows(connectionManager, schema, [speciesRow('MIXSP1')], UploadMode.CLEAN_REUPLOAD, sessionSpeciesSeed, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionSpeciesSeed);
    await truncateChangelog();

    // The assertions: an UPDATE (attributes), a DELETE+INSERT pair (species), and
    // an INSERT (family/genus) on the same transaction/connection, each going
    // through record-mutation.ts's prepared-statement JSON bind.
    const sessionSpeciesReset = 'ref-audit-mixed-ops-session-species-reset';
    await seedUploadSession(sessionSpeciesReset);
    await inTransaction(async tx => {
      // UPDATE: a REVISIONS attribute upload (no session claim involved) matches
      // MIX01 and changes its description.
      await upsertAttributeRows(
        connectionManager,
        schema,
        [attributeRow('MIX01', { description: 'revised description' })],
        UploadMode.REVISIONS,
        null,
        tx,
        TEST_CHANGED_BY
      );
      // DELETE (of MIXSP1) + INSERT (of MIXSP2, plus its own new family/genus):
      // a CLEAN_REUPLOAD species upload. MIXSP2 uses a fresh family/genus (not
      // MIXSP1's) so this test exercises only the operations it names --
      // reusing an unchanged family/genus here would additionally exercise
      // handleUpsert's separately-documented INSERT/unchanged ambiguity
      // (config/utils.ts), which is not what this test is checking.
      await upsertSpeciesRows(
        connectionManager,
        schema,
        [speciesRow('MIXSP2', { family: 'Differentaceae', genus: 'Differentus' })],
        UploadMode.CLEAN_REUPLOAD,
        sessionSpeciesReset,
        tx,
        TEST_CHANGED_BY
      );
    });
    await completeUploadSession(sessionSpeciesReset);

    const rows = await readChangelog();
    logChangelog('mixed INSERT/UPDATE/DELETE on one connection', rows);

    const updates = rows.filter(row => row.Operation === CHANGELOG_OPERATION.UPDATE);
    const deletes = rows.filter(row => row.Operation === CHANGELOG_OPERATION.DELETE);
    const inserts = rows.filter(row => row.Operation === CHANGELOG_OPERATION.INSERT);
    expect(updates).toHaveLength(1);
    expect(deletes).toHaveLength(1);
    // family (Differentaceae) + genus (Differentus) + species (MIXSP2).
    expect(inserts).toHaveLength(3);

    // Every JSON column round-trips through the real driver intact -- the regression
    // this test guards against is the prepared-statement bind itself throwing, not a
    // value mismatch, but asserting the values too proves CONVERT didn't corrupt them.
    expect(rowState(updates[0].OldRowState)?.Code).toBe('MIX01');
    expect(rowState(updates[0].NewRowState)?.Description).toBe('revised description');
    expect(rowState(deletes[0].OldRowState)?.SpeciesCode).toBe('MIXSP1');
    expect(deletes[0].NewRowState).toBeNull();

    const speciesInsert = inserts.find(row => row.TableName === 'species');
    expect(rowState(speciesInsert?.NewRowState)?.SpeciesCode).toBe('MIXSP2');
    expect(speciesInsert?.OldRowState).toBeNull();
  });
});

describe('the capture SELECT actually locks its rows (#507)', () => {
  it("upsertAttributeRows' real CLEAN_REUPLOAD capture blocks a peer write to the captured row until the production call proceeds past it", async () => {
    const sessionOne = 'ref-audit-lock-verification-session-one';
    await seedUploadSession(sessionOne);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('LOCKED01')], UploadMode.CLEAN_REUPLOAD, sessionOne, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionOne);
    await truncateChangelog();

    // Pauses the production CLEAN_REUPLOAD call -- real upsertAttributeRows, not a
    // test-issued SELECT -- after its own capture query (SELECT ... FOR UPDATE on
    // attributes) has actually run and taken the real lock, but before the DELETE
    // that follows it. Restored, and the pause released, in `finally` below so a
    // failed assertion can never leave the peer blocked or the transaction open.
    const originalExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    let hasPaused = false;
    let signalCaptureRan: () => void;
    const captureRan = new Promise<void>(resolve => {
      signalCaptureRan = resolve;
    });
    let releasePause: () => void;
    const pauseReleased = new Promise<void>(resolve => {
      releasePause = resolve;
    });
    connectionManager.executeQuery = async (sql: string, params?: unknown[], transactionID?: string) => {
      const result = await originalExecuteQuery(sql, params, transactionID);
      if (!hasPaused && /SELECT/i.test(sql) && /\.attributes\b/i.test(sql) && /FOR UPDATE/i.test(sql)) {
        hasPaused = true;
        signalCaptureRan();
        await pauseReleased;
      }
      return result;
    };

    const sessionTwo = 'ref-audit-lock-verification-session-two';
    await seedUploadSession(sessionTwo);
    let productionSettled = false;
    const productionCall = inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('LOCKED02')], UploadMode.CLEAN_REUPLOAD, sessionTwo, tx, TEST_CHANGED_BY)
    ).finally(() => {
      productionSettled = true;
    });

    let peerSettled = false;
    let peerUpdate: Promise<unknown> | undefined;
    try {
      // Bounded wait, not an indefinite await: if the SQL-matching regex above ever
      // stops matching the real capture query, this fails fast with a clear cause
      // instead of hanging and leaving the production transaction open.
      const CAPTURE_SIGNAL_TIMEOUT_MS = 5000;
      await Promise.race([
        captureRan,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Production capture query did not run within the timeout; the SQL-matching regex may no longer match it.')),
            CAPTURE_SIGNAL_TIMEOUT_MS
          )
        )
      ]);

      peerUpdate = peerConnection!.query(`UPDATE \`${schema}\`.attributes SET Description = 'peer edit' WHERE Code = 'LOCKED01'`).finally(() => {
        peerSettled = true;
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(peerSettled, 'a peer write to the row the real production capture just locked must wait').toBe(false);
      expect(productionSettled, 'production must still be paused between its own capture and its DELETE').toBe(false);

      releasePause();
      await productionCall;
      await peerUpdate;
      expect(peerSettled, 'the peer write must proceed once production released the lock by committing').toBe(true);
    } finally {
      connectionManager.executeQuery = originalExecuteQuery;
      releasePause();
      await productionCall.catch(() => undefined);
      await peerUpdate?.catch(() => undefined);
    }

    const rows = await readChangelog('attributes');
    const deletes = rows.filter(row => row.Operation === CHANGELOG_OPERATION.DELETE);
    const inserts = rows.filter(row => row.Operation === CHANGELOG_OPERATION.INSERT);
    expect(deletes.map(row => row.RecordID)).toEqual(['LOCKED01']);
    expect(inserts.map(row => row.RecordID)).toEqual(['LOCKED02']);

    const [survivingRows] = await setupConnection!.query<RowDataPacket[]>(`SELECT Code FROM \`${schema}\`.attributes WHERE IsActive = 1 ORDER BY Code`);
    expect(survivingRows.map(row => row.Code)).toEqual(['LOCKED02']);
  });
});

describe('fault injection: a mismatched delete count rolls back the real DELETE and skips its audit (#507)', () => {
  it("throws deleteCapturedRows' count-mismatch guard when the real DELETE's reported affectedRows is deliberately altered, and the outer transaction rolls back the row it actually deleted", async () => {
    const sessionOne = 'ref-audit-mismatch-fault-session-one';
    await seedUploadSession(sessionOne);
    await inTransaction(tx =>
      upsertAttributeRows(connectionManager, schema, [attributeRow('MISMATCH01')], UploadMode.CLEAN_REUPLOAD, sessionOne, tx, TEST_CHANGED_BY)
    );
    await completeUploadSession(sessionOne);
    await truncateChangelog();

    // Lets the production DELETE actually run against real MySQL (so this proves a
    // real rollback, not a mocked one), then hands deleteCapturedRows a deliberately
    // wrong affectedRows -- 0 instead of the real 1 -- so its own count-mismatch
    // guard fires on a real row it really deleted. Restored in `finally`.
    const originalExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    let hasAltered = false;
    connectionManager.executeQuery = async (sql: string, params?: unknown[], transactionID?: string) => {
      const result = await originalExecuteQuery(sql, params, transactionID);
      if (!hasAltered && /^\s*DELETE FROM/i.test(sql) && /\.attributes\b/i.test(sql)) {
        hasAltered = true;
        return { ...result, affectedRows: 0 };
      }
      return result;
    };

    const sessionTwo = 'ref-audit-mismatch-fault-session-two';
    try {
      await seedUploadSession(sessionTwo);
      await expect(
        inTransaction(tx =>
          upsertAttributeRows(connectionManager, schema, [attributeRow('MISMATCH02')], UploadMode.CLEAN_REUPLOAD, sessionTwo, tx, TEST_CHANGED_BY)
        )
      ).rejects.toThrow(/Clean re-upload delete count mismatch for attributes/);
    } finally {
      connectionManager.executeQuery = originalExecuteQuery;
    }

    // The real DELETE ran and was rolled back with the rest of the transaction:
    // the original row survives, the new file's row was never committed, and the
    // guard threw before any changelog write for the delete was attempted.
    const [survivingRows] = await setupConnection!.query<RowDataPacket[]>(`SELECT Code FROM \`${schema}\`.attributes WHERE IsActive = 1 ORDER BY Code`);
    expect(survivingRows.map(row => row.Code)).toEqual(['MISMATCH01']);

    const rows = await readChangelog('attributes');
    expect(rows, 'the guard must throw before any changelog write for the aborted delete is attempted').toHaveLength(0);

    const [[sessionTwoRow]] = [
      (
        await setupConnection!.query<RowDataPacket[]>(`SELECT reference_replacement_completed_at FROM \`${schema}\`.upload_sessions WHERE session_id = ?`, [
          sessionTwo
        ])
      )[0]
    ];
    expect(sessionTwoRow.reference_replacement_completed_at, 'the failed session must not be left recorded as having replaced the table').toBeNull();
  });
});

describe('an audit write failure rolls back the mutation it was supposed to describe (#507)', () => {
  it('rolls back the family/genus/species INSERTs if the changelog write itself cannot succeed', async () => {
    // REGRESSION SENTINEL: if any audit call in processSpecies / reference-data-writers
    // ever drifts to a bare executeQuery (its own autocommitting connection) instead of
    // `tx.query`, this test stops catching the case where the changelog write fails but
    // the data mutation it was supposed to describe survives anyway.
    await setupConnection!.query(`RENAME TABLE \`${schema}\`.unifiedchangelog TO \`${schema}\`.unifiedchangelog_hidden_for_test`);
    try {
      await expect(
        inTransaction(tx =>
          processSpecies({
            connectionManager,
            rowData: speciesRow('ROLLBACK1'),
            schema,
            transactionID: tx,
            fullName: TEST_CHANGED_BY
          })
        )
      ).rejects.toThrow();

      const [speciesRows] = await setupConnection!.query<RowDataPacket[]>(`SELECT * FROM \`${schema}\`.species WHERE SpeciesCode = 'ROLLBACK1'`);
      expect(speciesRows, 'the species INSERT must not survive a changelog write that failed inside the same transaction').toHaveLength(0);

      const [familyRows] = await setupConnection!.query<RowDataPacket[]>(`SELECT * FROM \`${schema}\`.family WHERE Family = 'Fabaceae'`);
      expect(familyRows, 'the family INSERT, earlier in the same function and the same transaction, must roll back too').toHaveLength(0);
    } finally {
      await setupConnection!.query(`RENAME TABLE \`${schema}\`.unifiedchangelog_hidden_for_test TO \`${schema}\`.unifiedchangelog`);
    }
  });
});

describe('generic reference upserts racing a first insert (#507)', () => {
  it('audits a first insert and a changed update, but skips an identical retry', async () => {
    for (const description of ['first', 'updated', 'updated']) {
      await inTransaction(transactionID =>
        insertOrUpdate({
          connectionManager,
          schema,
          transactionID,
          formType: 'attributes',
          rowData: attributeRow('DIRECT01', { description }),
          fullName: TEST_CHANGED_BY
        })
      );
    }
    const rows = await readChangelog('attributes');
    expect(rows.map(row => row.Operation)).toEqual(['INSERT', 'UPDATE']);
    expect(rowState(rows[1].OldRowState)?.Description).toBe('first');
    expect(rowState(rows[1].NewRowState)?.Description).toBe('updated');
  });

  it.each(['changed description', 'peer description'])('captures the committed peer row before applying %s', async description => {
    const execute = connectionManager.executeQuery.bind(connectionManager);
    let releaseCapture!: () => void;
    let signalCapture!: () => void;
    const captured = new Promise<void>(resolve => {
      signalCapture = resolve;
    });
    const released = new Promise<void>(resolve => {
      releaseCapture = resolve;
    });
    let firstTransaction: string | undefined;
    let paused = false;
    connectionManager.executeQuery = async (sql, params, tx) => {
      const result = await execute(sql, params, tx);
      if (!paused && tx === firstTransaction && /^\s*SELECT/i.test(sql) && sql.includes('`attributes`') && sql.includes('FOR UPDATE')) {
        paused = true;
        expect(result).toEqual([]);
        signalCapture();
        await released;
      }
      return result;
    };
    const first = inTransaction(async transactionID => {
      firstTransaction = transactionID;
      await insertOrUpdate({
        connectionManager,
        schema,
        transactionID,
        formType: 'attributes',
        rowData: attributeRow('RACE01', { description }),
        fullName: 'waiting@example.com'
      });
    });
    // Attach a rejection handler before waiting on the captured-query gate.
    const settled = first.then(
      () => ({ error: null }),
      error => ({ error })
    );
    try {
      await Promise.race([
        captured,
        settled.then(result => {
          throw result.error ?? new Error('Capture was never reached');
        })
      ]);
      await inTransaction(tx =>
        upsertAttributeRows(
          connectionManager,
          schema,
          [attributeRow('RACE01', { description: 'peer description' })],
          UploadMode.REVISIONS,
          null,
          tx,
          'peer@example.com'
        )
      );
      releaseCapture();
      expect((await settled).error).toBeNull();
      const rows = await readChangelog('attributes');
      expect(rows.map(row => row.Operation)).toEqual(description === 'peer description' ? ['INSERT'] : ['INSERT', 'UPDATE']);
      if (description !== 'peer description') {
        expect(rowState(rows[1].OldRowState)?.Description).toBe('peer description');
        expect(rowState(rows[1].NewRowState)?.Description).toBe(description);
        expect(rows[1].ChangedBy).toBe('waiting@example.com');
      }
    } finally {
      releaseCapture();
      await settled;
      connectionManager.executeQuery = execute;
    }
  });
});
