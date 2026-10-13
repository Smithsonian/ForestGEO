/** Real-MySQL proofs for the atomic validation reset / single-row recheck transaction boundary. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { buildMeasurementScopeLockName } from '@/config/measurementscopelock';
import { MANAGER_OVERRIDE_ERROR_CODE, MANAGER_OVERRIDE_ERROR_MESSAGE } from '@/config/validationoverride';
import ConnectionManager from '@/lib/db/connectionmanager';
import { ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { recheckMeasurementValidation, resetValidationScope } from '@/lib/validations/reset';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';
import { SCOPE_VIEW_REFRESH_BATCH_SIZE } from '@/lib/validations/scope-transaction';
import {
  cleanupTestMeasurements,
  insertDirectMeasurements,
  setupTestDatabase,
  setupTwoCensusScenario,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

const bool = (value: unknown): boolean | null => (value == null ? null : Buffer.isBuffer(value) ? value[0] === 1 : Number(value) === 1);

// Non-recursive digit generator: MySQL's default cte_max_recursion_depth (1000) would reject a
// recursive CTE for 1001+ rows, so this builds every 0-9999 value via a plain CROSS JOIN instead.
const DIGITS_0_9 =
  'SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9';
const FOUR_DIGIT_NUMBER_GENERATOR = `SELECT d0.n + d1.n * 10 + d2.n * 100 + d3.n * 1000 AS n
   FROM (${DIGITS_0_9}) d0, (${DIGITS_0_9}) d1, (${DIGITS_0_9}) d2, (${DIGITS_0_9}) d3`;
const MAX_BULK_ROWS_PER_CALL = 10000;

describe('resetValidationScope / recheckMeasurementValidation transaction boundary', () => {
  let connection: Connection,
    schema: string,
    testData: TestData,
    plotID: number,
    census1ID: number,
    census2ID: number,
    speciesCode: string,
    quadratName: string;
  let serial = 0;
  const cm = ConnectionManager.getInstance();

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
  }, 120000);

  afterAll(async () => teardownTestDatabase(connection, { database: schema }));

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    await connection.query('DELETE FROM validation_runs');
    await connection.query('DELETE FROM upload_sessions');
  });

  async function seedRow(tag: string, censusID: number): Promise<number> {
    serial += 1;
    const { coreMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, [
      { treeTag: `${tag}${serial}`, stemTag: `S${serial}`, speciesCode, quadratName, x: serial, y: serial, dbh: 100, hom: 1.3, date: '2025-06-01' }
    ]);
    return coreMeasurementIDs[0];
  }

  async function seedParkedFailure(censusID: number): Promise<number> {
    const [result] = await connection.query<mysql.ResultSetHeader>(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (NULL, ?, 100, 1.3, '2025-06-01', FALSE, TRUE)`,
      [censusID]
    );
    return result.insertId;
  }

  async function errorID(source: 'validation' | 'ingestion', code: string, message = `${source} ${code}`): Promise<number> {
    await connection.query('INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES (?, ?, ?)', [source, code, message]);
    const [rows] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [source, code]);
    return rows[0].ErrorID;
  }

  async function logOccurrence(measurementID: number, errID: number, isResolved: boolean): Promise<void> {
    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, ?)', [measurementID, errID, isResolved]);
  }

  async function occurrence(measurementID: number, errID: number): Promise<{ isResolved: boolean | null; resolvedAt: unknown }> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT IsResolved, ResolvedAt FROM measurement_error_log WHERE MeasurementID = ? AND ErrorID = ?', [
      measurementID,
      errID
    ]);
    return { isResolved: bool(rows[0]?.IsResolved), resolvedAt: rows[0]?.ResolvedAt ?? null };
  }

  async function validity(measurementID: number): Promise<boolean | null> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [measurementID]);
    return bool(rows[0]?.IsValidated);
  }

  async function summaryErrors(measurementID: number): Promise<string | null> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT Errors FROM measurementssummary WHERE CoreMeasurementID = ?', [measurementID]);
    return rows[0]?.Errors ?? null;
  }

  /** Full durable snapshot for one row: used to prove an injected late failure rolls back exactly. */
  async function snapshot(measurementID: number, errID: number) {
    const [measurement] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [measurementID]);
    const [logEntry] = await connection.query<RowDataPacket[]>(
      'SELECT IsResolved, ResolvedAt FROM measurement_error_log WHERE MeasurementID = ? AND ErrorID = ?',
      [measurementID, errID]
    );
    const [summary] = await connection.query<RowDataPacket[]>('SELECT IsValidated, Errors FROM measurementssummary WHERE CoreMeasurementID = ?', [
      measurementID
    ]);
    const [full] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM viewfulltable WHERE CoreMeasurementID = ?', [measurementID]);
    return JSON.parse(JSON.stringify({ measurement, logEntry, summary, full }));
  }

  /**
   * Bulk-seeds `count` trees/stems/coremeasurements for `censusID` via INSERT...SELECT
   * (not a per-row loop), so a 1000+-row batch-boundary fixture stays fast. Returns the
   * CoreMeasurementIDs in ascending order, matching the production batching loop's order.
   */
  async function seedBulkRows(tagPrefix: string, censusID: number, count: number): Promise<number[]> {
    if (count > MAX_BULK_ROWS_PER_CALL) {
      throw new Error(`seedBulkRows supports at most ${MAX_BULK_ROWS_PER_CALL} rows per call, got ${count}`);
    }
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [quadratName, plotID]);
    const quadratID = quadratRows[0].QuadratID;
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode]);
    const speciesID = speciesRows[0].SpeciesID;

    await connection.query(
      `INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive)
       SELECT CONCAT(?, numbers.n), ?, ?, 1
       FROM (${FOUR_DIGIT_NUMBER_GENERATOR}) numbers
       WHERE numbers.n < ?`,
      [tagPrefix, speciesID, censusID, count]
    );
    await connection.query(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
       SELECT TreeID, ?, CensusID, 'S0', 0, 0, 1
       FROM trees
       WHERE CensusID = ? AND TreeTag LIKE CONCAT(?, '%')`,
      [quadratID, censusID, tagPrefix]
    );
    await connection.query(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       SELECT s.StemGUID, s.CensusID, 100, 1.3, '2025-06-01', 1, 1
       FROM stems s
       JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.CensusID = ? AND t.TreeTag LIKE CONCAT(?, '%')`,
      [censusID, tagPrefix]
    );
    const [measurementRows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID AS id
       FROM coremeasurements cm
       JOIN stems s ON s.StemGUID = cm.StemGUID
       JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.CensusID = ? AND t.TreeTag LIKE CONCAT(?, '%')
       ORDER BY cm.CoreMeasurementID`,
      [censusID, tagPrefix]
    );
    return measurementRows.map(row => Number(row.id));
  }

  describe('resetValidationScope', () => {
    it('resolves unresolved validation occurrences and marks every row in the active census pending, leaving the unrelated census untouched', async () => {
      const validationErrorID = await errorID('validation', 'RESET_TEST_SCOPE');
      const resolved = await seedRow('RESETSCOPE', census2ID);
      const other = await seedRow('RESETSCOPEOTHER', census2ID);
      const unrelated = await seedRow('RESETSCOPEUNRELATED', census1ID);

      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID IN (?, ?, ?)', [resolved, other, unrelated]);
      await logOccurrence(resolved, validationErrorID, false);
      await logOccurrence(unrelated, validationErrorID, false);

      const affectedRows = await resetValidationScope(cm, { schema, plotID, censusID: census2ID });

      expect(affectedRows, 'every row in the census is reset, including one with no error occurrence at all').toBe(2);
      expect(await validity(resolved)).toBeNull();
      expect(await validity(other)).toBeNull();
      const resolvedOccurrence = await occurrence(resolved, validationErrorID);
      expect(resolvedOccurrence.isResolved).toBe(true);
      expect(resolvedOccurrence.resolvedAt).not.toBeNull();

      expect(await validity(unrelated), 'a different census must not be touched by a scoped reset').toBe(false);
      expect(await occurrence(unrelated, validationErrorID), 'the unrelated census occurrence must stay unresolved').toEqual({
        isResolved: false,
        resolvedAt: null
      });
    });

    it('preserves ingestion occurrences and an unresolved manager-override marker while resolving the validation occurrence, and the refreshed summary still reports the open ingestion error', async () => {
      const validationErrorID = await errorID('validation', 'RESET_TEST_MIXED');
      const ingestionErrorID = await errorID('ingestion', 'RESET_TEST_MIXED_INGESTION', 'Ingestion failure message for reset mixed row');
      const overrideErrorID = await errorID('validation', MANAGER_OVERRIDE_ERROR_CODE, MANAGER_OVERRIDE_ERROR_MESSAGE);
      const alreadyResolvedErrorID = await errorID('validation', 'RESET_TEST_ALREADY_RESOLVED');
      const row = await seedRow('RESETMIXED', census2ID);

      await logOccurrence(row, validationErrorID, false);
      await logOccurrence(row, ingestionErrorID, false);
      // Production always writes the override marker resolved; an UNRESOLVED marker is
      // anomalous, and proves the reset predicate excludes it by ErrorCode, not merely
      // because it already happens to be resolved.
      await logOccurrence(row, overrideErrorID, false);
      // A validation occurrence that was ALREADY resolved, with a fixed historical ResolvedAt,
      // before this reset ran: proves the `IsResolved = FALSE` predicate — not merely a
      // WHERE-ErrorSource filter — decides what gets touched. If the reset re-stamped it,
      // its ResolvedAt would move off this fixed historical value.
      const HISTORICAL_RESOLVED_AT = '2020-01-01 00:00:00';
      // The SQL literal above has no UTC designator, so parsing it with the host-local `Date`
      // constructor (as opposed to reading it back through the UTC-timezone DB session) would
      // drift by the host's own offset. Assert against an explicit UTC instant instead.
      const HISTORICAL_RESOLVED_AT_UTC_ISO = '2020-01-01T00:00:00.000Z';
      await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, ResolvedAt) VALUES (?, ?, TRUE, ?)', [
        row,
        alreadyResolvedErrorID,
        HISTORICAL_RESOLVED_AT
      ]);
      const alreadyResolvedBefore = await occurrence(row, alreadyResolvedErrorID);
      expect(alreadyResolvedBefore.isResolved, 'the fixture must seed the occurrence as already resolved').toBe(true);
      expect(new Date(alreadyResolvedBefore.resolvedAt as string | Date).toISOString(), 'the fixture must seed its historical timestamp intact').toBe(
        HISTORICAL_RESOLVED_AT_UTC_ISO
      );

      const affectedRows = await resetValidationScope(cm, { schema, plotID, censusID: census2ID });

      expect(affectedRows).toBe(1);
      expect(await validity(row)).toBeNull();
      expect((await occurrence(row, validationErrorID)).isResolved).toBe(true);
      expect(await occurrence(row, ingestionErrorID), 'ingestion occurrences are never touched by a validation reset').toEqual({
        isResolved: false,
        resolvedAt: null
      });
      expect(await occurrence(row, overrideErrorID), 'the manager-override marker is excluded by ErrorCode regardless of its resolved state').toEqual({
        isResolved: false,
        resolvedAt: null
      });
      expect(await occurrence(row, alreadyResolvedErrorID), 'an already-resolved validation occurrence must not be re-stamped by a later reset').toEqual(
        alreadyResolvedBefore
      );
      expect(await summaryErrors(row), 'the refreshed summary view still surfaces the still-unresolved ingestion error').toContain(
        'Ingestion failure message for reset mixed row'
      );
    });

    it('leaves parked ingestion failures and inactive rows untouched and uncounted, because validation never finalizes them back out of pending', async () => {
      const validationErrorID = await errorID('validation', 'RESET_TEST_UNREVALIDATABLE');
      const revalidatable = await seedRow('RESETREVALIDATABLE', census2ID);
      const inactive = await seedRow('RESETINACTIVE', census2ID);
      const parkedFailure = await seedParkedFailure(census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID IN (?, ?)', [revalidatable, inactive]);
      await connection.query('UPDATE coremeasurements SET IsActive = FALSE WHERE CoreMeasurementID = ?', [inactive]);
      await logOccurrence(inactive, validationErrorID, false);
      await logOccurrence(parkedFailure, validationErrorID, false);

      const affectedRows = await resetValidationScope(cm, { schema, plotID, censusID: census2ID });

      expect(affectedRows, 'only the active, stem-resolved row is counted as reset').toBe(1);
      expect(await validity(revalidatable), 'the active, stem-resolved row is put back to pending').toBeNull();
      expect(await validity(parkedFailure), 'a parked failure (StemGUID NULL) must keep IsValidated = FALSE, not become a permanent pending row').toBe(false);
      expect(await validity(inactive), 'an inactive row must keep its prior IsValidated value').toBe(false);
      expect(await occurrence(parkedFailure, validationErrorID), "the parked failure's occurrence must stay unresolved").toEqual({
        isResolved: false,
        resolvedAt: null
      });
      expect(await occurrence(inactive, validationErrorID), "the inactive row's occurrence must stay unresolved").toEqual({
        isResolved: false,
        resolvedAt: null
      });
    });

    it('reports zero affected rows for an empty, otherwise-valid census', async () => {
      expect(await resetValidationScope(cm, { schema, plotID, censusID: census2ID })).toBe(0);
    });

    it('rejects a plot/census scope mismatch before any write', async () => {
      const row = await seedRow('RESETSCOPEMISMATCH', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [row]);

      await expect(resetValidationScope(cm, { schema, plotID: plotID + 999999, censusID: census2ID })).rejects.toThrow(ScopeAccessError);

      expect(await validity(row), 'a rejected scope mismatch must not mutate the row').toBe(false);
    });

    it('rejects a busy scope guarded by a fresh running validation run, without writing anything', async () => {
      const row = await seedRow('RESETBUSYRUN', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [row]);
      await connection.query("INSERT INTO validation_runs (PlotID, CensusID, Status, StartedAt) VALUES (?, ?, 'running', NOW())", [plotID, census2ID]);

      await expect(resetValidationScope(cm, { schema, plotID, censusID: census2ID })).rejects.toThrow(ScopeBusyError);

      expect(await validity(row)).toBe(false);
    });

    it('rejects a busy scope guarded by an active upload session, without writing anything', async () => {
      const row = await seedRow('RESETBUSYUPLOAD', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [row]);
      await connection.query(
        "INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state) VALUES ('reset-busy-upload', ?, ?, ?, 'test', 'processing')",
        [schema, plotID, census2ID]
      );

      await expect(resetValidationScope(cm, { schema, plotID, censusID: census2ID })).rejects.toThrow(ScopeBusyError);

      expect(await validity(row), 'an active-upload conflict must not mutate the row').toBe(false);
    });

    it('rolls back the resolved occurrence, the pending reset, and all view rows when the final view refresh fails, after real writes land inside the same transaction first', async () => {
      const validationErrorID = await errorID('validation', 'RESET_ROLLBACK');
      const row = await seedRow('RESETROLLBACK', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = ?', [row]);
      await logOccurrence(row, validationErrorID, false);
      const before = await snapshot(row, validationErrorID);

      const execute = cm.executeQuery.bind(cm);
      const failure = new Error('Injected reset view refresh failure');
      let midTransactionCaptured = false;
      let midTransactionIsValidated: unknown = 'NOT_CAPTURED';
      let midTransactionOccurrence: { IsResolved?: unknown; ResolvedAt?: unknown } | undefined;
      const spy = vi.spyOn(cm, 'executeQuery').mockImplementation(async (sql, params, transactionID) => {
        if (sql.includes('INSERT IGNORE INTO') && sql.includes('viewfulltable')) {
          // Read back the still-uncommitted write on the SAME transaction connection, before
          // throwing. A passing "before equals after" assertion alone cannot distinguish a real
          // rollback from a no-op that never wrote anything in the first place — this proves the
          // resolve/reset steps actually executed inside this transaction before the injected
          // failure forces them to be undone.
          const measurementRows = await execute('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [row], transactionID);
          midTransactionIsValidated = measurementRows[0]?.IsValidated ?? null;
          const occurrenceRows = await execute(
            'SELECT IsResolved, ResolvedAt FROM measurement_error_log WHERE MeasurementID = ? AND ErrorID = ?',
            [row, validationErrorID],
            transactionID
          );
          midTransactionOccurrence = occurrenceRows[0];
          midTransactionCaptured = true;
          throw failure;
        }
        return execute(sql, params, transactionID);
      });
      try {
        await expect(resetValidationScope(cm, { schema, plotID, censusID: census2ID })).rejects.toThrow(failure.message);
      } finally {
        spy.mockRestore();
      }

      expect(midTransactionCaptured, 'the spy must have intercepted the final view-refresh insert exactly once').toBe(true);
      expect(
        bool(midTransactionIsValidated),
        'the pending reset (IsValidated = NULL) must already be visible on the same transaction connection before the injected failure rolls it back'
      ).toBeNull();
      expect(
        bool(midTransactionOccurrence?.IsResolved),
        'the occurrence resolve must already be visible on the same transaction connection before rollback'
      ).toBe(true);
      expect(midTransactionOccurrence?.ResolvedAt, 'the occurrence resolve must have set a timestamp before rollback').not.toBeNull();

      expect(await snapshot(row, validationErrorID), 'all persisted state must roll back to the pre-transaction snapshot after a late reset failure').toEqual(
        before
      );
      // A direct retry also proves the failed transaction released its scope lock.
      expect(await resetValidationScope(cm, { schema, plotID, censusID: census2ID })).toBe(1);
      expect(await validity(row)).toBeNull();
    });

    it('refreshes every one of 1001 rows across exactly two batches, including rows that exist only in the second batch', async () => {
      const totalRows = SCOPE_VIEW_REFRESH_BATCH_SIZE + 1;
      const validationErrorID = await errorID('validation', 'RESET_BATCH_BOUNDARY');
      const measurementIDs = await seedBulkRows('RESETBULKBATCH', census2ID, totalRows);
      expect(measurementIDs, 'the bulk fixture must create exactly one measurement per requested row').toHaveLength(totalRows);

      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CensusID = ?', [census2ID]);
      await connection.query(
        'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) SELECT CoreMeasurementID, ?, FALSE FROM coremeasurements WHERE CensusID = ?',
        [validationErrorID, census2ID]
      );

      const execute = cm.executeQuery.bind(cm);
      let summaryRefreshPasses = 0;
      const spy = vi.spyOn(cm, 'executeQuery').mockImplementation(async (sql, params, transactionID) => {
        if (sql.includes('DELETE FROM') && sql.includes('measurementssummary')) summaryRefreshPasses += 1;
        return execute(sql, params, transactionID);
      });
      let affectedRows: number;
      try {
        affectedRows = await resetValidationScope(cm, { schema, plotID, censusID: census2ID });
      } finally {
        spy.mockRestore();
      }

      expect(affectedRows).toBe(totalRows);
      expect(
        summaryRefreshPasses,
        'batching 1001 rows at a batch size of 1000 must issue exactly two refresh passes, proving the boundary is actually exercised'
      ).toBe(2);

      const lastRowID = measurementIDs[measurementIDs.length - 1];
      expect(await validity(lastRowID), 'the last row, present only in the second batch, must still be marked pending').toBeNull();
      expect((await occurrence(lastRowID, validationErrorID)).isResolved, "the last row's occurrence must still be resolved").toBe(true);

      const [summaryCountRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM measurementssummary WHERE CoreMeasurementID IN (?)', [
        measurementIDs
      ]);
      expect(Number(summaryCountRows[0].count), 'every one of the 1001 rows, not just a sample, must land in the refreshed summary view').toBe(totalRows);

      const [fullTableCountRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM viewfulltable WHERE CoreMeasurementID IN (?)', [
        measurementIDs
      ]);
      expect(Number(fullTableCountRows[0].count), 'every one of the 1001 rows, not just a sample, must land in the refreshed full-table view').toBe(totalRows);
    }, 60000);
  });

  describe('recheckMeasurementValidation', () => {
    it('resolves only the targeted row’s validation occurrence, leaving a sibling row in the same census untouched', async () => {
      const validationErrorID = await errorID('validation', 'RECHECK_TEST_SIBLING');
      const target = await seedRow('RECHECKTARGET', census2ID);
      const sibling = await seedRow('RECHECKSIBLING', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID IN (?, ?)', [target, sibling]);
      await logOccurrence(target, validationErrorID, false);
      await logOccurrence(sibling, validationErrorID, false);

      const affectedRows = await recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: target });

      expect(affectedRows).toBe(1);
      expect(await validity(target)).toBeNull();
      expect((await occurrence(target, validationErrorID)).isResolved).toBe(true);

      expect(await validity(sibling), 'recheck must not reset the whole census, only the targeted row').toBe(false);
      expect(await occurrence(sibling, validationErrorID), 'a sibling row’s occurrence must stay unresolved').toEqual({ isResolved: false, resolvedAt: null });
    });

    it('preserves the row’s ingestion occurrence and an unresolved manager-override marker while resolving its validation occurrence', async () => {
      const validationErrorID = await errorID('validation', 'RECHECK_TEST_MIXED');
      const ingestionErrorID = await errorID('ingestion', 'RECHECK_TEST_MIXED_INGESTION', 'Ingestion failure on recheck row');
      const overrideErrorID = await errorID('validation', MANAGER_OVERRIDE_ERROR_CODE, MANAGER_OVERRIDE_ERROR_MESSAGE);
      const alreadyResolvedErrorID = await errorID('validation', 'RECHECK_TEST_ALREADY_RESOLVED');
      const row = await seedRow('RECHECKMIXED', census2ID);
      await logOccurrence(row, validationErrorID, false);
      await logOccurrence(row, ingestionErrorID, false);
      await logOccurrence(row, overrideErrorID, false);
      // A validation occurrence already resolved, with a fixed historical ResolvedAt, before this
      // recheck ran: proves the `IsResolved = FALSE` predicate decides what gets touched, not
      // merely a WHERE-ErrorSource filter. If recheck re-stamped it, the timestamp would move.
      const HISTORICAL_RESOLVED_AT = '2020-01-01 00:00:00';
      await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, ResolvedAt) VALUES (?, ?, TRUE, ?)', [
        row,
        alreadyResolvedErrorID,
        HISTORICAL_RESOLVED_AT
      ]);
      const alreadyResolvedBefore = await occurrence(row, alreadyResolvedErrorID);
      expect(alreadyResolvedBefore.isResolved, 'the fixture must seed the occurrence as already resolved').toBe(true);

      expect(await recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: row })).toBe(1);

      expect(await validity(row)).toBeNull();
      expect((await occurrence(row, validationErrorID)).isResolved).toBe(true);
      expect(await occurrence(row, ingestionErrorID)).toEqual({ isResolved: false, resolvedAt: null });
      expect(await occurrence(row, overrideErrorID)).toEqual({ isResolved: false, resolvedAt: null });
      expect(await occurrence(row, alreadyResolvedErrorID), 'an already-resolved validation occurrence must not be re-stamped by a later recheck').toEqual(
        alreadyResolvedBefore
      );
    });

    it('rejects recheck for a measurement marked IsActive = FALSE inside an otherwise-active census, without writing anything', async () => {
      // census2ID itself is active, so a rejection here can only come from the measurement-row
      // IsActive check — a guard that only inspected the census's IsActive would incorrectly
      // let this row through, which is exactly the gap this test exists to catch.
      const validationErrorID = await errorID('validation', 'RECHECK_INACTIVE_MEASUREMENT');
      const row = await seedRow('RECHECKINACTMEAS', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE, IsActive = 0 WHERE CoreMeasurementID = ?', [row]);
      await logOccurrence(row, validationErrorID, false);
      // Populate real summary/full-table view rows so the snapshot below proves they survive
      // untouched, rather than merely staying absent.
      await refreshMeasurementViewsForCoreMeasurements(cm, schema, [row]);
      const before = await snapshot(row, validationErrorID);

      await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: row })).rejects.toThrow(ScopeAccessError);

      expect(await snapshot(row, validationErrorID), 'a rejected inactive-measurement recheck must not mutate any durable state').toEqual(before);
    });

    it('rejects a busy scope guarded by an active upload session, without writing anything', async () => {
      const validationErrorID = await errorID('validation', 'RECHECK_BUSY_UPLOAD');
      const row = await seedRow('RECHECKBUSYUPLOAD', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [row]);
      await logOccurrence(row, validationErrorID, false);
      await connection.query(
        "INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state) VALUES ('recheck-busy-upload', ?, ?, ?, 'test', 'processing')",
        [schema, plotID, census2ID]
      );

      await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: row })).rejects.toThrow(ScopeBusyError);

      expect(await validity(row), 'an active-upload conflict must not mutate the row').toBe(false);
      expect(await occurrence(row, validationErrorID)).toEqual({ isResolved: false, resolvedAt: null });
    });

    it('rejects recheck for a parked ingestion failure (StemGUID NULL), without writing anything', async () => {
      const validationErrorID = await errorID('validation', 'RECHECK_TEST_PARKED');
      const parkedFailure = await seedParkedFailure(census2ID);
      await logOccurrence(parkedFailure, validationErrorID, false);

      await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: parkedFailure })).rejects.toThrow(
        ScopeAccessError
      );

      expect(await validity(parkedFailure), 'a rejected recheck must not move the parked failure to pending').toBe(false);
      expect(await occurrence(parkedFailure, validationErrorID)).toEqual({ isResolved: false, resolvedAt: null });
    });

    it('rejects recheck for a measurement that belongs to a different census, without writing anything', async () => {
      const validationErrorID = await errorID('validation', 'RECHECK_WRONG_CENSUS');
      const priorCensusRow = await seedRow('RECHECKWRONGCENSUS', census1ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [priorCensusRow]);
      await logOccurrence(priorCensusRow, validationErrorID, false);

      await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: priorCensusRow })).rejects.toThrow(
        ScopeAccessError
      );

      expect(await validity(priorCensusRow), 'a rejected cross-census recheck must not mutate the row').toBe(false);
      expect(await occurrence(priorCensusRow, validationErrorID)).toEqual({ isResolved: false, resolvedAt: null });
    });

    it('rejects recheck for a measurement ID that does not exist at all', async () => {
      await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: 999999999 })).rejects.toThrow(ScopeAccessError);
    });

    it('rejects a scope held by another session’s advisory lock, without writing anything', async () => {
      const row = await seedRow('RECHECKBUSYLOCK', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [row]);
      const lockName = buildMeasurementScopeLockName(schema, plotID, census2ID);
      const blocker = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'testpassword', database: schema });
      try {
        await blocker.query('SELECT GET_LOCK(?, 0)', [lockName]);

        await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: row })).rejects.toThrow(ScopeBusyError);

        expect(await validity(row), 'a lock conflict must not mutate the row').toBe(false);
      } finally {
        await blocker.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
        await blocker.end();
      }
    });

    it('rolls back a single-row recheck exactly when the final view refresh fails, after real writes land inside the same transaction first', async () => {
      const validationErrorID = await errorID('validation', 'RECHECK_ROLLBACK');
      const row = await seedRow('RECHECKROLLBACK', census2ID);
      await connection.query('UPDATE coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = ?', [row]);
      await logOccurrence(row, validationErrorID, false);
      const before = await snapshot(row, validationErrorID);

      const execute = cm.executeQuery.bind(cm);
      const failure = new Error('Injected recheck view refresh failure');
      let midTransactionCaptured = false;
      let midTransactionIsValidated: unknown = 'NOT_CAPTURED';
      let midTransactionOccurrence: { IsResolved?: unknown; ResolvedAt?: unknown } | undefined;
      const spy = vi.spyOn(cm, 'executeQuery').mockImplementation(async (sql, params, transactionID) => {
        if (sql.includes('INSERT IGNORE INTO') && sql.includes('viewfulltable')) {
          // Read back the still-uncommitted write on the SAME transaction connection, before
          // throwing, so this test proves a real rollback rather than a no-op that never wrote
          // anything in the first place.
          const measurementRows = await execute('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [row], transactionID);
          midTransactionIsValidated = measurementRows[0]?.IsValidated ?? null;
          const occurrenceRows = await execute(
            'SELECT IsResolved, ResolvedAt FROM measurement_error_log WHERE MeasurementID = ? AND ErrorID = ?',
            [row, validationErrorID],
            transactionID
          );
          midTransactionOccurrence = occurrenceRows[0];
          midTransactionCaptured = true;
          throw failure;
        }
        return execute(sql, params, transactionID);
      });
      try {
        await expect(recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: row })).rejects.toThrow(failure.message);
      } finally {
        spy.mockRestore();
      }

      expect(midTransactionCaptured, 'the spy must have intercepted the final view-refresh insert exactly once').toBe(true);
      expect(
        bool(midTransactionIsValidated),
        'the pending reset (IsValidated = NULL) must already be visible on the same transaction connection before the injected failure rolls it back'
      ).toBeNull();
      expect(
        bool(midTransactionOccurrence?.IsResolved),
        'the occurrence resolve must already be visible on the same transaction connection before rollback'
      ).toBe(true);
      expect(midTransactionOccurrence?.ResolvedAt, 'the occurrence resolve must have set a timestamp before rollback').not.toBeNull();

      expect(await snapshot(row, validationErrorID), 'all persisted state must roll back to the pre-transaction snapshot after a late recheck failure').toEqual(
        before
      );
      expect(await recheckMeasurementValidation(cm, { schema, plotID, censusID: census2ID, coreMeasurementID: row })).toBe(1);
      expect(await validity(row)).toBeNull();
    });
  });
});
