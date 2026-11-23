/**
 * readChangeExportSnapshot (#592) against real local MySQL: the export's reader, below the route.
 *
 * getConn is replaced by a thin double over a dedicated real connection, so the reader's owned
 * connection (isolation level, begin, rollback, release, destroy) can be observed and made to fail.
 * That connection's session default is set to READ COMMITTED, so the snapshot test passes only if
 * the reader itself asks for REPEATABLE READ. Changes are seeded through the production audit
 * writers (helpers/changeexportseed.ts). Hand-written rows are used only for shapes no current
 * writer produces: a NULL timestamp, legacy arrays, scalar states, odd file ids, and the
 * file_upload row whose in-place update the snapshot must not see.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: ~/dev/ForestGEO/docs/relay-integration.sh <checkout> -- tests/integration/changes-explorer-export-snapshot.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';
import { classifyChanges, toExportedRows, type ExportedRow } from './helpers/changeexportprobe';
import { createChangeExportSeeder, SEED_CHANGED_BY, type ChangeExportSeeder } from './helpers/changeexportseed';
import { FILTERED_COUNT_SUFFIX, formatExportCell, NO_FILE_RECORDED_KEY, SUMMARY_COLUMN_MARKER, type ExportCell } from '@/config/changelogexport';
import { recordedFieldNames } from '@/config/changelogdiff';
import { DEFAULT_RECENT_CHANGES_FILTERS, type RecentChangesServerFilters } from '@/config/recentchangesexplorer';
import { recordDeletedCoreMeasurementsAudit } from '@/lib/changelog/ingestion-audit';
import { ChangelogOperation } from '@/lib/changelog/record-mutation';
import {
  buildBaseBatchExpression,
  ChangeExportReadError,
  ExportTooLargeError,
  readChangeExportSnapshot,
  SNAPSHOT_BEGIN_STATEMENT,
  SNAPSHOT_ISOLATION_STATEMENT,
  type ChangeExportLimits,
  type ChangeExportSnapshot
} from '@/lib/changes/exportsnapshot';
import { familyRootOf } from '@/lib/uploads/batch-family';
import { BULK_CRUD_FILE_ID, buildFileUploadChangelogRecordID, mergeFileUploadChunkIntoMetadata } from '@/lib/uploads/file-names';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const OTHER_PLOT_OFFSET = 1000;
const GENEROUS_LIMITS: ChangeExportLimits = { maxRows: 10_000, pageSize: 2 };
const READ_COMMITTED_SESSION_DEFAULT = 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED';
const READ_ONLY_VIOLATION_CODE = 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION';

const UPLOAD_FILE = 'export-census.csv';
const UPLOAD_BASE_BATCH = 'exportbatch';
const UPLOAD_SUB_BATCH_ONE = `${UPLOAD_BASE_BATCH}__sub001`;
const UPLOAD_SUB_BATCH_TWO = `${UPLOAD_BASE_BATCH}__sub002`;
const MANUAL_ENTRY_BATCH = 'manualbatch';
const OTHER_PLOT_FILE = 'other-plot.csv';
const OTHER_PLOT_BATCH = 'otherbatch';
const UNTAGGED_TREE_TAG = 'EXPORT-UNTAGGED';
const FILE_UPLOAD_NAME = 'staged-census.csv';
const FILE_UPLOAD_SESSION = 'session-1';
const FIRST_CHUNK = { rowCount: 100, droppedCount: 3 };
const SECOND_CHUNK = { rowCount: 40, droppedCount: 1 };

const TIME_BEFORE_WINDOW = '2026-03-09 23:59:59';
const TIME_WINDOW_START = '2026-03-10 00:00:00';
const TIME_SITE_WIDE = '2026-03-10 08:00:00';
const TIME_OTHER_PLOT = '2026-03-10 09:00:00';
const TIME_SHARED = '2026-03-10 12:00:00';
const TIME_SUPPRESSED = '2026-03-10 13:00:00';
const TIME_ONE_SIDED = '2026-03-10 14:00:00';
const TIME_MANUAL_ENTRY = '2026-03-11 10:00:00';
const TIME_WINDOW_END = '2026-03-11 23:59:59';
const TIME_AFTER_WINDOW = '2026-03-12 00:00:00';
const TIME_SECOND_CHUNK = '2026-03-12 06:00:00';
const WINDOW_FROM = '2026-03-10';
const WINDOW_TO = '2026-03-11';
const CHANGE_DATE_LENGTH = 'YYYY-MM-DD'.length;

const DETAIL_PAGE_ORDER = 'ORDER BY uc.ChangeTimestamp, uc.ChangeID';
const ROLLUP_MARKER = 'MIN(uc.ChangeID) AS LogID';
const LABEL_QUERY_MARKER = 'AS label FROM';
/** With a page size of 2 the ledger's third change, the file_upload row, is on the second detail page. */
const FILE_UPLOAD_DETAIL_PAGE = 2;

const mocks = vi.hoisted(() => ({ getConn: vi.fn(), logError: vi.fn() }));

vi.mock('@/lib/db/primitives', () => ({ getConn: mocks.getConn }));
vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => ({}) } }));
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: mocks.logError } }));

