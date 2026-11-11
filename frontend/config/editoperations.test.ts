import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EditOperationStateIntegrityError,
  ensureEditOperationsTable,
  markEditOperationReverted,
  MarkEditOperationRevertedConflictError,
  readEditOperation,
  ReadEditOperationLockRequiresTransactionError,
  writeEditOperation,
  type EditOperationStateColumn,
  type EditOperationWriteInput
} from './editoperations';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';

const ORIGINAL_EDIT_OPERATION_ID = 7;
const REVERTING_EDIT_OPERATION_ID = 8;
const TRANSACTION_ID = 'tx-1';

function makeConnectionManager() {
  return {
    executeQuery: vi.fn()
  } as any;
}

const STATE_INTEGRITY_EDIT_OPERATION_ID = 123;
const DISTINCTIVE_ROW_PAYLOAD_MARKER = 'SECRET_ROW_PAYLOAD_MARKER_67890';
// V8's JSON.parse SyntaxError truncates the quoted input snippet to a short
// prefix (e.g. `"[SECRET_R"...`) rather than echoing the full offending
// string, so only this leading slice of the marker is actually observable
// in the native error message.
const VISIBLE_PAYLOAD_PREFIX_LENGTH = 8;

function buildLedgerRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    EditOperationID: STATE_INTEGRITY_EDIT_OPERATION_ID,
    OperationType: 'single-row-edit',
    Revertable: 1,
    DataType: 'measurementssummary',
    TargetID: 42,
    PlotID: 1,
    CensusID: 2,
    PlanHash: 'a'.repeat(64),
    BeforeState: '[]',
    AfterState: '[]',
    CreatedBy: 'mason@example.com',
    CreatedAt: '2026-04-22T00:00:00.000Z',
    RevertedByEditOperationID: null,
    ...overrides
  };
}

function buildInput(overrides: Partial<EditOperationWriteInput> = {}): EditOperationWriteInput {
  return {
    operationType: 'single-row-edit',
    dataType: 'measurementssummary',
    targetID: 42,
    plotID: 1,
    censusID: 2,
    planHash: 'a'.repeat(64),
    beforeState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 10 } }],
    afterState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 12 } }],
    createdBy: 'mason@example.com',
    ...overrides
  };
}

