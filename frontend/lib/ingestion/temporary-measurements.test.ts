import { describe, expect, it, vi } from 'vitest';
import {
  buildTemporaryMeasurementInsertRecord,
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  cleanupPreviousFileUploads,
  cleanupStaleMeasurementBatchesForFile,
  CoreMeasurementWindowTooLargeError,
  CENSUS_REPLACEMENT_SCAN_INDEX,
  deleteCensusReplacementChunk,
  deleteCoreMeasurementsInBoundedChunksWithAudit,
  familyHasStagedRows,
  findDroppedMeasurementCandidates,
  isUnsignedIntFieldInvalid,
  lockAuditAndDeleteCoreMeasurementWindow,
  MYSQL_UNSIGNED_INT_MAX,
  parseUnsignedIntField
} from './temporary-measurements';
import { SourceFormat } from '@/config/macros/formdetails';
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { FileRow } from '@/config/macros/formdetails';
import { buildSubBatchPattern } from '@/lib/uploads/batch-family';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe('parseUnsignedIntField', () => {
  it('parses positive integers within the MySQL unsigned range', () => {
    expect(parseUnsignedIntField(5001)).toBe(5001);
    expect(parseUnsignedIntField('5001')).toBe(5001);
    expect(parseUnsignedIntField(MYSQL_UNSIGNED_INT_MAX)).toBe(MYSQL_UNSIGNED_INT_MAX);
  });

  it('returns null for absent or blank values', () => {
    expect(parseUnsignedIntField(undefined)).toBeNull();
    expect(parseUnsignedIntField(null)).toBeNull();
    expect(parseUnsignedIntField('')).toBeNull();
    expect(parseUnsignedIntField('   ')).toBeNull();
  });

  it('returns null for present-but-invalid values', () => {
    expect(parseUnsignedIntField('5,001')).toBeNull();
    expect(parseUnsignedIntField('STEM-5001')).toBeNull();
    expect(parseUnsignedIntField('5001x')).toBeNull();
    expect(parseUnsignedIntField(0)).toBeNull();
    expect(parseUnsignedIntField(-1)).toBeNull();
    expect(parseUnsignedIntField(12.3)).toBeNull();
    expect(parseUnsignedIntField(MYSQL_UNSIGNED_INT_MAX + 1)).toBeNull();
  });
});

describe('findDroppedMeasurementCandidates placeholder alignment', () => {
  const TEST_SCHEMA = 'forestgeo_testing';
  const TEST_FILE_NAME = 'SERC_census1_2025.csv';
  const TEST_ROW_BATCH_ID = 'batch-7__sub002';
  const TEST_PLOT_ID = 22;
  const TEST_CENSUS_ID = 32;
  const TEST_TRANSACTION_ID = 'tx-test';

  it('fills every ?? with the backticked schema and keeps value params aligned to the remaining ? slots', async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const connectionManager = { executeQuery } as unknown as ConnectionManager;

    await findDroppedMeasurementCandidates(
      connectionManager,
      TEST_SCHEMA,
      TEST_FILE_NAME,
      [TEST_ROW_BATCH_ID],
      TEST_PLOT_ID,
      TEST_CENSUS_ID,
      [{ tag: '100001', stemtag: '1', spcode: 'FAGR', quadrat: '1011', date: '2010-03-17' }] as FileRow[],
      TEST_TRANSACTION_ID
    );

    const droppedRowCall = executeQuery.mock.calls.find(call => String(call[0]).includes('MIN(dup.BatchID)'));
    expect(droppedRowCall, 'dropped-row audit query was never executed').toBeDefined();
    const [sql, params] = droppedRowCall!;

    // Regression guard for the mysql2 format() misfill this query shipped with:
    // format(sql, [schema, schema]) fills placeholders strictly in order, so the
    // second schema landed in the `tm.FileID = ?` value slot and the second ??
    // was later misfilled by a value param and treated as a database name.
    // safeFormatQuery must consume EVERY ?? so executeQuery sees only value slots.
    expect(sql).not.toContain('??');
    expect(String(sql).match(/`forestgeo_testing`\.temporarymeasurements/g)).toHaveLength(2);

    expect(String(sql).match(/\?/g)).toHaveLength(params.length);
    expect(params).toEqual([TEST_FILE_NAME, TEST_FILE_NAME, TEST_PLOT_ID, TEST_CENSUS_ID]);
    expect(params).not.toContain(TEST_SCHEMA);
    expect(params, 'the per-row BatchID belongs in the candidate table, not the join').not.toContain(TEST_ROW_BATCH_ID);
    expect(sql).toContain('tm.BatchID = drc.BatchID');

    const slotOrder = ['tm.FileID = ?', 'dup.FileID = ?', 'dup.PlotID = ?', 'dup.CensusID = ?'];
    const slotPositions = slotOrder.map(slot => String(sql).indexOf(slot));
    slotPositions.forEach((position, index) => expect(position, `missing value slot ${slotOrder[index]}`).toBeGreaterThan(-1));
    expect(slotPositions, 'value slots appear in a different order than the params array').toEqual([...slotPositions].sort((a, b) => a - b));
  });

  it("stores each row's own BatchID in the candidate column that the join reads", async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const connectionManager = { executeQuery } as unknown as ConnectionManager;
    const rowBatchIDs = ['batch-7__sub001', 'batch-7__sub002'];

    await findDroppedMeasurementCandidates(
      connectionManager,
      TEST_SCHEMA,
      TEST_FILE_NAME,
      rowBatchIDs,
      TEST_PLOT_ID,
      TEST_CENSUS_ID,
      [
        { tag: '100001', stemtag: '1', spcode: 'FAGR', quadrat: '1011', date: '2010-03-17' },
        { tag: '100002', stemtag: '1', spcode: 'FAGR', quadrat: '1011', date: '2010-03-17' }
      ] as FileRow[],
      TEST_TRANSACTION_ID
    );

    const candidateInsertCall = executeQuery.mock.calls.find(call => String(call[0]).startsWith('INSERT INTO dropped_row_candidates'));
    expect(candidateInsertCall, 'candidate rows were never inserted').toBeDefined();
    const [insertSQL, insertParams] = candidateInsertCall!;
    console.log('[candidate insert]', insertSQL, insertParams);

    const columns = String(insertSQL)
      .match(/\(([^)]*)\) VALUES/)![1]
      .split(',')
      .map(column => column.trim());
    expect(String(insertSQL).match(/\?/g)).toHaveLength(insertParams.length);
    const batchIDColumnIndex = columns.indexOf('BatchID');
    expect(batchIDColumnIndex, `BatchID missing from candidate columns ${columns.join(',')}`).toBeGreaterThan(-1);
    const insertedBatchIDs = rowBatchIDs.map((_, rowIndex) => insertParams[rowIndex * columns.length + batchIDColumnIndex]);
    expect(insertedBatchIDs).toEqual(rowBatchIDs);
  });

  it('rejects a BatchID list that does not match the rows before touching the database', async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const connectionManager = { executeQuery } as unknown as ConnectionManager;

    await expect(
      findDroppedMeasurementCandidates(
        connectionManager,
        TEST_SCHEMA,
        TEST_FILE_NAME,
        [],
        TEST_PLOT_ID,
        TEST_CENSUS_ID,
        [{ tag: '100001' }] as FileRow[],
        TEST_TRANSACTION_ID
      )
    ).rejects.toThrow(/1 row\(s\) but 0 BatchID/);
    await expect(
      findDroppedMeasurementCandidates(
        connectionManager,
        TEST_SCHEMA,
        TEST_FILE_NAME,
        [],
        TEST_PLOT_ID,
        TEST_CENSUS_ID,
        [{ tag: '100001' }] as FileRow[],
        TEST_TRANSACTION_ID
      )
    ).rejects.toMatchObject({ name: 'StagingBatchIDCountMismatchError', code: 'STAGING_BATCH_ID_COUNT_MISMATCH' });
    expect(executeQuery).not.toHaveBeenCalled();
  });
});