interface OwnedConnectionDouble {
  query: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

describe('readChangeExportSnapshot', () => {
  let connection: Connection;
  let ownedConnection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let otherPlotID: number;
  let censusID: number;
  let seed: ChangeExportSeeder;
  let ownedDouble: OwnedConnectionDouble;
  let afterOwnedQuery: (sql: string) => Promise<void>;

  beforeAll(async () => {
    // getConn defaults to production Azure; refuse unless the host is local.
    const host = process.env.AZURE_SQL_SERVER;
    if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
      throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
    }
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = config.database;
    plotID = setup.testData.plots[0].plotID;
    otherPlotID = plotID + OTHER_PLOT_OFFSET;
    censusID = setup.testData.census[0].censusID;
    seed = createChangeExportSeeder({ connection, schema, plotID, censusID });
    ownedConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });
    // MySQL's own default is REPEATABLE READ. With READ COMMITTED as this session's default, the
    // snapshot test below fails unless the reader sets the level for its transaction itself.
    await ownedConnection.query(READ_COMMITTED_SESSION_DEFAULT);
  }, 90_000);

  afterAll(async () => {
    await ownedConnection?.end();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM unifiedchangelog');
    await connection.query('DELETE FROM coremeasurements WHERE UploadFileID IN (?) OR RawTreeTag = ?', [
      [UPLOAD_FILE, OTHER_PLOT_FILE, BULK_CRUD_FILE_ID],
      UNTAGGED_TREE_TAG
    ]);
    afterOwnedQuery = async () => undefined;
    ownedDouble = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const result = await ownedConnection.query(sql, params);
        await afterOwnedQuery(sql);
        return result;
      }),
      rollback: vi.fn(() => ownedConnection.rollback()),
      release: vi.fn(),
      destroy: vi.fn()
    };
    mocks.getConn.mockImplementation(async () => ownedDouble);
  });

  function readSnapshot(filters: Partial<RecentChangesServerFilters> = {}, limits: ChangeExportLimits = GENEROUS_LIMITS): Promise<ChangeExportSnapshot> {
    return readChangeExportSnapshot({ schema, plotID, filters: { ...DEFAULT_RECENT_CHANGES_FILTERS, ...filters } }, limits);
  }

  async function readRows(filters: Partial<RecentChangesServerFilters> = {}): Promise<ExportedRow[]> {
    return toExportedRows((await readSnapshot(filters)).rows);
  }

  /** [LogID, ChangedTable, PrimaryKey, ChangedColumn, Action, Old, New] — a row's identity and values. */
  function identityOf(row: ExportedRow): ExportCell[] {
    return [row.LogID, row.ChangedTable, row.PrimaryKey, row.ChangedColumn, row.Action, row.Old, row.New];
  }

  function fileUploadState(chunks: Record<string, { rowCount: number; droppedCount: number }>): Record<string, unknown> {
    const state: Record<string, unknown> = {
      fileName: FILE_UPLOAD_NAME,
      uploadSessionID: FILE_UPLOAD_SESSION,
      formType: 'measurements',
      sourceFormat: 'csv',
      uploadMode: 'clean_reupload'
    };
    for (const [chunkIdentity, chunk] of Object.entries(chunks)) mergeFileUploadChunkIntoMetadata(state, chunkIdentity, chunk);
    return state;
  }

  interface SeededSpecies {
    speciesID: number;
    speciesCode: string;
  }

  async function twoSeededSpecies(): Promise<[SeededSpecies, SeededSpecies]> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID, SpeciesCode FROM species ORDER BY SpeciesID LIMIT 2');
    expect(rows, 'the seed must hold at least two species').toHaveLength(2);
    const [first, second] = rows.map(row => ({ speciesID: Number(row.SpeciesID), speciesCode: String(row.SpeciesCode) }));
    return [first, second];
  }

  /** The stored state of one audit row, read independently of the reader under test. */
  async function storedNewState(changeID: number): Promise<Record<string, unknown>> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT NewRowState FROM unifiedchangelog WHERE ChangeID = ?', [changeID]);
    const state = rows[0].NewRowState;
    return typeof state === 'string' ? JSON.parse(state) : state;
  }

  interface SeededLedger {
    nullTime: number;
    beforeWindow: number;
    fileUpload: number;
    siteWide: number;
    otherPlot: number;
    speciesEdit: number;
    uploadMembers: number[];
    quadratDelete: number;
    suppressed: number;
    oneSided: number;
    manualEntry: number;
    manualEntryMeasurementID: number;
    replacementDeletes: { tagged: number; untagged: number };
    afterWindow: number;
    otherPlotUpload: number[];
  }

  /** Seeds every case of the full-ledger scenario; ChangeIDs are recorded, times are pinned. */
  async function seedLedger(): Promise<SeededLedger> {
    const [speciesBefore, speciesAfter] = await twoSeededSpecies();
    const nullTime = await seed.insertRawChange({
      tableName: 'trees',
      recordID: '9001',
      operation: ChangelogOperation.UPDATE,
      oldRowState: { TreeID: 9001, TreeTag: 'N1' },
      newRowState: { TreeID: 9001, TreeTag: 'N2' },
      changeTime: null
    });
    const beforeWindow = await seed.recordGridChange({
      tableName: 'quadrats',
      recordID: 501,
      operation: ChangelogOperation.INSERT,
      newRowState: { QuadratID: 501, QuadratName: 'EXPORT-Q-BEFORE' },
      plotID,
      changeTime: TIME_BEFORE_WINDOW
    });
    const fileUpload = await seed.insertRawChange({
      tableName: 'file_upload',
      recordID: buildFileUploadChangelogRecordID(FILE_UPLOAD_NAME, FILE_UPLOAD_SESSION),
      operation: ChangelogOperation.INSERT,
      newRowState: fileUploadState({ 'chunk-1': FIRST_CHUNK }),
      changeTime: TIME_WINDOW_START
    });
    const siteWide = await seed.recordGridChange({
      tableName: 'species',
      recordID: 8801,
      operation: ChangelogOperation.UPDATE,
      oldRowState: { SpeciesID: 8801, SpeciesCode: 'OLDCODE' },
      newRowState: { SpeciesID: 8801, SpeciesCode: 'NEWCODE' },
      plotID: null,
      changeTime: TIME_SITE_WIDE
    });
    const otherPlot = await seed.recordGridChange({
      tableName: 'quadrats',
      recordID: 599,
      operation: ChangelogOperation.INSERT,
      newRowState: { QuadratID: 599, QuadratName: 'OTHER-PLOT-Q' },
      plotID: otherPlotID,
      changeTime: TIME_OTHER_PLOT
    });
    const speciesEdit = await seed.recordGridChange({
      tableName: 'trees',
      recordID: 7001,
      operation: ChangelogOperation.UPDATE,
      oldRowState: { TreeID: 7001, SpeciesID: speciesBefore.speciesID },
      newRowState: { TreeID: 7001, SpeciesID: speciesAfter.speciesID },
      plotID,
      changeTime: TIME_SHARED
    });

    const taggedMeasurementID = await seed.insertMeasurement(UPLOAD_FILE, UPLOAD_SUB_BATCH_ONE, 'EXPORT-T1', 11);
    await seed.insertMeasurement(UPLOAD_FILE, UPLOAD_SUB_BATCH_ONE, 'EXPORT-T2', 12);
    await seed.insertMeasurement(UPLOAD_FILE, UPLOAD_SUB_BATCH_TWO, 'EXPORT-T3', 13);
    const uploadMembers = [
      ...(await seed.auditCommittedUpload(UPLOAD_FILE, UPLOAD_SUB_BATCH_ONE, plotID, TIME_SHARED)),
      ...(await seed.auditCommittedUpload(UPLOAD_FILE, UPLOAD_SUB_BATCH_TWO, plotID, TIME_SHARED))
    ];

    const quadratDelete = await seed.recordGridChange({
      tableName: 'quadrats',
      recordID: 502,
      operation: ChangelogOperation.DELETE,
      oldRowState: { QuadratID: 502, QuadratName: 'EXPORT-Q-GONE' },
      plotID,
      changeTime: TIME_SHARED
    });
    const suppressed = await seed.recordGridChange({
      tableName: 'trees',
      recordID: 7002,
      operation: ChangelogOperation.UPDATE,
      oldRowState: { TreeID: 7002, UpdatedAt: '2026-03-01 00:00:00' },
      newRowState: { TreeID: 7002, UpdatedAt: '2026-03-10 13:00:00' },
      plotID,
      changeTime: TIME_SUPPRESSED
    });
    const oneSided = await seed.recordGridChange({
      tableName: 'trees',
      recordID: 7003,
      operation: ChangelogOperation.UPDATE,
      oldRowState: null,
      newRowState: { UpdatedAt: '2026-03-10 14:00:00' },
      plotID,
      changeTime: TIME_ONE_SIDED
    });

    const manualEntryMeasurementID = await seed.insertMeasurement(BULK_CRUD_FILE_ID, MANUAL_ENTRY_BATCH, 'EXPORT-MANUAL', 21);
    const [manualEntry] = await seed.auditCommittedUpload(BULK_CRUD_FILE_ID, MANUAL_ENTRY_BATCH, plotID, TIME_MANUAL_ENTRY);

    const untaggedMeasurementID = await seed.insertMeasurement(null, null, UNTAGGED_TREE_TAG, 31);
    const deleted = await recordDeletedCoreMeasurementsAudit({
      tx: seed.seedTx,
      schema,
      coreMeasurementIDs: [taggedMeasurementID, untaggedMeasurementID],
      changedBy: SEED_CHANGED_BY,
      plotID,
      censusID
    });
    expect(deleted, 'one DELETE audit row per measurement about to be replaced').toBe(2);
    const replacementDeletes = {
      tagged: await seed.soleChangeID('coremeasurements', taggedMeasurementID, ChangelogOperation.DELETE),
      untagged: await seed.soleChangeID('coremeasurements', untaggedMeasurementID, ChangelogOperation.DELETE)
    };
    await seed.pinChangeTime([replacementDeletes.tagged, replacementDeletes.untagged], TIME_WINDOW_END);

    const afterWindow = await seed.recordGridChange({
      tableName: 'quadrats',
      recordID: 503,
      operation: ChangelogOperation.INSERT,
      newRowState: { QuadratID: 503, QuadratName: 'EXPORT-Q-AFTER' },
      plotID,
      changeTime: TIME_AFTER_WINDOW
    });

    await seed.insertMeasurement(OTHER_PLOT_FILE, OTHER_PLOT_BATCH, 'EXPORT-OTHER', 41);
    const otherPlotUpload = await seed.auditCommittedUpload(OTHER_PLOT_FILE, OTHER_PLOT_BATCH, otherPlotID, TIME_SHARED);

    return {
      nullTime,
      beforeWindow,
      fileUpload,
      siteWide,
      otherPlot,
      speciesEdit,
      uploadMembers,
      quadratDelete,
      suppressed,
      oneSided,
      manualEntry,
      manualEntryMeasurementID,
      replacementDeletes,
      afterWindow,
      otherPlotUpload
    };
  }

  describe('the full ledger', () => {
    it('reads every change of the plot once, oldest first, across pages, from one REPEATABLE READ snapshot', async () => {
      const ledger = await seedLedger();
      const [speciesBefore, speciesAfter] = await twoSeededSpecies();
      const fileUploadRecordID = buildFileUploadChangelogRecordID(FILE_UPLOAD_NAME, FILE_UPLOAD_SESSION);
      const firstUploadMember = Math.min(...ledger.uploadMembers);

      let detailPagesRead = 0;
      afterOwnedQuery = async sql => {
        if (!sql.includes(DETAIL_PAGE_ORDER)) return;
        detailPagesRead += 1;
        if (detailPagesRead !== FILE_UPLOAD_DETAIL_PAGE) return;
        // A second chunk lands from another connection right after the page holding the summary row,
        // exactly as stage-measurements does it: the row is updated in place and its timestamp moves
        // past every later page. Without the snapshot the row would be read a second time.
        await connection.query('UPDATE unifiedchangelog SET NewRowState = ?, ChangeTimestamp = ? WHERE ChangeID = ?', [
          JSON.stringify(fileUploadState({ 'chunk-1': FIRST_CHUNK, 'chunk-2': SECOND_CHUNK })),
          TIME_SECOND_CHUNK,
          ledger.fileUpload
        ]);
      };

      const snapshot = await readSnapshot();
      const rows = toExportedRows(snapshot.rows);
      console.log(`[change-export] full ledger rows:\n${rows.map(row => JSON.stringify(row)).join('\n')}`);
      expect(detailPagesRead, 'a page size of 2 must take several detail pages').toBeGreaterThan(FILE_UPLOAD_DETAIL_PAGE);

      const manualEntryState = await storedNewState(ledger.manualEntry);
      const manualEntryRows = recordedFieldNames(manualEntryState).map(field => [
        ledger.manualEntry,
        'coremeasurements',
        String(ledger.manualEntryMeasurementID),
        field,
        'I',
        '',
        formatExportCell(manualEntryState[field])
      ]);
      expect(manualEntryRows.length, 'a manual-entry snapshot has several recorded fields').toBeGreaterThan(5);

      const taggedDeleteRow = [ledger.replacementDeletes.tagged, 'coremeasurements', UPLOAD_FILE, SUMMARY_COLUMN_MARKER, 'D', '', ''];
      const untaggedDeleteRow = [ledger.replacementDeletes.untagged, 'coremeasurements', NO_FILE_RECORDED_KEY, SUMMARY_COLUMN_MARKER, 'D', '', ''];
      const deleteRowsInLogIDOrder =
        ledger.replacementDeletes.tagged < ledger.replacementDeletes.untagged ? [taggedDeleteRow, untaggedDeleteRow] : [untaggedDeleteRow, taggedDeleteRow];

      expect(rows.map(identityOf), 'the full row sequence: identity, action and values of every row').toEqual([
        [ledger.nullTime, 'trees', '9001', 'TreeTag', 'U', 'N1', 'N2'],
        [ledger.beforeWindow, 'quadrats', '501', 'QuadratID', 'I', '', 501],
        [ledger.beforeWindow, 'quadrats', '501', 'QuadratName', 'I', '', 'EXPORT-Q-BEFORE'],
        [ledger.fileUpload, 'file_upload', fileUploadRecordID, SUMMARY_COLUMN_MARKER, 'I', '', ''],
        [ledger.siteWide, 'species', '8801', 'SpeciesCode', 'U', 'OLDCODE', 'NEWCODE'],
        [ledger.speciesEdit, 'trees', '7001', 'SpeciesID', 'U', speciesBefore.speciesID, speciesAfter.speciesID],
        [firstUploadMember, 'coremeasurements', UPLOAD_FILE, SUMMARY_COLUMN_MARKER, 'I', '', ''],
        [ledger.quadratDelete, 'quadrats', '502', 'QuadratID', 'D', 502, ''],
        [ledger.quadratDelete, 'quadrats', '502', 'QuadratName', 'D', 'EXPORT-Q-GONE', ''],
        [ledger.oneSided, 'trees', '7003', SUMMARY_COLUMN_MARKER, 'U', '', ''],
        ...manualEntryRows,
        ...deleteRowsInLogIDOrder,
        [ledger.afterWindow, 'quadrats', '503', 'QuadratID', 'I', '', 503],
        [ledger.afterWindow, 'quadrats', '503', 'QuadratName', 'I', '', 'EXPORT-Q-AFTER']
      ]);

      const byLogID = (logID: number) => rows.filter(row => row.LogID === logID);
      const [nullTimeRow] = byLogID(ledger.nullTime);
      expect([nullTimeRow.ChangeDate, nullTimeRow.ChangeTime], 'a NULL timestamp is blank and sorts first').toEqual(['', '']);

      const fileUploadRows = byLogID(ledger.fileUpload);
      expect(fileUploadRows, 'the file_upload row is read once although its timestamp moved past the last page').toHaveLength(1);
      expect(fileUploadRows[0].ChangeTime, 'the snapshot’s time, not the second chunk’s').toBe(TIME_WINDOW_START);
      expect(fileUploadRows[0].Description, 'the snapshot’s counts, not the second chunk’s').toBe(
        `Uploaded ${FILE_UPLOAD_NAME} (measurements, csv): ${FIRST_CHUNK.rowCount} rows staged, ${FIRST_CHUNK.droppedCount} dropped, in 1 chunk(s)`
      );

      const [siteWideRow] = byLogID(ledger.siteWide);
      expect([siteWideRow.PlotID, siteWideRow.ChangedBy], 'a change with no plot scope has a blank PlotID').toEqual(['', SEED_CHANGED_BY]);

      const [speciesEditRow] = byLogID(ledger.speciesEdit);
      expect(speciesEditRow.Description, 'current species codes for both IDs').toBe(
        `Changed SpeciesID on trees 7001 (${speciesBefore.speciesCode} -> ${speciesAfter.speciesCode})`
      );
      expect([speciesEditRow.ChangeDate, speciesEditRow.ChangeTime, speciesEditRow.PlotID]).toEqual([
        TIME_SHARED.slice(0, CHANGE_DATE_LENGTH),
        TIME_SHARED,
        plotID
      ]);

      const [uploadRow] = byLogID(firstUploadMember);
      expect(uploadRow.Description, 'two sub-batches of one upload are one group').toBe(
        `Upload ${UPLOAD_FILE}: added ${ledger.uploadMembers.length} measurement rows (batch ${UPLOAD_BASE_BATCH})`
      );
      expect(uploadRow.ChangeTime, 'a rollup takes the time of its lowest ChangeID').toBe(TIME_SHARED);
      expect([uploadRow.PlotID, uploadRow.CensusID]).toEqual([plotID, censusID]);

      expect(byLogID(ledger.oneSided)[0].Description).toBe('Updated trees 7003; no field values were recorded');
      expect(byLogID(ledger.replacementDeletes.tagged)[0].Description).toBe(
        `Upload pipeline removed 1 measurements originally loaded from ${UPLOAD_FILE} (original batch ${UPLOAD_BASE_BATCH})`
      );
      expect(byLogID(ledger.replacementDeletes.untagged)[0].Description).toBe(
        'Upload pipeline removed 1 measurements originally loaded from no file recorded (no batch recorded)'
      );

      const exportedLogIDs = new Set(rows.map(row => row.LogID));
      expect(exportedLogIDs.has(ledger.otherPlot), 'another plot’s change is absent').toBe(false);
      expect(exportedLogIDs.has(ledger.suppressed), 'a paired update differing only in an excluded field has no row (D11)').toBe(false);

      const rollupLogIDs = new Set<ExportCell>([firstUploadMember, ledger.replacementDeletes.tagged, ledger.replacementDeletes.untagged]);
      const detailLogIDs = [...exportedLogIDs].filter(logID => !rollupLogIDs.has(logID));
      const expectedRollupMembers = ledger.uploadMembers.length + 2;
      expect(snapshot.suppressedChangeCount, 'only the no-difference update is suppressed; the one-sided update is not').toBe(1);
      expect(snapshot.rollupMemberCount).toBe(expectedRollupMembers);
      expect(
        snapshot.detailChangeCount + snapshot.rollupMemberCount,
        'matching changes = distinct LogIDs of non-rollup rows + rollup member counts + suppressed changes (§6.2)'
      ).toBe(detailLogIDs.length + expectedRollupMembers + snapshot.suppressedChangeCount);

      const statements = ownedDouble.query.mock.calls.map(([sql]) => sql);
      expect(statements.slice(0, 3), 'the isolation level, then the READ ONLY begin, then the first read').toEqual([
        SNAPSHOT_ISOLATION_STATEMENT,
        SNAPSHOT_BEGIN_STATEMENT,
        expect.stringContaining(DETAIL_PAGE_ORDER)
      ]);
      expect(ownedDouble.rollback, 'the read-only transaction is rolled back').toHaveBeenCalledTimes(1);
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
      expect(ownedDouble.destroy).not.toHaveBeenCalled();
    });

    it('puts every expected change in exactly one of the detail query and the rollup, and no other plot’s change in either', async () => {
      const ledger = await seedLedger();
      const nullState = await seed.insertRawChange({
        tableName: 'coremeasurements',
        recordID: '424242',
        operation: ChangelogOperation.INSERT,
        changeTime: TIME_SHARED
      });

      // The expected set: every seeded change the request's filters match, listed from the seed's own bookkeeping.
      const expectedUploadRows = [...ledger.uploadMembers, ledger.replacementDeletes.tagged, ledger.replacementDeletes.untagged];
      const expectedDetailRows = [
        ledger.nullTime,
        ledger.beforeWindow,
        ledger.fileUpload,
        ledger.siteWide,
        ledger.speciesEdit,
        ledger.quadratDelete,
        ledger.suppressed,
        ledger.oneSided,
        ledger.manualEntry,
        ledger.afterWindow,
        nullState
      ];

      const classified = await classifyChanges(connection, schema, [...expectedUploadRows, ...expectedDetailRows, ledger.otherPlot, ...ledger.otherPlotUpload]);
      const classification = new Map(classified.map(change => [change.changeID, change]));
      console.log(`[change-export] classification:\n${classified.map(change => JSON.stringify(change)).join('\n')}`);

      for (const changeID of expectedUploadRows) {
        expect(classification.get(changeID), `upload-pipeline row ${changeID}`).toMatchObject({ isUploadPipelineRow: true, isDetailRow: false });
      }
      for (const changeID of expectedDetailRows) {
        expect(classification.get(changeID), `field-level row ${changeID}`).toMatchObject({ isUploadPipelineRow: false, isDetailRow: true });
      }
      expect(classification.get(nullState), 'a SQL NULL state makes the predicate NULL: detail, never lost').toMatchObject({ isDetailRow: true });
      expect(classification.get(ledger.manualEntry), 'manual entry has the snapshot shape and stays field-level').toMatchObject({ isUploadPipelineRow: false });

      // The predicate does not look at which plot is selected: another plot's rows classify like any others.
      expect(classification.get(ledger.otherPlot), 'another plot’s grid change is a detail-shaped row').toMatchObject({
        isUploadPipelineRow: false,
        isDetailRow: true
      });
      for (const changeID of ledger.otherPlotUpload) {
        expect(classification.get(changeID), `another plot’s upload row ${changeID} is upload-shaped`).toMatchObject({
          isUploadPipelineRow: true,
          isDetailRow: false
        });
      }

      const snapshot = await readSnapshot();
      // It is the plot filter that keeps them out, of both queries.
      expect(snapshot.detailChangeCount, 'the detail pages read exactly the expected field-level set; the other plot’s grid change is not in it').toBe(
        expectedDetailRows.length
      );
      expect(snapshot.rollupMemberCount, 'the rollup counts exactly the expected upload set; the other plot’s upload is in no group').toBe(
        expectedUploadRows.length
      );
      const exportedLogIDs = new Set(toExportedRows(snapshot.rows).map(row => row.LogID));
      for (const changeID of [ledger.otherPlot, ...ledger.otherPlotUpload]) {
        expect(exportedLogIDs.has(changeID), `other-plot change ${changeID} is absent from the rows`).toBe(false);
      }
    });

    it.each([
      {
        label: 'From only',
        filters: { changedFrom: WINDOW_FROM },
        absent: ['nullTime', 'beforeWindow'] as const,
        present: ['fileUpload', 'afterWindow'] as const
      },
      {
        label: 'To only',
        filters: { changedTo: WINDOW_TO },
        absent: ['nullTime', 'afterWindow'] as const,
        present: ['beforeWindow', 'fileUpload'] as const
      },
      {
        label: 'From and To',
        filters: { changedFrom: WINDOW_FROM, changedTo: WINDOW_TO },
        absent: ['nullTime', 'beforeWindow', 'afterWindow'] as const,
        present: ['fileUpload', 'manualEntry'] as const
      }
    ])('$label keeps the change at each boundary second on the right side', async ({ filters, absent, present }) => {
      const ledger = await seedLedger();
      const rows = await readRows(filters);
      const exportedLogIDs = new Set(rows.map(row => row.LogID));

      for (const name of absent) expect(exportedLogIDs.has(ledger[name]), `${name} is outside ${JSON.stringify(filters)}`).toBe(false);
      for (const name of present) expect(exportedLogIDs.has(ledger[name]), `${name} is inside ${JSON.stringify(filters)}`).toBe(true);

      const uploadRow = rows.find(row => row.LogID === Math.min(...ledger.uploadMembers));
      expect(String(uploadRow?.Description).endsWith(FILTERED_COUNT_SUFFIX), 'a date bound marks rollup counts as filtered').toBe(true);
      if ('changedTo' in filters) {
        expect(exportedLogIDs.has(ledger.replacementDeletes.tagged), 'the last second of the To day is included').toBe(true);
      }
    });

    it('finds one change by #ChangeID', async () => {
      const ledger = await seedLedger();
      const rows = await readRows({ quickSearch: `#${ledger.quadratDelete}` });
      expect(rows.map(identityOf)).toEqual([
        [ledger.quadratDelete, 'quadrats', '502', 'QuadratID', 'D', 502, ''],
        [ledger.quadratDelete, 'quadrats', '502', 'QuadratName', 'D', 'EXPORT-Q-GONE', '']
      ]);
    });

    it('keeps two uploads of one file name apart by base batch', async () => {
      await seed.insertMeasurement(UPLOAD_FILE, 'attemptone__sub001', 'EXPORT-A1', 51);
      await seed.insertMeasurement(UPLOAD_FILE, 'attempttwo__sub001', 'EXPORT-A2', 52);
      const [firstAttempt] = await seed.auditCommittedUpload(UPLOAD_FILE, 'attemptone__sub001', plotID, TIME_SHARED);
      const [secondAttempt] = await seed.auditCommittedUpload(UPLOAD_FILE, 'attempttwo__sub001', plotID, TIME_SHARED);

      const rows = await readRows();

      expect(
        rows.map(row => [row.LogID, row.PrimaryKey, row.Description]),
        'the same file name under two base batches is two uploads'
      ).toEqual([
        [firstAttempt, UPLOAD_FILE, `Upload ${UPLOAD_FILE}: added 1 measurement rows (batch attemptone)`],
        [secondAttempt, UPLOAD_FILE, `Upload ${UPLOAD_FILE}: added 1 measurement rows (batch attempttwo)`]
      ]);
    });

    it('keeps upload summaries of people whose names differ only by accent or case apart', async () => {
      const ACCENT_CASE_NAMES = ['José', 'Jose', 'JOSE'];
      const SUMMARY_BATCH = 'accentbatch__sub001';
      for (const [index] of ACCENT_CASE_NAMES.entries()) await seed.insertMeasurement(UPLOAD_FILE, SUMMARY_BATCH, `EXPORT-ACCENT-${index}`, 61 + index);
      const changeIDs = await seed.auditCommittedUpload(UPLOAD_FILE, SUMMARY_BATCH, plotID, TIME_SHARED);
      expect(changeIDs, 'one audit row per measurement').toHaveLength(ACCENT_CASE_NAMES.length);
      for (const [index, changeID] of changeIDs.entries()) {
        await connection.query('UPDATE unifiedchangelog SET ChangedBy = ? WHERE ChangeID = ?', [ACCENT_CASE_NAMES[index], changeID]);
      }

      const rows = await readRows();

      expect(
        rows.map(row => [row.LogID, row.ChangedBy, row.Description]),
        'the accent- and case-insensitive column collation must not merge three people into one summary'
      ).toEqual(
        changeIDs.map((changeID, index) => [changeID, ACCENT_CASE_NAMES[index], `Upload ${UPLOAD_FILE}: added 1 measurement rows (batch accentbatch)`])
      );
    });
  });

  describe('shapes no current writer produces', () => {
    it('pairs legacy arrays by key and reports scalar states as unavailable images', async () => {
      const legacy = await seed.insertRawChange({
        tableName: 'trees',
        recordID: '1|2',
        operation: ChangelogOperation.UPDATE,
        oldRowState: [
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 10 }
        ],
        newRowState: [
          { TreeID: 2, SpeciesID: 30 },
          { TreeID: 1, SpeciesID: 20 }
        ],
        changeTime: '2026-03-10 01:00:00'
      });
      const scalar = await seed.insertRawChange({
        tableName: 'stems',
        recordID: '77',
        operation: ChangelogOperation.UPDATE,
        newRowState: 5,
        changeTime: '2026-03-10 02:00:00'
      });
      const arrayOfScalar = await seed.insertRawChange({
        tableName: 'stems',
        recordID: '78',
        operation: ChangelogOperation.DELETE,
        oldRowState: [{ StemGUID: 78 }, 7],
        changeTime: '2026-03-10 03:00:00'
      });

      const rows = await readRows();
      expect(rows.map(identityOf)).toEqual([
        [legacy, 'trees', '1', 'SpeciesID', 'U', 10, 20],
        [legacy, 'trees', '2', 'SpeciesID', 'U', 10, 30],
        [scalar, 'stems', '77', SUMMARY_COLUMN_MARKER, 'U', '', ''],
        [arrayOfScalar, 'stems', '78', SUMMARY_COLUMN_MARKER, 'D', '', '']
      ]);
      expect(rows[2].Description).toBe('UPDATE on stems 77 was recorded; row images are unavailable');
      expect(rows[3].Description).toBe('DELETE on stems 78 was recorded; row images are unavailable');
    });

    it('reports a stored JSON string that looks like a row as unavailable images, next to a genuine object row', async () => {
      const OBJECT_LOOKING_TEXT = '{"TreeID":7}';
      const stringScalar = await seed.insertRawChange({
        tableName: 'trees',
        recordID: '7',
        operation: ChangelogOperation.INSERT,
        newRowState: OBJECT_LOOKING_TEXT,
        changeTime: '2026-03-10 01:00:00'
      });
      const genuineObject = await seed.insertRawChange({
        tableName: 'trees',
        recordID: '8',
        operation: ChangelogOperation.INSERT,
        newRowState: { TreeID: 8 },
        changeTime: '2026-03-10 02:00:00'
      });
      const [storedType] = await connection.query<RowDataPacket[]>('SELECT JSON_TYPE(NewRowState) AS storedType FROM unifiedchangelog WHERE ChangeID = ?', [
        stringScalar
      ]);
      expect(storedType[0].storedType, 'the fixture must be a JSON string scalar, not an object').toBe('STRING');

      const rows = await readRows();

      expect(rows.map(identityOf)).toEqual([
        [stringScalar, 'trees', '7', SUMMARY_COLUMN_MARKER, 'I', '', ''],
        [genuineObject, 'trees', '8', 'TreeID', 'I', '', 8]
      ]);
      expect(rows[0].Description).toBe('INSERT on trees 7 was recorded; row images are unavailable');
    });

    it('keeps a file named "null" apart from a missing file id', async () => {
      const snapshotWithFileID = (fileID: unknown, measurementID: number) => ({
        CoreMeasurementID: measurementID,
        StemGUID: null,
        CensusID: censusID,
        MeasuredDBH: 10,
        UploadFileID: fileID,
        UploadBatchID: 'rawbatch__sub001'
      });
      const seedSnapshotRow = (fileID: unknown, measurementID: number) =>
        seed.insertRawChange({
          tableName: 'coremeasurements',
          recordID: String(measurementID),
          operation: ChangelogOperation.INSERT,
          newRowState: snapshotWithFileID(fileID, measurementID),
          changeTime: TIME_SHARED
        });
      const jsonNullFile = await seedSnapshotRow(null, 901);
      const fileNamedNull = await seedSnapshotRow('null', 902);
      const emptyFile = await seedSnapshotRow('', 903);

      const rows = await readRows();
      expect(
        rows.map(row => [row.LogID, row.PrimaryKey, row.Description]),
        'JSON null and "" share the no-file bucket; the file named null rolls up under null'
      ).toEqual([
        [Math.min(jsonNullFile, emptyFile), NO_FILE_RECORDED_KEY, 'Upload no file recorded: added 2 measurement rows (batch rawbatch)'],
        [fileNamedNull, 'null', 'Upload null: added 1 measurement rows (batch rawbatch)']
      ]);
    });

    it('computes the base batch exactly as familyRootOf does', async () => {
      // No uppercase suffix case: under a _ci collation ICU REGEXP ignores case, a known divergence from familyRootOf.
      const batchIDs = ['run', 'run__sub001', 'run__subset', 'a__sub001__sub002', 'x__sub0012', 'run__sub001\n'];
      const changeIDs: number[] = [];
      for (const batchID of batchIDs) {
        changeIDs.push(
          await seed.insertRawChange({
            tableName: 'coremeasurements',
            recordID: String(changeIDs.length + 1),
            operation: ChangelogOperation.INSERT,
            newRowState: { UploadFileID: 'parity.csv', UploadBatchID: batchID },
            changeTime: TIME_SHARED
          })
        );
      }
      const baseBatch = buildBaseBatchExpression();
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT uc.ChangeID, ${baseBatch.sql} AS BaseBatchID FROM unifiedchangelog uc WHERE uc.ChangeID IN (?) ORDER BY uc.ChangeID`,
        [...baseBatch.params, changeIDs]
      );
      const sqlBaseBatches = rows.map(row => String(row.BaseBatchID));
      expect(sqlBaseBatches, 'REGEXP_REPLACE with the \\z anchor must agree with familyRootOf on every id').toEqual(batchIDs.map(familyRootOf));
      expect(sqlBaseBatches[batchIDs.indexOf('run__sub001\n')], 'ICU’s $ would strip the suffix before a final line break').toBe('run__sub001\n');
    });
  });

  describe('the snapshot transaction', () => {
    it('is read-only: a write on the owned connection inside the snapshot is refused by MySQL', async () => {
      await seed.insertRawChange({
        tableName: 'trees',
        recordID: '1401',
        operation: ChangelogOperation.UPDATE,
        oldRowState: { TreeID: 1401, TreeTag: 'before' },
        newRowState: { TreeID: 1401, TreeTag: 'after' },
        changeTime: TIME_SHARED
      });
      let writeAttemptCode: string | undefined;
      afterOwnedQuery = async sql => {
        if (!sql.includes(DETAIL_PAGE_ORDER)) return;
        await ownedConnection.query('UPDATE unifiedchangelog SET ChangedBy = ?', ['written-inside-snapshot']).catch((error: { code?: string }) => {
          writeAttemptCode = error.code;
        });
      };

      await readSnapshot();

      expect(writeAttemptCode, 'the first statement must open the transaction READ ONLY').toBe(READ_ONLY_VIOLATION_CODE);
      const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS written FROM unifiedchangelog WHERE ChangedBy = ?', [
        'written-inside-snapshot'
      ]);
      expect(Number(rows[0].written), 'nothing was written').toBe(0);
    });
  });

  describe('keyset paging', () => {
    const NULL_TIME_COUNT = 3;
    const TIED_TIME_COUNT = 3;
    const LATER_TIME_COUNT = 2;
    const LATER_TIMES = ['2026-03-10 12:00:01', '2026-03-10 12:00:02'];

    async function seedSingleRowChange(recordID: number, changeTime: string | null): Promise<number> {
      return seed.insertRawChange({
        tableName: 'trees',
        recordID: String(recordID),
        operation: ChangelogOperation.UPDATE,
        oldRowState: { TreeID: recordID, TreeTag: 'before' },
        newRowState: { TreeID: recordID, TreeTag: 'after' },
        changeTime
      });
    }

    /** Tied and later rows are inserted first so ChangeID order and time order disagree about where the NULL rows go. */
    async function seedNullTimesAndTies(): Promise<{ nullTimed: number[]; tied: number[]; later: number[] }> {
      const tied: number[] = [];
      for (let index = 0; index < TIED_TIME_COUNT; index += 1) tied.push(await seedSingleRowChange(1100 + index, TIME_SHARED));
      const later: number[] = [];
      for (let index = 0; index < LATER_TIME_COUNT; index += 1) later.push(await seedSingleRowChange(1200 + index, LATER_TIMES[index]));
      const nullTimed: number[] = [];
      for (let index = 0; index < NULL_TIME_COUNT; index += 1) nullTimed.push(await seedSingleRowChange(1300 + index, null));
      return { nullTimed, tied, later };
    }

    it.each([1, 2, 3])('with a page size of %i reads every change once: NULL times first, then by time, ties by ChangeID', async pageSize => {
      const { nullTimed, tied, later } = await seedNullTimesAndTies();

      const snapshot = await readSnapshot({}, { maxRows: GENEROUS_LIMITS.maxRows, pageSize });

      const logIDs = toExportedRows(snapshot.rows).map(row => row.LogID);
      console.log(`[change-export] page size ${pageSize} read LogIDs ${JSON.stringify(logIDs)}`);
      expect(logIDs, 'each ChangeID once, in (ChangeTimestamp, ChangeID) order with NULL first').toEqual([...nullTimed, ...tied, ...later]);
      expect(snapshot.detailChangeCount).toBe(NULL_TIME_COUNT + TIED_TIME_COUNT + LATER_TIME_COUNT);
    });
  });

  describe('the row ceiling', () => {
    const TIGHT_LIMITS: ChangeExportLimits = { maxRows: 2, pageSize: 2 };

    async function seedThreeFieldInsert(): Promise<void> {
      await seed.recordGridChange({
        tableName: 'quadrats',
        recordID: 601,
        operation: ChangelogOperation.INSERT,
        newRowState: { QuadratID: 601, QuadratName: 'CEILING-Q', Area: 400 },
        plotID,
        changeTime: TIME_SHARED
      });
    }

    async function expectTooLarge(pendingSnapshot: Promise<ChangeExportSnapshot>, maxRows: number): Promise<void> {
      const failure = await pendingSnapshot.catch((error: unknown) => error);
      expect(failure, `expected ExportTooLargeError, got ${String(failure)}`).toBeInstanceOf(ExportTooLargeError);
      expect((failure as ExportTooLargeError).maxRows).toBe(maxRows);
      expect(ownedDouble.rollback, 'the transaction is rolled back when the ceiling is passed').toHaveBeenCalledTimes(1);
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
    }

    it('allows exactly the limit', async () => {
      await seedThreeFieldInsert();
      const snapshot = await readSnapshot({}, { maxRows: 3, pageSize: 2 });
      expect(snapshot.rows).toHaveLength(3);
    });

    it('fails on the first row past the limit', async () => {
      await seedThreeFieldInsert();
      await expectTooLarge(readSnapshot({}, TIGHT_LIMITS), TIGHT_LIMITS.maxRows);
    });

    it('stops inside a single multi-image change at the first excess row', async () => {
      await seed.insertRawChange({
        tableName: 'trees',
        recordID: '1|2|3',
        operation: ChangelogOperation.UPDATE,
        oldRowState: [
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 10 },
          { TreeID: 3, SpeciesID: 10 }
        ],
        newRowState: [
          { TreeID: 1, SpeciesID: 11 },
          { TreeID: 2, SpeciesID: 12 },
          { TreeID: 3, SpeciesID: 13 }
        ],
        changeTime: TIME_SHARED
      });
      await expectTooLarge(readSnapshot({}, TIGHT_LIMITS), TIGHT_LIMITS.maxRows);
      const rollupQueries = ownedDouble.query.mock.calls.filter(([sql]) => String(sql).includes(ROLLUP_MARKER));
      expect(rollupQueries, 'the reader stopped at the third row; it never went on to the rollup').toHaveLength(0);
    });

    it('caps the rollup SELECT at one group past the ceiling and fails on the overflow', async () => {
      await seed.recordGridChange({
        tableName: 'quadrats',
        recordID: 602,
        operation: ChangelogOperation.INSERT,
        newRowState: { QuadratName: 'ONE-FIELD' },
        plotID,
        changeTime: TIME_SHARED
      });
      for (const fileID of ['ceiling-a.csv', 'ceiling-b.csv', 'ceiling-c.csv']) {
        await seed.insertRawChange({
          tableName: 'coremeasurements',
          recordID: fileID,
          operation: ChangelogOperation.INSERT,
          newRowState: { UploadFileID: fileID, UploadBatchID: 'ceilingbatch' },
          changeTime: TIME_SHARED
        });
      }
      await expectTooLarge(readSnapshot({}, TIGHT_LIMITS), TIGHT_LIMITS.maxRows);
      const [rollupQuery] = ownedDouble.query.mock.calls.filter(([sql]) => String(sql).includes(ROLLUP_MARKER));
      const rollupParams = rollupQuery[1] as unknown[];
      expect(rollupParams[rollupParams.length - 1], 'LIMIT = maxRows - rows so far + 1 = 2 - 1 + 1').toBe(2);
    });
  });

  describe('failure and cleanup', () => {
    const SECRET_DRIVER_MESSAGE = 'Deadlock found near SECRET-DRIVER-TEXT';
    const DRIVER_CODE = 'ER_LOCK_DEADLOCK';
    const ROLLBACK_DRIVER_CODE = 'PROTOCOL_CONNECTION_LOST';

    async function seedThreeChanges(): Promise<void> {
      for (const recordID of [611, 612, 613]) {
        await seed.recordGridChange({
          tableName: 'quadrats',
          recordID,
          operation: ChangelogOperation.INSERT,
          newRowState: { QuadratName: `FAILURE-Q-${recordID}` },
          plotID,
          changeTime: TIME_SHARED
        });
      }
    }

    function failSecondDetailPage(): void {
      let detailPagesRead = 0;
      ownedDouble.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes(DETAIL_PAGE_ORDER)) {
          detailPagesRead += 1;
          if (detailPagesRead === 2) throw Object.assign(new Error(SECRET_DRIVER_MESSAGE), { code: DRIVER_CODE });
        }
        return ownedConnection.query(sql, params);
      });
    }

    function failRollback(): void {
      ownedDouble.rollback.mockImplementation(async () => {
        await ownedConnection.rollback();
        throw Object.assign(new Error('rollback lost the connection near SECRET-DRIVER-TEXT'), { code: ROLLBACK_DRIVER_CODE });
      });
    }

    async function readFailure(): Promise<ChangeExportReadError> {
      const failure = await readSnapshot().catch((error: unknown) => error);
      expect(failure, `expected ChangeExportReadError, got ${String(failure)}`).toBeInstanceOf(ChangeExportReadError);
      return failure as ChangeExportReadError;
    }

    function loggedText(): string {
      return mocks.logError.mock.calls
        .flat()
        .map(argument => (argument instanceof Error ? `${argument.message}\n${argument.stack}` : JSON.stringify(argument)))
        .join('\n');
    }

    it('throws a read error naming the stage and driver code, rolls back and releases', async () => {
      await seedThreeChanges();
      failSecondDetailPage();

      const failure = await readFailure();

      expect([failure.stage, failure.driverCode]).toEqual(['detail', DRIVER_CODE]);
      expect(failure.message, 'the driver’s message can quote row data and is not carried').not.toContain('SECRET-DRIVER-TEXT');
      expect(ownedDouble.rollback).toHaveBeenCalledTimes(1);
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
      expect(ownedDouble.destroy).not.toHaveBeenCalled();
    });

    it('destroys the connection when rollback also fails and still throws the original read error', async () => {
      await seedThreeChanges();
      failSecondDetailPage();
      failRollback();

      const failure = await readFailure();

      expect([failure.stage, failure.driverCode], 'the cleanup failure does not replace the read failure').toEqual(['detail', DRIVER_CODE]);
      expect(ownedDouble.destroy, 'a connection whose rollback failed must not go back to the pool').toHaveBeenCalledTimes(1);
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
      expect(mocks.logError, 'the rollback failure is logged once').toHaveBeenCalledTimes(1);
      expect(mocks.logError.mock.calls[0][2]).toEqual({ schema, plotID, driverCode: ROLLBACK_DRIVER_CODE });
      expect(loggedText()).not.toContain('SECRET-DRIVER-TEXT');
    });

    it('returns the rows when only the cleanup fails', async () => {
      await seedThreeChanges();
      failRollback();

      const snapshot = await readSnapshot();

      expect(snapshot.rows, 'a cleanup failure never replaces a result already decided').toHaveLength(3);
      expect(ownedDouble.destroy).toHaveBeenCalledTimes(1);
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
    });

    describe('when cleanup itself throws', () => {
      const CLEANUP_FAILURE_MESSAGE = 'cleanup step threw after SECRET-DRIVER-TEXT';
      const CLEANUP_DRIVER_CODE = 'ER_CLEANUP_STEP';

      function throwFromCleanup(): never {
        throw Object.assign(new Error(CLEANUP_FAILURE_MESSAGE), { code: CLEANUP_DRIVER_CODE });
      }

      it('still returns the rows and releases when the logger throws while a failed rollback is reported', async () => {
        await seedThreeChanges();
        failRollback();
        mocks.logError.mockImplementation(throwFromCleanup);

        const snapshot = await readSnapshot();

        expect(snapshot.rows, 'the logger’s failure never replaces a result already decided').toHaveLength(3);
        expect(ownedDouble.destroy, 'the connection is destroyed even though the log line could not be written').toHaveBeenCalledTimes(1);
        expect(ownedDouble.release).toHaveBeenCalledTimes(1);
      });

      it('still throws the read error and releases when destroy throws after a failed rollback', async () => {
        await seedThreeChanges();
        failSecondDetailPage();
        failRollback();
        ownedDouble.destroy.mockImplementation(throwFromCleanup);

        const failure = await readFailure();

        expect([failure.stage, failure.driverCode], 'the read failure survives a throwing destroy').toEqual(['detail', DRIVER_CODE]);
        expect(ownedDouble.release, 'the connection is still released').toHaveBeenCalledTimes(1);
        expect(
          mocks.logError.mock.calls.map(call => [call[0], call[2]]),
          'the rollback failure and the destroy failure are each logged once, with the driver code only'
        ).toEqual([
          ['Change export rollback failed', { schema, plotID, driverCode: ROLLBACK_DRIVER_CODE }],
          ['Change export connection destroy failed', { schema, plotID, driverCode: CLEANUP_DRIVER_CODE }]
        ]);
        expect(loggedText()).not.toContain('SECRET-DRIVER-TEXT');
      });

      it('still returns the rows when release throws', async () => {
        await seedThreeChanges();
        ownedDouble.release.mockImplementation(throwFromCleanup);

        const snapshot = await readSnapshot();

        expect(snapshot.rows, 'a release failure never replaces a result already decided').toHaveLength(3);
        expect(ownedDouble.release).toHaveBeenCalledTimes(1);
        expect(
          mocks.logError.mock.calls.map(call => [call[0], call[2]]),
          'the release failure is logged once, with the driver code only'
        ).toEqual([['Change export connection release failed', { schema, plotID, driverCode: CLEANUP_DRIVER_CODE }]]);
        expect(loggedText()).not.toContain('SECRET-DRIVER-TEXT');
      });
    });

    it('fails at stage begin when the isolation level cannot be set, and releases without a rollback', async () => {
      ownedDouble.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql === SNAPSHOT_ISOLATION_STATEMENT) throw Object.assign(new Error(SECRET_DRIVER_MESSAGE), { code: DRIVER_CODE });
        return ownedConnection.query(sql, params);
      });

      const failure = await readFailure();

      expect([failure.stage, failure.driverCode]).toEqual(['begin', DRIVER_CODE]);
      expect(
        ownedDouble.query.mock.calls.map(([sql]) => sql),
        'no transaction is opened at the wrong isolation level'
      ).toEqual([SNAPSHOT_ISOLATION_STATEMENT]);
      expect(ownedDouble.rollback, 'there is no transaction to roll back').not.toHaveBeenCalled();
      expect(ownedDouble.destroy, 'nothing was set on the session, so the connection is reusable').not.toHaveBeenCalled();
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
    });

    describe('when the transaction cannot be started after the isolation level was set', () => {
      beforeEach(() => {
        ownedDouble.query.mockImplementation(async (sql: string, params?: unknown[]) => {
          if (sql === SNAPSHOT_BEGIN_STATEMENT) throw Object.assign(new Error(SECRET_DRIVER_MESSAGE), { code: DRIVER_CODE });
          return ownedConnection.query(sql, params);
        });
      });

      it('fails at stage begin with the driver code and does not roll back a transaction that never opened', async () => {
        const failure = await readFailure();

        expect([failure.stage, failure.driverCode]).toEqual(['begin', DRIVER_CODE]);
        expect(failure.message).not.toContain('SECRET-DRIVER-TEXT');
        expect(ownedDouble.rollback).not.toHaveBeenCalled();
      });

      it('destroys the connection, because the one-shot isolation level would otherwise be spent by its next borrower', async () => {
        await readFailure();

        expect(ownedDouble.destroy).toHaveBeenCalledTimes(1);
        expect(ownedDouble.release).toHaveBeenCalledTimes(1);
      });

      it('never leaves the session read-only: a write on the same connection succeeds afterwards', async () => {
        await readFailure();

        await ownedConnection.query('START TRANSACTION');
        const writeAttempt = await ownedConnection
          .query('UPDATE unifiedchangelog SET ChangedBy = ?', ['written-after-failed-begin'])
          .then(() => undefined)
          .catch((error: { code?: string }) => error.code);
        await ownedConnection.query('ROLLBACK');

        expect(writeAttempt, 'a failed begin must not leave READ ONLY pending for the connection’s next transaction').toBeUndefined();
      });
    });

    it.each([
      { stage: 'rollup', failingSql: ROLLUP_MARKER },
      { stage: 'labels', failingSql: LABEL_QUERY_MARKER }
    ] as const)('throws a read error at stage $stage with the driver code, rolls back and releases', async ({ stage, failingSql }) => {
      const [speciesBefore, speciesAfter] = await twoSeededSpecies();
      await seed.recordGridChange({
        tableName: 'trees',
        recordID: 7101,
        operation: ChangelogOperation.UPDATE,
        oldRowState: { TreeID: 7101, SpeciesID: speciesBefore.speciesID },
        newRowState: { TreeID: 7101, SpeciesID: speciesAfter.speciesID },
        plotID,
        changeTime: TIME_SHARED
      });
      ownedDouble.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes(failingSql)) throw Object.assign(new Error(SECRET_DRIVER_MESSAGE), { code: DRIVER_CODE });
        return ownedConnection.query(sql, params);
      });

      const failure = await readFailure();

      expect([failure.stage, failure.driverCode]).toEqual([stage, DRIVER_CODE]);
      expect(failure.message, 'the driver’s message can quote row data and is not carried').not.toContain('SECRET-DRIVER-TEXT');
      expect(ownedDouble.rollback).toHaveBeenCalledTimes(1);
      expect(ownedDouble.release).toHaveBeenCalledTimes(1);
      expect(ownedDouble.destroy).not.toHaveBeenCalled();
    });

    it('fails at stage acquire, with no driver code, when no connection can be had', async () => {
      mocks.getConn.mockRejectedValue(new Error('connect ETIMEDOUT 10.0.0.5:3306'));

      const failure = await readFailure();

      expect([failure.stage, failure.driverCode]).toEqual(['acquire', undefined]);
      expect(failure.message).not.toContain('10.0.0.5');
      expect(ownedDouble.release, 'nothing was acquired, so nothing is released').not.toHaveBeenCalled();
    });
  });
});