describe('editoperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upgrades existing tables to the bulk-row enum, adds Revertable, and relaxes TargetID to nullable when missing', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery
      // 0: CREATE TABLE IF NOT EXISTS (no-op when table already exists)
      .mockResolvedValueOnce({})
      // 1: probe OperationType column
      .mockResolvedValueOnce([{ columnType: "enum('single-row-edit','revert')" }])
      // 2: ALTER OperationType to widen enum
      .mockResolvedValueOnce({})
      // 3: probe Revertable column count
      .mockResolvedValueOnce([{ columnCount: 0 }])
      // 4: ADD COLUMN Revertable
      .mockResolvedValueOnce({})
      // 5: probe TargetID nullability
      .mockResolvedValueOnce([{ isNullable: 'NO' }])
      // 6: ALTER TargetID to nullable
      .mockResolvedValueOnce({});

    await ensureEditOperationsTable(cm, 'forestgeo_testing', 'tx');

    expect(cm.executeQuery).toHaveBeenCalledTimes(7);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS `forestgeo_testing`.edit_operations');
    expect(cm.executeQuery.mock.calls[1][0]).toContain("COLUMN_NAME = 'OperationType'");
    expect(cm.executeQuery.mock.calls[2][0]).toContain("ENUM('single-row-edit', 'bulk-revision-row', 'revert')");
    expect(cm.executeQuery.mock.calls[3][0]).toContain('INFORMATION_SCHEMA.COLUMNS');
    expect(cm.executeQuery.mock.calls[3][1]).toEqual(['forestgeo_testing']);
    expect(cm.executeQuery.mock.calls[4][0]).toContain('ADD COLUMN Revertable BOOLEAN NOT NULL DEFAULT TRUE');
    expect(cm.executeQuery.mock.calls[5][0]).toContain("COLUMN_NAME = 'TargetID'");
    expect(cm.executeQuery.mock.calls[6][0]).toContain('MODIFY COLUMN TargetID BIGINT NULL');
  });

  it('skips the TargetID upgrade when the column is already nullable', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{ columnType: "enum('single-row-edit','bulk-revision-row','revert')" }])
      .mockResolvedValueOnce([{ columnCount: 1 }])
      .mockResolvedValueOnce([{ isNullable: 'YES' }]);

    await ensureEditOperationsTable(cm, 'forestgeo_testing', 'tx');

    // 4 calls: CREATE, OperationType probe, Revertable probe, TargetID probe;
    // no ALTERs because each column already matches the target shape.
    expect(cm.executeQuery).toHaveBeenCalledTimes(4);
  });

  it('writes nullable TargetID for bulk ledger rows without losing insert semantics', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue({ insertId: 99 });

    const id = await writeEditOperation(cm, 'forestgeo_testing', buildInput({ operationType: 'bulk-revision-row', revertable: false, targetID: null }), 'tx');

    expect(id).toBe(99);
    expect(cm.executeQuery.mock.calls[0][1][3]).toBeNull();
  });

  it('returns targetID === null when the ledger row has NULL TargetID', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue([
      {
        EditOperationID: 99,
        OperationType: 'bulk-revision-row',
        Revertable: 0,
        DataType: 'measurementssummary',
        TargetID: null,
        PlotID: 1,
        CensusID: 2,
        PlanHash: 'a'.repeat(64),
        BeforeState: '[]',
        AfterState: '[]',
        CreatedBy: 'mason@example.com',
        CreatedAt: '2026-04-22T00:00:00.000Z',
        RevertedByEditOperationID: null
      }
    ]);

    const record = await readEditOperation(cm, 'forestgeo_testing', 99);
    expect(record?.targetID).toBeNull();
  });

  it('writes bulk revision row ledger entries with explicit revertability, dual-writing the summary projection in the SAME transaction', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue({ insertId: 55 });

    const id = await writeEditOperation(cm, 'forestgeo_testing', buildInput({ operationType: 'bulk-revision-row', revertable: false }), 'tx');

    expect(id).toBe(55);
    // Call 0: the edit_operations ledger INSERT itself.
    expect(cm.executeQuery).toHaveBeenCalledTimes(2);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('OperationType, Revertable, DataType');
    expect(cm.executeQuery.mock.calls[0][1][0]).toBe('bulk-revision-row');
    expect(cm.executeQuery.mock.calls[0][1][1]).toBe(false);
    expect(cm.executeQuery.mock.calls[0][2]).toBe('tx');

    // Call 1: writeEditOperation's dual-write of the bulk-revision summary
    // (projectBulkRevisionRow's BeforeState[0], tagged summaryKind — never a
    // fabricated per-row diff) into unifiedchangelog, on the same transactionID.
    const [changelogSQL, changelogParams, changelogTransactionID] = cm.executeQuery.mock.calls[1];
    expect(changelogSQL).toContain('INSERT INTO');
    expect(changelogSQL).toContain('unifiedchangelog');
    expect(changelogTransactionID).toBe('tx');

    const [tableName, recordID, operation, oldRowState, newRowState, changedBy, plotID, censusID] = changelogParams;
    expect(tableName).toBe('coremeasurements');
    expect(recordID).toBe('42::edit-op-55');
    expect(operation).toBe('UPDATE');
    expect(oldRowState).toBeNull();
    expect(JSON.parse(newRowState)).toEqual({ MeasuredDBH: 10, summaryKind: BULK_REVISION_SUMMARY_KIND });
    expect(changedBy).toBe('mason@example.com');
    expect(plotID).toBe(1);
    expect(censusID).toBe(2);
  });

  it('maps Revertable from database rows when reading ledger entries', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue([
      {
        EditOperationID: 55,
        OperationType: 'bulk-revision-row',
        Revertable: 0,
        DataType: 'measurementssummary',
        TargetID: 42,
        PlotID: 1,
        CensusID: 2,
        PlanHash: 'a'.repeat(64),
        BeforeState: JSON.stringify([{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: null }]),
        AfterState: JSON.stringify([{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 12 } }]),
        CreatedBy: 'mason@example.com',
        CreatedAt: '2026-04-21T00:00:00.000Z',
        RevertedByEditOperationID: null
      }
    ]);

    const record = await readEditOperation(cm, 'forestgeo_testing', 55);

    expect(record).not.toBeNull();
    expect(record!.operationType).toBe('bulk-revision-row');
    expect(record!.revertable).toBe(false);
    expect(record!.afterState[0].row).toEqual({ MeasuredDBH: 12 });
  });

  it('readEditOperation without forUpdate omits FOR UPDATE and stays callable with no transactionID', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue([]);

    const record = await readEditOperation(cm, 'forestgeo_testing', ORIGINAL_EDIT_OPERATION_ID);

    expect(record).toBeNull();
    expect(cm.executeQuery.mock.calls[0][0]).not.toContain('FOR UPDATE');
    expect(cm.executeQuery.mock.calls[0][2]).toBeUndefined();
  });

  it('readEditOperation with forUpdate but no transactionID throws instead of silently reading unlocked', async () => {
    const cm = makeConnectionManager();

    await expect(readEditOperation(cm, 'forestgeo_testing', ORIGINAL_EDIT_OPERATION_ID, undefined, { forUpdate: true })).rejects.toBeInstanceOf(
      ReadEditOperationLockRequiresTransactionError
    );
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('readEditOperation with forUpdate and a transactionID appends FOR UPDATE and forwards the transactionID', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue([]);

    await readEditOperation(cm, 'forestgeo_testing', ORIGINAL_EDIT_OPERATION_ID, TRANSACTION_ID, { forUpdate: true });

    expect(cm.executeQuery.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(cm.executeQuery.mock.calls[0][1]).toEqual([ORIGINAL_EDIT_OPERATION_ID]);
    expect(cm.executeQuery.mock.calls[0][2]).toBe(TRANSACTION_ID);
  });

  it('markEditOperationReverted scopes the UPDATE to un-reverted rows and succeeds on exactly one affected row', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue({ affectedRows: 1 });

    await markEditOperationReverted(cm, 'forestgeo_testing', ORIGINAL_EDIT_OPERATION_ID, REVERTING_EDIT_OPERATION_ID, TRANSACTION_ID);

    expect(cm.executeQuery.mock.calls[0][0]).toContain('RevertedByEditOperationID IS NULL');
    expect(cm.executeQuery.mock.calls[0][1]).toEqual([REVERTING_EDIT_OPERATION_ID, ORIGINAL_EDIT_OPERATION_ID]);
    expect(cm.executeQuery.mock.calls[0][2]).toBe(TRANSACTION_ID);
  });

  it('markEditOperationReverted refuses a double-mark when the row is missing or already reverted', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue({ affectedRows: 0 });

    await expect(
      markEditOperationReverted(cm, 'forestgeo_testing', ORIGINAL_EDIT_OPERATION_ID, REVERTING_EDIT_OPERATION_ID, TRANSACTION_ID)
    ).rejects.toBeInstanceOf(MarkEditOperationRevertedConflictError);
  });

  describe('BeforeState/AfterState integrity via readEditOperation', () => {
    it('parses a legitimate JSON string array of marker and snapshot rows into the same array', async () => {
      const cm = makeConnectionManager();
      const beforeStateRows = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 10 } }];
      const afterStateRows = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 12 } }];
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ BeforeState: JSON.stringify(beforeStateRows), AfterState: JSON.stringify(afterStateRows) })]);

      const record = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID);

      expect(record?.beforeState).toEqual(beforeStateRows);
      expect(record?.afterState).toEqual(afterStateRows);
    });

    it('parses a genuinely empty "[]" string to [] without throwing', async () => {
      const cm = makeConnectionManager();
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ BeforeState: '[]', AfterState: '[]' })]);

      const record = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID);

      expect(record?.beforeState).toEqual([]);
      expect(record?.afterState).toEqual([]);
    });

    it('passes through a stored value that is already a JS array by content', async () => {
      const cm = makeConnectionManager();
      const alreadyArrayRows = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 1, row: { MeasuredDBH: 5 } }];
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ BeforeState: alreadyArrayRows, AfterState: alreadyArrayRows })]);

      const record = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID);

      expect(record?.beforeState).toEqual(alreadyArrayRows);
      expect(record?.afterState).toEqual(alreadyArrayRows);
    });

    it('rejects with EditOperationStateIntegrityError naming the row and column when BeforeState is unparseable JSON', async () => {
      const cm = makeConnectionManager();
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ BeforeState: `{not valid json ${DISTINCTIVE_ROW_PAYLOAD_MARKER}` })]);

      const error: EditOperationStateIntegrityError = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID).catch(e => e);

      expect(error).toBeInstanceOf(EditOperationStateIntegrityError);
      expect(error.editOperationID).toBe(STATE_INTEGRITY_EDIT_OPERATION_ID);
      expect(error.column).toBe('BeforeState' satisfies EditOperationStateColumn);
    });

    it.each([
      ['{"a":1}', 'JSON object'],
      ['5', 'JSON number scalar'],
      ['"x"', 'JSON string scalar'],
      ['null', 'JSON null scalar']
    ])('rejects with EditOperationStateIntegrityError (not []) when AfterState parses to a non-array: %s (%s)', async rawValue => {
      const cm = makeConnectionManager();
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ AfterState: rawValue })]);

      const result = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID).catch(e => e);

      expect(result).toBeInstanceOf(EditOperationStateIntegrityError);
      expect(result).not.toEqual([]);
      expect((result as EditOperationStateIntegrityError).column).toBe('AfterState');
    });

    it.each([
      ['BeforeState', null],
      ['BeforeState', undefined],
      ['BeforeState', ''],
      ['AfterState', null],
      ['AfterState', undefined],
      ['AfterState', '']
    ] as const)('rejects with EditOperationStateIntegrityError naming %s for raw value %p', async (column, rawValue) => {
      const cm = makeConnectionManager();
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ [column]: rawValue })]);

      const error: EditOperationStateIntegrityError = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID).catch(e => e);

      expect(error).toBeInstanceOf(EditOperationStateIntegrityError);
      expect(error.column).toBe(column);
      expect(error.editOperationID).toBe(STATE_INTEGRITY_EDIT_OPERATION_ID);
    });

    it('does not embed the stored payload contents in the error message even though V8 echoes a prefix of them in the raw SyntaxError', async () => {
      // V8's JSON.parse SyntaxError quotes only a short, truncated snippet of
      // the input (e.g. `"[SECRET_R"...`), not the full marker. Placing the
      // marker right after the unterminated `[` puts its visible prefix
      // directly in that snippet, proving the raw error does leak stored
      // content and that our wrapped error strips even that prefix.
      const cm = makeConnectionManager();
      const corruptBeforeState = `[${DISTINCTIVE_ROW_PAYLOAD_MARKER}`;
      const visiblePayloadPrefix = DISTINCTIVE_ROW_PAYLOAD_MARKER.slice(0, VISIBLE_PAYLOAD_PREFIX_LENGTH);
      cm.executeQuery.mockResolvedValue([buildLedgerRow({ BeforeState: corruptBeforeState })]);

      let rawParseError: unknown;
      try {
        JSON.parse(corruptBeforeState);
      } catch (e) {
        rawParseError = e;
      }
      expect((rawParseError as Error).message).toContain(visiblePayloadPrefix);

      const error: EditOperationStateIntegrityError = await readEditOperation(cm, 'forestgeo_testing', STATE_INTEGRITY_EDIT_OPERATION_ID).catch(e => e);

      expect(error).toBeInstanceOf(EditOperationStateIntegrityError);
      expect(error.message).not.toContain(DISTINCTIVE_ROW_PAYLOAD_MARKER);
      expect(error.message).not.toContain(visiblePayloadPrefix);
      expect(error.cause).toBeInstanceOf(SyntaxError);
    });
  });
});
