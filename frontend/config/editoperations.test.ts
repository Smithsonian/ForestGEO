import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureEditOperationsTable, readEditOperation, writeEditOperation, type EditOperationWriteInput } from './editoperations';

function makeConnectionManager() {
  return {
    executeQuery: vi.fn()
  } as any;
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

    const id = await writeEditOperation(
      cm,
      'forestgeo_testing',
      buildInput({ operationType: 'bulk-revision-row', revertable: false, targetID: null }),
      'tx'
    );

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

  it('writes bulk revision row ledger entries with explicit revertability', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValue({ insertId: 55 });

    const id = await writeEditOperation(cm, 'forestgeo_testing', buildInput({ operationType: 'bulk-revision-row', revertable: false }), 'tx');

    expect(id).toBe(55);
    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('OperationType, Revertable, DataType');
    expect(cm.executeQuery.mock.calls[0][1][0]).toBe('bulk-revision-row');
    expect(cm.executeQuery.mock.calls[0][1][1]).toBe(false);
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
});