describe('family staging probes fail loud on an unreadable server answer', () => {
  const TEST_SCHEMA = 'forestgeo_testing';
  const TEST_FILE_NAME = 'SERC_census1_2025.csv';
  const TEST_BATCH_ID = 'batch-7';
  const TEST_TRANSACTION_ID = 'tx-test';

  it.each([[undefined], [{ affectedRows: 0 }], [null]])('familyHasStagedRows refuses to answer "not staged" when the server returns %j', async serverAnswer => {
    const executeQuery = vi.fn().mockResolvedValue(serverAnswer);
    const connectionManager = { executeQuery } as unknown as ConnectionManager;

    await expect(familyHasStagedRows(connectionManager, TEST_SCHEMA, TEST_FILE_NAME, TEST_BATCH_ID, TEST_TRANSACTION_ID)).rejects.toThrow(
      /expected a row list.*refusing to report the family as not staged/
    );
    expect(executeQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT 1'), [TEST_FILE_NAME, TEST_BATCH_ID, 'batch-7\\_\\_sub%'], TEST_TRANSACTION_ID);
  });

  it('cleanupStaleMeasurementBatchesForFile throws instead of reporting zero when the deleted count is unreadable', async () => {
    const executeQuery = vi.fn().mockResolvedValue({});
    const connectionManager = { executeQuery } as unknown as ConnectionManager;

    await expect(
      cleanupStaleMeasurementBatchesForFile(connectionManager, TEST_SCHEMA, TEST_FILE_NAME, TEST_BATCH_ID, 22, 32, TEST_TRANSACTION_ID)
    ).rejects.toThrow(/could not read a row count/i);
  });
});

describe('buildTemporaryMeasurementInsertRecord plot coordinates', () => {
  it('stages plot coordinates, and NULL when the file omits them', () => {
    const withCoords = buildTemporaryMeasurementInsertRecord(
      {
        tag: '1',
        stemtag: '1',
        spcode: 'ULMALA',
        quadrat: 'A01',
        lx: '5',
        ly: '5',
        px: '-0.271',
        py: '267.5',
        dbh: '20',
        hom: '1.3',
        date: '2026-01-20'
      } as any,
      'coords.csv',
      'batch-1',
      'session-1',
      SourceFormat.csv,
      1,
      2
    );
    expect(withCoords.PlotX).toBe(-0.271);
    expect(withCoords.PlotY).toBe(267.5);

    const without = buildTemporaryMeasurementInsertRecord(
      { tag: '1', stemtag: '1', spcode: 'ULMALA', quadrat: 'A01', lx: '5', ly: '5', dbh: '20', hom: '1.3', date: '2026-01-20' } as any,
      'coords.csv',
      'batch-1',
      'session-1',
      SourceFormat.csv,
      1,
      2
    );
    expect(without.PlotX, 'absent plot coordinate must stage NULL, never 0').toBeNull();
    expect(without.PlotY).toBeNull();
  });
});

describe('isUnsignedIntFieldInvalid', () => {
  it('is false for absent/blank values (a missing PublishedStemID is legitimately optional)', () => {
    expect(isUnsignedIntFieldInvalid(undefined)).toBe(false);
    expect(isUnsignedIntFieldInvalid(null)).toBe(false);
    expect(isUnsignedIntFieldInvalid('')).toBe(false);
    expect(isUnsignedIntFieldInvalid('   ')).toBe(false);
  });

  it('is false for values that parse to a valid unsigned int', () => {
    expect(isUnsignedIntFieldInvalid(5001)).toBe(false);
    expect(isUnsignedIntFieldInvalid('5001')).toBe(false);
  });

  it('is true only for present values that cannot be stored as an unsigned int', () => {
    // These are exactly the cases that were previously coerced to NULL and ingested silently.
    expect(isUnsignedIntFieldInvalid('5,001')).toBe(true);
    expect(isUnsignedIntFieldInvalid('STEM-5001')).toBe(true);
    expect(isUnsignedIntFieldInvalid('5001x')).toBe(true);
    expect(isUnsignedIntFieldInvalid(0)).toBe(true);
    expect(isUnsignedIntFieldInvalid(-1)).toBe(true);
    expect(isUnsignedIntFieldInvalid(12.3)).toBe(true);
  });
});

describe('cleanupPreviousFileUploads bounded-delete loop control', () => {
  const TEST_SCHEMA = 'forestgeo_testing';
  const TEST_FILE_NAME = 'replacement.csv';
  const TEST_BATCH_ID = 'incoming-batch-0001';
  const TEST_PLOT_ID = 22;
  const TEST_CENSUS_ID = 32;
  const TEST_CHANGED_BY = 'audit-test-user';
  const TEST_TRANSACTION_ID = 'tx-test';

  // #507 rewrote the coremeasurements delete from a single `DELETE ... LIMIT n`
  // per chunk into three statements per chunk — SELECT the chunk's own ids,
  // audit them, then DELETE by id — so every chunk's audit rows and deleted
  // rows are provably the same row set. These markers identify each of the
  // three statements in the executeQuery call log.
  const SELECT_IDS_MARKER = `SELECT /*+ INDEX(coremeasurements ${CENSUS_REPLACEMENT_SCAN_INDEX}) */ CoreMeasurementID FROM \`forestgeo_testing\`.coremeasurements`;
  const AUDIT_INSERT_MARKER = 'INSERT INTO `forestgeo_testing`.unifiedchangelog';
  const CM_DELETE_MARKER = 'DELETE FROM `forestgeo_testing`.coremeasurements WHERE CoreMeasurementID IN';
  const NOTHING_DELETED = { affectedRows: 0 };

  function makeIdsPage(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  interface MockOptions {
    /** Overrides the audit INSERT's result for a given page (0-indexed). Defaults to `{ affectedRows: page.length }`. */
    auditResult?: (page: number[], pageIndex: number) => unknown;
    /** Overrides the id-scoped DELETE's result for a given page (0-indexed). Defaults to `{ affectedRows: page.length }`. */
    deleteResult?: (page: number[], pageIndex: number) => unknown;
  }

  /**
   * Drives the SELECT-ids -> audit -> DELETE sequence with a scripted list of
   * id pages, one page per expected loop iteration. Every OTHER statement
   * (measurement_error_log, failedmeasurements, uploadmetrics deletes) reports
   * an empty window, so each assertion below is about the coremeasurements
   * path's reaction to ONE page/result shape.
   */
  function makeConnectionManager(idPages: number[][], options: MockOptions = {}) {
    const remainingPages = [...idPages];
    let lastPage: number[] = [];
    let pageIndex = -1;
    const executeQuery = vi.fn(async (sql: string) => {
      const sqlString = String(sql);
      if (sqlString.includes(SELECT_IDS_MARKER)) {
        if (remainingPages.length === 0) {
          throw new Error('bounded delete loop asked for more id pages than the test scripted — it did not terminate');
        }
        lastPage = remainingPages.shift()!;
        pageIndex += 1;
        return lastPage.map(id => ({ CoreMeasurementID: id }));
      }
      if (sqlString.includes(AUDIT_INSERT_MARKER)) {
        return options.auditResult ? options.auditResult(lastPage, pageIndex) : { affectedRows: lastPage.length };
      }
      if (sqlString.includes(CM_DELETE_MARKER)) {
        return options.deleteResult ? options.deleteResult(lastPage, pageIndex) : { affectedRows: lastPage.length };
      }
      return NOTHING_DELETED;
    });
    return { connectionManager: { executeQuery } as unknown as ConnectionManager, executeQuery };
  }

  function runCleanup(connectionManager: ConnectionManager) {
    return cleanupPreviousFileUploads(
      connectionManager,
      TEST_SCHEMA,
      TEST_FILE_NAME,
      TEST_BATCH_ID,
      TEST_PLOT_ID,
      TEST_CENSUS_ID,
      TEST_CHANGED_BY,
      TEST_TRANSACTION_ID
    );
  }

  function countCoreMeasurementDeletes(executeQuery: ReturnType<typeof vi.fn>): number {
    return executeQuery.mock.calls.filter(call => String(call[0]).includes(CM_DELETE_MARKER)).length;
  }

  function countAuditInserts(executeQuery: ReturnType<typeof vi.fn>): number {
    return executeQuery.mock.calls.filter(call => String(call[0]).includes(AUDIT_INSERT_MARKER)).length;
  }

  it('keeps requesting pages while the server keeps filling the limit, then stops after a short page and one confirming pass at cursor 0', async () => {
    const { connectionManager, executeQuery } = makeConnectionManager([
      makeIdsPage(CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE),
      makeIdsPage(CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE),
      makeIdsPage(CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE - 1),
      []
    ]);

    const deleted = await runCleanup(connectionManager);

    const selectCursors = executeQuery.mock.calls
      .filter(call => String(call[0]).includes(SELECT_IDS_MARKER))
      .map(call => (call as unknown[])[1] as unknown[])
      .map(params => params[params.length - 1]);
    console.log('[U2] cursor sent with each window SELECT:', selectCursors);
    expect(deleted, 'returned total must be the sum of every page, not just the last').toBe(
      CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE * 2 + (CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE - 1)
    );
    expect(countCoreMeasurementDeletes(executeQuery), 'one DELETE per non-empty page').toBe(3);
    expect(countAuditInserts(executeQuery), 'one audit INSERT per page, matching the DELETE count 1:1').toBe(3);
    expect(selectCursors, 'start at 0, advance past each full page, restart at 0 for the confirming pass').toEqual([
      0,
      CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
      CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
      0
    ]);
  });

  it('stops after one page when the very first page is short', async () => {
    const { connectionManager, executeQuery } = makeConnectionManager([makeIdsPage(1)]);

    expect(await runCleanup(connectionManager)).toBe(1);
    expect(countCoreMeasurementDeletes(executeQuery)).toBe(1);
    expect(countAuditInserts(executeQuery)).toBe(1);
  });

  it('rejects a missing DELETE affectedRows instead of silently reporting an empty census', async () => {
    // Pre-#507-chunking this coerced to 0: the loop exited after one window and
    // the caller was told the census had been fully replaced when nothing had
    // been read. The audit INSERT for this page must still have been attempted
    // and succeeded BEFORE the unreadable DELETE result is surfaced — the audit
    // runs first and this test's default auditResult reports it as fully
    // successful, so the failure is unambiguously the DELETE step's.
    const { connectionManager } = makeConnectionManager([makeIdsPage(1)], { deleteResult: () => ({}) });

    await expect(runCleanup(connectionManager)).rejects.toThrow(/could not read a row count/i);
  });

  it('rejects a non-numeric DELETE affectedRows instead of looping forever on NaN', async () => {
    // `Number('many')` is NaN and `NaN < CHUNK_SIZE` is false, so the pre-fix
    // loop re-issued the same DELETE without end. The scripted mock throws a
    // distinguishable error if a second page is requested.
    const { connectionManager } = makeConnectionManager([makeIdsPage(1)], { deleteResult: () => ({ affectedRows: 'many' }) });

    await expect(runCleanup(connectionManager)).rejects.toThrow(/could not read a row count/i);
  });

  it('rejects a negative DELETE affectedRows', async () => {
    const { connectionManager } = makeConnectionManager([makeIdsPage(1)], { deleteResult: () => ({ affectedRows: -1 }) });

    await expect(runCleanup(connectionManager)).rejects.toThrow(/could not read a row count/i);
  });

  it('rejects a fractional DELETE affectedRows', async () => {
    const { connectionManager } = makeConnectionManager([makeIdsPage(2)], { deleteResult: () => ({ affectedRows: 1.5 }) });

    await expect(runCleanup(connectionManager)).rejects.toThrow(/could not read a row count/i);
  });

  it('refuses to delete when the audit INSERT writes fewer rows than ids selected (#507 integrity guard)', async () => {
    // The audit must never under-report what is about to be deleted — a
    // silent mismatch here is exactly the "Recent Changes missed a write"
    // bug #507 exists to close, now inverted: the data would disappear
    // without a trace. The DELETE must never even run in this case.
    const { connectionManager, executeQuery } = makeConnectionManager([makeIdsPage(3)], {
      auditResult: page => ({ affectedRows: page.length - 1 })
    });

    await expect(runCleanup(connectionManager)).rejects.toThrow(/audit mismatch/i);
    expect(countCoreMeasurementDeletes(executeQuery), 'must not delete rows the audit failed to fully record').toBe(0);
  });

  it('refuses to report success when the DELETE removes fewer rows than were audited (#507 integrity guard)', async () => {
    // The inverse mismatch: the audit trail would then describe a deletion
    // that did not actually happen for every row.
    const { connectionManager } = makeConnectionManager([makeIdsPage(3)], {
      deleteResult: page => ({ affectedRows: page.length - 1 })
    });

    await expect(runCleanup(connectionManager)).rejects.toThrow(/audit trail and the data would disagree/i);
  });

  it('accepts an exactly-empty page as a legitimate empty result without issuing a wasted audit or DELETE', async () => {
    // An empty SELECT means there is nothing left to remove: the loop must stop
    // immediately rather than running an audit INSERT and a DELETE for zero rows.
    const { connectionManager, executeQuery } = makeConnectionManager([[]]);

    expect(await runCleanup(connectionManager)).toBe(0);
    expect(countCoreMeasurementDeletes(executeQuery)).toBe(0);
    expect(countAuditInserts(executeQuery)).toBe(0);
  });

  it('attributes every audit row to the caller-supplied changedBy', async () => {
    const { connectionManager, executeQuery } = makeConnectionManager([makeIdsPage(2)]);

    await runCleanup(connectionManager);

    const auditCall = executeQuery.mock.calls.find(call => String(call[0]).includes(AUDIT_INSERT_MARKER));
    expect(auditCall, 'audit INSERT was never issued').toBeDefined();
    const [, auditParams] = auditCall!;
    expect(auditParams[0]).toBe(TEST_CHANGED_BY);
  });
});

describe('deleteCensusReplacementChunk — one measurement window (#555)', () => {
  const SCHEMA = 'forestgeo_testing';
  const BATCH_ID = 'incoming-batch-0001';
  const PLOT_ID = 22;
  const CENSUS_ID = 32;
  const CHANGED_BY = 'window-test-user';
  const TRANSACTION_ID = 'tx-u1';
  const CURSOR = 4242;
  const HINTED_SELECT_PREFIX = `SELECT /*+ INDEX(coremeasurements ${CENSUS_REPLACEMENT_SCAN_INDEX}) */ CoreMeasurementID FROM \`${SCHEMA}\`.coremeasurements`;
  const STATEMENTS_PER_NON_EMPTY_WINDOW = 4;
  const LEGACY_FALLBACK_WINDOW_SIZE = 3;

  function windowIDs(count: number): number[] {
    return Array.from({ length: count }, (_, index) => CURSOR + 1 + index);
  }

  function makeRecorder(ids: number[], options: { linkTableMissing?: boolean } = {}) {
    const calls: Array<{ sql: string; params: unknown[]; transactionID: string | undefined }> = [];
    const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
      calls.push({ sql: String(sql), params, transactionID });
      const text = String(sql).trimStart();
      if (text.startsWith('SELECT')) return ids.map(id => ({ CoreMeasurementID: id }));
      if (options.linkTableMissing && text.includes('.measurement_error_log')) {
        throw Object.assign(new Error(`Table '${SCHEMA}.measurement_error_log' doesn't exist`), { code: 'ER_NO_SUCH_TABLE' });
      }
      return { affectedRows: ids.length };
    });
    return { connectionManager: { executeQuery } as unknown as ConnectionManager, calls };
  }

  // Catches: the link delete reverting to the census-wide subquery; the audit after the delete;
  // an IN-list longer than the window; the index hint or the cursor dropped.
  it('locks the window above the cursor, then deletes its links by id, audits it, and deletes it, in one transaction', async () => {
    const ids = windowIDs(CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
    const { connectionManager, calls } = makeRecorder(ids);

    const result = await deleteCensusReplacementChunk(connectionManager, SCHEMA, BATCH_ID, PLOT_ID, CENSUS_ID, CURSOR, CHANGED_BY, TRANSACTION_ID);

    console.log(
      '[U1] statements:',
      calls.map(call => `${call.transactionID} ${call.sql.replace(/\s+/g, ' ').trim().slice(0, 140)}`)
    );
    expect(calls.map(call => call.transactionID)).toEqual(Array(STATEMENTS_PER_NON_EMPTY_WINDOW).fill(TRANSACTION_ID));
    const [select, linkDelete, audit, measurementDelete] = calls;
    expect(select.sql.replace(/\s+/g, ' ').trimStart().startsWith(HINTED_SELECT_PREFIX), 'hinted keyset SELECT').toBe(true);
    expect(select.sql).toContain('AND CoreMeasurementID > ?');
    expect(select.sql).toMatch(new RegExp(`ORDER BY CoreMeasurementID\\s+LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}\\s+FOR UPDATE\\s*$`));
    expect(select.params).toEqual([CENSUS_ID, BATCH_ID, buildSubBatchPattern(BATCH_ID), CURSOR]);
    expect(linkDelete.sql).toMatch(/^\s*DELETE FROM `forestgeo_testing`\.measurement_error_log WHERE MeasurementID IN \(/);
    expect(linkDelete.sql, 'no census-wide subquery').not.toMatch(/SELECT/i);
    expect(linkDelete.params).toEqual(ids);
    expect(audit.sql).toMatch(/^\s*INSERT INTO `forestgeo_testing`\.unifiedchangelog/);
    expect(audit.params.slice(3)).toEqual(ids);
    expect(measurementDelete.sql).toMatch(/^\s*DELETE FROM `forestgeo_testing`\.coremeasurements WHERE CoreMeasurementID IN \(/);
    expect(measurementDelete.params).toEqual(ids);
    expect(result).toEqual({ deletedRows: CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE, lastCoreMeasurementID: ids[ids.length - 1] });
  });

  it('issues only the SELECT for an empty window and hands the cursor back unchanged', async () => {
    const { connectionManager, calls } = makeRecorder([]);
    const result = await deleteCensusReplacementChunk(connectionManager, SCHEMA, BATCH_ID, PLOT_ID, CENSUS_ID, CURSOR, CHANGED_BY, TRANSACTION_ID);
    console.log(
      '[U1-empty] statements:',
      calls.map(call => call.sql.trim().slice(0, 80))
    );
    expect(calls).toHaveLength(1);
    expect(result).toEqual({ deletedRows: 0, lastCoreMeasurementID: CURSOR });
  });

  it('falls back to a per-id cmverrors delete when measurement_error_log is missing (legacy schema)', async () => {
    const ids = windowIDs(LEGACY_FALLBACK_WINDOW_SIZE);
    const { connectionManager, calls } = makeRecorder(ids, { linkTableMissing: true });
    await deleteCensusReplacementChunk(connectionManager, SCHEMA, BATCH_ID, PLOT_ID, CENSUS_ID, CURSOR, CHANGED_BY, TRANSACTION_ID);
    const legacy = calls.find(call => call.sql.includes('.cmverrors'));
    console.log(
      '[U1-legacy] statements:',
      calls.map(call => call.sql.trim().slice(0, 80))
    );
    expect(legacy?.sql).toMatch(/^\s*DELETE FROM `forestgeo_testing`\.cmverrors WHERE CoreMeasurementID IN \(/);
    expect(legacy?.params).toEqual(ids);
  });
});

describe('deleteCoreMeasurementsInBoundedChunksWithAudit — one read, primary-key windows, locking confirmation (#562)', () => {
  const WINDOW = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
  const SCHEMA = 'forestgeo_testing';
  const PLOT_ID = 22;
  const CENSUS_ID = 32;
  const CHANGED_BY = 'window-walk-unit-test';
  const TRANSACTION_ID = 'tx-walk';
  const PARTIAL_WINDOW_ROWS = 500;
  const AUDIT_PREFIX_PARAM_COUNT = 3; // recordDeletedCoreMeasurementsAudit binds [changedBy, plotID, censusID, ...ids]
  const PLAIN_WHERE_SQL = 'CensusID = ? AND StemGUID IS NULL AND UploadFileID = ?';
  const PLAIN_WHERE_PARAMS = [CENSUS_ID, 'stale.csv'];
  const JOINED_FROM_SQL = `??.coremeasurements cm
     INNER JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID AND mel.IsResolved = FALSE
     INNER JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID AND me.ErrorSource = 'ingestion'
     INNER JOIN ??.temporarymeasurements tm ON tm.CensusID = cm.CensusID AND tm.FileID = ? AND (tm.BatchID = ? OR tm.BatchID LIKE ?)`;
  const JOINED_WHERE_SQL = 'cm.CensusID = ? AND cm.StemGUID IS NULL AND NOT (cm.UploadFileID <=> ? AND (cm.UploadBatchID <=> ? OR cm.UploadBatchID LIKE ?))';
  const JOINED_WHERE_PARAMS = ['incoming.csv', 'batch-1', 'batch-1\\_\\_sub%', CENSUS_ID, 'incoming.csv', 'batch-1', 'batch-1\\_\\_sub%'];
  const JOINED_LOCKED_ALIASES = ['cm', 'mel'] as const;

  type WalkStatementKind = 'read' | 'lock' | 'confirmation' | 'audit' | 'delete';
  interface LoggedStatement {
    kind: WalkStatementKind;
    sql: string;
    params: unknown[];
    transactionID: string | undefined;
  }
  interface WalkScript {
    reads: number[][];
    confirmations: number[][];
    /** Which of the requested ids the lock statement "finds" (default: all of them). */
    lockFilter?: (requestedIDs: number[]) => number[];
    auditResult?: (lockedIDs: number[]) => unknown;
    deleteResult?: (lockedIDs: number[]) => unknown;
  }

  function classifyWalkStatement(sql: string): WalkStatementKind {
    if (sql.includes('.unifiedchangelog')) return 'audit';
    if (/^\s*DELETE FROM/.test(sql)) return 'delete';
    if (sql.includes('/*+')) return 'lock';
    if (/\sLIMIT\s+\d+\s+FOR UPDATE/.test(sql)) return 'confirmation';
    if (/^\s*SELECT/.test(sql) && !sql.includes('FOR UPDATE') && !/\sLIMIT\s/.test(sql)) return 'read';
    throw new Error(`the walk issued a statement this test does not know: ${sql.replace(/\s+/g, ' ')}`);
  }

  function makeScriptedManager(whereParamCount: number, script: WalkScript) {
    const log: LoggedStatement[] = [];
    const reads = [...script.reads];
    const confirmations = [...script.confirmations];
    let lastLockedIDs: number[] = [];
    const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
      const kind = classifyWalkStatement(String(sql));
      log.push({ kind, sql: String(sql), params, transactionID });
      if (kind === 'read') {
        const next = reads.shift();
        if (!next) throw new Error(`the walk read its scope more often than scripted. Log:\n${render(log)}`);
        return next.map(id => ({ CoreMeasurementID: id }));
      }
      if (kind === 'confirmation') {
        const next = confirmations.shift();
        if (!next) throw new Error(`the walk confirmed more often than scripted. Log:\n${render(log)}`);
        return next.map(id => ({ CoreMeasurementID: id }));
      }
      if (kind === 'lock') {
        const requested = params.slice(whereParamCount) as number[];
        lastLockedIDs = script.lockFilter ? script.lockFilter(requested) : requested;
        return lastLockedIDs.map(id => ({ CoreMeasurementID: id }));
      }
      if (kind === 'audit') return script.auditResult ? script.auditResult(lastLockedIDs) : { affectedRows: params.length - AUDIT_PREFIX_PARAM_COUNT };
      return script.deleteResult ? script.deleteResult(lastLockedIDs) : { affectedRows: params.length };
    });
    return { connectionManager: { executeQuery } as unknown as ConnectionManager, log };
  }

  function render(log: LoggedStatement[]): string {
    return log.map(entry => `${entry.transactionID} ${entry.kind} ${entry.sql.replace(/\s+/g, ' ').slice(0, 140)} params#${entry.params.length}`).join('\n');
  }

  function ids(from: number, count: number): number[] {
    return Array.from({ length: count }, (_, index) => from + index);
  }

  function runPlainWalk(connectionManager: ConnectionManager) {
    return deleteCoreMeasurementsInBoundedChunksWithAudit(
      connectionManager,
      SCHEMA,
      PLAIN_WHERE_SQL,
      PLAIN_WHERE_PARAMS,
      CHANGED_BY,
      PLOT_ID,
      CENSUS_ID,
      TRANSACTION_ID
    );
  }

  it('U1: reads once, locks W, W, 500 ascending slices by primary key with the predicate first, then confirms (catches: a re-read per window; overlapping or unordered slices; ids before the predicate params; a missing locking confirmation)', async () => {
    const scopeIDs = ids(1, 2 * WINDOW + PARTIAL_WINDOW_ROWS);
    const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [scopeIDs], confirmations: [[]] });

    const deleted = await runPlainWalk(connectionManager);
    console.log(`[U1] deleted=${deleted}\n${render(log)}`);

    expect(
      log.map(entry => entry.kind),
      render(log)
    ).toEqual(['read', 'lock', 'audit', 'delete', 'lock', 'audit', 'delete', 'lock', 'audit', 'delete', 'confirmation']);
    expect(
      log.every(entry => entry.transactionID === TRANSACTION_ID),
      'every statement runs in the caller transaction'
    ).toBe(true);
    const [read] = log;
    expect(read.sql).toMatch(/ORDER BY CoreMeasurementID\s*$/);
    expect(read.params).toEqual(PLAIN_WHERE_PARAMS);
    const locks = log.filter(entry => entry.kind === 'lock');
    const slices = locks.map(lock => lock.params.slice(PLAIN_WHERE_PARAMS.length) as number[]);
    expect(slices.map(slice => slice.length)).toEqual([WINDOW, WINDOW, PARTIAL_WINDOW_ROWS]);
    expect(slices.flat(), 'slices are disjoint, ascending and cover the read exactly').toEqual(scopeIDs);
    for (const lock of locks) {
      expect(lock.sql).toContain('/*+ INDEX(coremeasurements PRIMARY) */');
      expect(lock.sql).toContain(`WHERE (${PLAIN_WHERE_SQL}) AND CoreMeasurementID IN (`);
      expect(lock.sql).toMatch(/ORDER BY CoreMeasurementID\s+FOR UPDATE\s*$/);
      expect(lock.params.slice(0, PLAIN_WHERE_PARAMS.length), 'the predicate params come first').toEqual(PLAIN_WHERE_PARAMS);
    }
    const confirmation = log[log.length - 1];
    expect(confirmation.sql).toMatch(new RegExp(`ORDER BY CoreMeasurementID\\s+LIMIT ${WINDOW}\\s+FOR UPDATE\\s*$`));
    expect(confirmation.params).toEqual(PLAIN_WHERE_PARAMS);
    expect(deleted).toBe(2 * WINDOW + PARTIAL_WINDOW_ROWS);
  });

  it('U2: a joined scope reads DISTINCT cm ids, pins the join to cm on PRIMARY, keeps the 7 join+predicate params first, and locks only cm and mel (catches: param misalignment; unpinned join order; locking me/tm)', async () => {
    const scopeIDs = [11, 12, 13];
    const { connectionManager, log } = makeScriptedManager(JOINED_WHERE_PARAMS.length, { reads: [scopeIDs], confirmations: [[]] });

    const deleted = await deleteCoreMeasurementsInBoundedChunksWithAudit(
      connectionManager,
      SCHEMA,
      JOINED_WHERE_SQL,
      JOINED_WHERE_PARAMS,
      CHANGED_BY,
      PLOT_ID,
      CENSUS_ID,
      TRANSACTION_ID,
      JOINED_FROM_SQL,
      JOINED_LOCKED_ALIASES
    );
    console.log(`[U2] deleted=${deleted}\n${render(log)}`);

    const [read, lock] = log;
    expect(read.sql).toMatch(/^\s*SELECT DISTINCT cm\.CoreMeasurementID FROM/);
    expect(read.sql).toMatch(/ORDER BY cm\.CoreMeasurementID\s*$/);
    expect(lock.sql).toMatch(/^\s*SELECT \/\*\+ JOIN_PREFIX\(cm\) INDEX\(cm PRIMARY\) \*\/ DISTINCT cm\.CoreMeasurementID FROM/);
    expect(lock.sql).toContain(`WHERE (${JOINED_WHERE_SQL}) AND cm.CoreMeasurementID IN (?, ?, ?)`);
    expect(lock.sql).toMatch(/FOR UPDATE OF cm, mel\s*$/);
    expect(lock.params).toEqual([...JOINED_WHERE_PARAMS, ...scopeIDs]);
    const confirmation = log[log.length - 1];
    expect(confirmation.kind).toBe('confirmation');
    expect(confirmation.sql).toMatch(new RegExp(`LIMIT ${WINDOW}\\s+FOR UPDATE OF cm, mel\\s*$`));
    expect(
      log.filter(entry => entry.sql.includes('/*+')).every(entry => !/INDEX\((?!cm PRIMARY|coremeasurements PRIMARY)/.test(entry.sql)),
      'no hint names a secondary index'
    ).toBe(true);
    expect(deleted).toBe(scopeIDs.length);
  });

  it('U3: audits and deletes only the ids the lock statement returned (catches: auditing the read’s ids)', async () => {
    const stillMatching = [2, 4];
    const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, {
      reads: [[1, 2, 3, 4]],
      confirmations: [[]],
      lockFilter: requested => requested.filter(id => stillMatching.includes(id))
    });

    const deleted = await runPlainWalk(connectionManager);
    console.log(`[U3] deleted=${deleted}\n${render(log)}`);

    const audit = log.find(entry => entry.kind === 'audit')!;
    const deletion = log.find(entry => entry.kind === 'delete')!;
    expect(audit.params.slice(AUDIT_PREFIX_PARAM_COUNT)).toEqual(stillMatching);
    expect(deletion.params).toEqual(stillMatching);
    expect(deleted).toBe(stillMatching.length);
  });

  it('U4a: a full confirmation is deleted and followed by a new read (catches: ending on a full locking window)', async () => {
    const lateRows = ids(1_000_001, WINDOW);
    const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [[1, 2, 3, 4, 5], []], confirmations: [lateRows, []] });

    const deleted = await runPlainWalk(connectionManager);
    console.log(`[U4a] deleted=${deleted}\n${render(log)}`);

    expect(log.map(entry => entry.kind)).toEqual(['read', 'lock', 'audit', 'delete', 'confirmation', 'lock', 'audit', 'delete', 'read', 'confirmation']);
    expect(deleted).toBe(5 + WINDOW);
  });

  it('U4b: a short confirmation is deleted and ends the walk (catches: an extra confirmation after a short one)', async () => {
    const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [[1, 2, 3, 4, 5]], confirmations: [[6, 7, 8]] });

    const deleted = await runPlainWalk(connectionManager);
    console.log(`[U4b] deleted=${deleted}\n${render(log)}`);

    expect(log.map(entry => entry.kind)).toEqual(['read', 'lock', 'audit', 'delete', 'confirmation', 'lock', 'audit', 'delete']);
    expect(deleted).toBe(8);
  });

  it('U5: an empty scope costs one read and one confirmation, nothing else (catches: wasted statements)', async () => {
    const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [[]], confirmations: [[]] });

    expect(await runPlainWalk(connectionManager)).toBe(0);
    console.log(`[U5]\n${render(log)}`);
    expect(log.map(entry => entry.kind)).toEqual(['read', 'confirmation']);
  });

  describe('U6: one window’s guards', () => {
    const PLAIN_SCOPE = { whereSQL: PLAIN_WHERE_SQL, whereParams: PLAIN_WHERE_PARAMS, fromSQL: '??.coremeasurements' };

    it('a lock statement that finds nothing returns 0 with no audit and no DELETE (catches: EmptyInListError on a stale slice — G3)', async () => {
      const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [], confirmations: [], lockFilter: () => [] });
      const deleted = await lockAuditAndDeleteCoreMeasurementWindow(
        connectionManager,
        SCHEMA,
        PLAIN_SCOPE,
        [7, 8, 9],
        CHANGED_BY,
        PLOT_ID,
        CENSUS_ID,
        TRANSACTION_ID
      );
      console.log(`[U6 empty lock] deleted=${deleted}\n${render(log)}`);
      expect(deleted).toBe(0);
      expect(log.map(entry => entry.kind)).toEqual(['lock']);
    });

    it('rejects a window longer than CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE before any statement (catches: IN lists past the range-optimizer limit)', async () => {
      const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [], confirmations: [] });
      await expect(
        lockAuditAndDeleteCoreMeasurementWindow(connectionManager, SCHEMA, PLAIN_SCOPE, ids(1, WINDOW + 1), CHANGED_BY, PLOT_ID, CENSUS_ID, TRANSACTION_ID)
      ).rejects.toBeInstanceOf(CoreMeasurementWindowTooLargeError);
      expect(log).toHaveLength(0);
    });

    it('an empty window issues no statement and returns 0 (catches: buildInPlaceholders(0) reaching SQL)', async () => {
      const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [], confirmations: [] });
      await expect(
        lockAuditAndDeleteCoreMeasurementWindow(connectionManager, SCHEMA, PLAIN_SCOPE, [], CHANGED_BY, PLOT_ID, CENSUS_ID, TRANSACTION_ID)
      ).resolves.toBe(0);
      expect(log, 'no statement may run for an empty window').toHaveLength(0);
    });

    it.each([
      ['a missing DELETE affectedRows', { deleteResult: () => ({}) }, /could not read a row count/i],
      ['a non-numeric DELETE affectedRows', { deleteResult: () => ({ affectedRows: 'many' }) }, /could not read a row count/i],
      ['a negative DELETE affectedRows', { deleteResult: () => ({ affectedRows: -1 }) }, /could not read a row count/i],
      ['a fractional DELETE affectedRows', { deleteResult: () => ({ affectedRows: 1.5 }) }, /could not read a row count/i],
      ['an audit that writes fewer rows than locked', { auditResult: (locked: number[]) => ({ affectedRows: locked.length - 1 }) }, /audit mismatch/i],
      [
        'a DELETE that removes fewer rows than audited',
        { deleteResult: (locked: number[]) => ({ affectedRows: locked.length - 1 }) },
        /audit trail and the data would disagree/i
      ]
    ])('the #507 guard still rejects %s on the new path (catches: dropped integrity guards)', async (_label, overrides, expectedMessage) => {
      const { connectionManager, log } = makeScriptedManager(PLAIN_WHERE_PARAMS.length, { reads: [[1, 2, 3]], confirmations: [[]], ...overrides });
      await expect(runPlainWalk(connectionManager)).rejects.toThrow(expectedMessage);
      console.log(`[U6 guard]\n${render(log)}`);
      if (String(expectedMessage).includes('audit mismatch'))
        expect(
          log.some(entry => entry.kind === 'delete'),
          'must not delete rows the audit failed to record'
        ).toBe(false);
    });
  });
});
