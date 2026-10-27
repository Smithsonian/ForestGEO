// lib/uploads/record-invalid-rows.test.ts
//
// Unit tests for recordInvalidRows, recordFailedMeasurementRows, and
// deleteUnresolvedRowsForBatchFamily. No real DB — the audited persistence/delete
// helpers (@/lib/changelog/ingestion-failure-audit, @/lib/ingestion/temporary-measurements)
// are mocked so these tests stay scoped to THIS module's own responsibility: row-shape
// mapping, and the own-or-caller transaction contract (#507). The audit diff mechanics
// themselves (INSERT vs UPDATE vs no-op classification, DELETE audit rows) are exercised
// against a real database in tests/integration/record-invalid-rows.test.ts.
//
// Covers:
//   - empty string → null for numeric fields ('' must not become 0 or NaN)
//   - empty string → null for string fields (old-worker 'value || null' semantics)
//   - missing / empty failureReason passes through as null (choke point owns the fallback)
//   - date formatting → 'YYYY-MM-DD'
//   - sourceRowIndexOffset arithmetic (chunked callers must pass running offset)
//   - recordFailedMeasurementRows passes per-row fileID/batchID overrides through
//   - changedBy is forwarded to the audited persistence/delete call, defaulting to null
//   - own-or-caller transaction: a supplied transactionID is reused verbatim and never
//     committed/rolled back by this module; an omitted one is begun, committed on
//     success, and rolled back (then rethrown) on failure
//   - deleteUnresolvedRowsForBatchFamily resolves an omitted plotID from the census row
//     inside the active transaction, and throws MissingCensusPlotIDError (no delete, own
//     transaction rolled back) when that census row does not exist

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories so vi.mock() closures can reference them.
// ---------------------------------------------------------------------------

const { recordAuditedIngestionFailureRowsMock, deleteCoreMeasurementsInBoundedChunksWithAuditMock } = vi.hoisted(() => ({
  recordAuditedIngestionFailureRowsMock: vi.fn(),
  deleteCoreMeasurementsInBoundedChunksWithAuditMock: vi.fn()
}));

vi.mock('@/lib/changelog/ingestion-failure-audit', () => ({
  recordAuditedIngestionFailureRows: recordAuditedIngestionFailureRowsMock
}));

vi.mock('@/lib/ingestion/temporary-measurements', () => ({
  deleteCoreMeasurementsInBoundedChunksWithAudit: deleteCoreMeasurementsInBoundedChunksWithAuditMock
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: { getInstance: () => ({}) }
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  safeFormatQuery: (_schema: string, sql: string) => sql
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
  recordInvalidRows,
  recordFailedMeasurementRows,
  deleteUnresolvedRowsForBatchFamily,
  MissingCensusPlotIDError,
  type InvalidRowContext
} from './record-invalid-rows';
import { buildSubBatchPattern } from '@/lib/uploads/batch-family';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A connectionManager double that tracks beginTransaction/commitTransaction/
 * rollbackTransaction calls so the own-or-caller transaction tests can assert
 * on them directly, independent of the (mocked) audited persistence/delete call.
 * `executeQuery` is the census-PlotID-lookup surface deleteUnresolvedRowsForBatchFamily
 * reads through transactionExecutorFor when the caller omits `plotID`; it defaults to
 * an empty result set and is overridden per-test via makeConnectionManagerWithCensusRow.
 */
function makeConnectionManager() {
  return {
    beginTransaction: vi.fn().mockResolvedValue('owned-tx-1'),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([])
  } as any;
}

/** Stubs the census PlotID lookup: `plotID: null` simulates no matching census row. */
function makeConnectionManagerWithCensusRow(plotID: number | null) {
  const connectionManager = makeConnectionManager();
  connectionManager.executeQuery = vi.fn().mockResolvedValue(plotID == null ? [] : [{ PlotID: plotID }]);
  return connectionManager;
}

const BASE_CTX: InvalidRowContext = {
  schema: 'forestgeo_test',
  plotID: 1,
  censusID: 2,
  fileName: 'test.csv',
  batchID: 'batch-001'
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('recordInvalidRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: one measurementID per input row, nothing inserted/updated/unchanged-classified
    // (these counts belong to the audited helper's own tests, not this module's).
    recordAuditedIngestionFailureRowsMock.mockImplementation(async (params: { rows: unknown[] }) =>
      Promise.resolve({
        measurementIDs: params.rows.map((_row, i) => i + 1),
        insertedCount: params.rows.length,
        updatedCount: 0,
        unchangedCount: 0
      })
    );
  });

  it('empty rows array returns 0 without calling recordAuditedIngestionFailureRows', async () => {
    const count = await recordInvalidRows(makeConnectionManager(), BASE_CTX, []);
    expect(count).toBe(0);
    expect(recordAuditedIngestionFailureRowsMock).not.toHaveBeenCalled();
  });

  it('empty-string numeric fields map to null, not 0 or NaN', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T001', lx: '', ly: '', dbh: '', hom: '' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].x).toBeNull();
    expect(rows[0].y).toBeNull();
    expect(rows[0].dbh).toBeNull();
    expect(rows[0].hom).toBeNull();
  });

  it('non-numeric strings for numeric fields map to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T002', lx: 'n/a', ly: 'unknown', dbh: '--', hom: 'tbd' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].x).toBeNull();
    expect(rows[0].y).toBeNull();
    expect(rows[0].dbh).toBeNull();
    expect(rows[0].hom).toBeNull();
  });

  it('non-scalar, non-decimal, and out-of-range runtime values map to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T002b', lx: true, ly: [], px: '0x10', py: 1000000, dbh: {}, hom: '-1000000' } as any]);

    const {
      rows: [row]
    } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(row).toMatchObject({ x: null, y: null, plotX: null, plotY: null, dbh: null, hom: null });
  });

  it('valid numeric strings produce finite numbers', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T003', lx: '1.5', ly: '2.75', dbh: '12.345', hom: '1.3' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].x).toBeCloseTo(1.5);
    expect(rows[0].y).toBeCloseTo(2.75);
    expect(rows[0].dbh).toBeCloseTo(12.345);
    expect(rows[0].hom).toBeCloseTo(1.3);
  });

  it('empty-string string fields (tag, stemTag, spCode, quadrat, codes, comments) map to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [
      { tag: '', stemtag: '', spcode: '', quadrat: '', codes: '', comments: '', failureReason: 'err' }
    ]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].tag).toBeNull();
    expect(rows[0].stemTag).toBeNull();
    expect(rows[0].spCode).toBeNull();
    expect(rows[0].quadrat).toBeNull();
    expect(rows[0].codes).toBeNull();
    expect(rows[0].comments).toBeNull();
  });

  it('maps px/py to plotX/plotY, NULL when absent', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T009a', px: '-0.271', py: '267.5' }, { tag: 'T009b' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].plotX).toBeCloseTo(-0.271);
    expect(rows[0].plotY).toBeCloseTo(267.5);
    expect(rows[1].plotX, 'absent plot coordinate must map to null, not 0').toBeNull();
    expect(rows[1].plotY).toBeNull();
  });

  it('missing failureReason passes through as null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T004' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].failureReason).toBeNull();
  });

  it('empty-string failureReason passes through as null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T005', failureReason: '' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].failureReason).toBeNull();
  });

  it('present failureReason is preserved as-is', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T006', failureReason: 'Missing required fields: quadrat' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].failureReason).toBe('Missing required fields: quadrat');
  });

  it('date is formatted as YYYY-MM-DD', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T007', date: '2024-05-20' }]);

    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].date).toBe('2024-05-20');
  });

  it('absent date maps to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T008' }]);
    const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(rows[0].date).toBeNull();
  });

  describe('sourceRowIndexOffset arithmetic', () => {
    it('offset=0 (default): first row gets sourceRowIndex=1', async () => {
      await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T010' }, { tag: 'T011' }, { tag: 'T012' }]);

      const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
      expect(rows[0].sourceRowIndex).toBe(1);
      expect(rows[1].sourceRowIndex).toBe(2);
      expect(rows[2].sourceRowIndex).toBe(3);
    });

    it('offset=3: first row gets sourceRowIndex=4 (chunked second call scenario)', async () => {
      const ctx: InvalidRowContext = { ...BASE_CTX, sourceRowIndexOffset: 3 };
      await recordInvalidRows(makeConnectionManager(), ctx, [{ tag: 'T020' }, { tag: 'T021' }]);

      const { rows } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
      expect(rows[0].sourceRowIndex).toBe(4);
      expect(rows[1].sourceRowIndex).toBe(5);
    });

    it('two sequential chunk calls with offsets 0 and 3 produce non-overlapping indexes', async () => {
      const ctxChunk1: InvalidRowContext = { ...BASE_CTX, sourceRowIndexOffset: 0 };
      const ctxChunk2: InvalidRowContext = { ...BASE_CTX, sourceRowIndexOffset: 3 };

      await recordInvalidRows(makeConnectionManager(), ctxChunk1, [{ tag: 'A001' }, { tag: 'A002' }, { tag: 'A003' }]);
      await recordInvalidRows(makeConnectionManager(), ctxChunk2, [{ tag: 'A004' }, { tag: 'A005' }]);

      const chunk1Rows = recordAuditedIngestionFailureRowsMock.mock.calls[0][0].rows;
      const chunk2Rows = recordAuditedIngestionFailureRowsMock.mock.calls[1][0].rows;

      const chunk1Indexes = chunk1Rows.map((r: any) => r.sourceRowIndex);
      const chunk2Indexes = chunk2Rows.map((r: any) => r.sourceRowIndex);

      expect(chunk1Indexes).toEqual([1, 2, 3]);
      expect(chunk2Indexes).toEqual([4, 5]);

      const allIndexes = [...chunk1Indexes, ...chunk2Indexes];
      const unique = new Set(allIndexes);
      expect(unique.size).toBe(allIndexes.length);
    });
  });

  describe('changedBy attribution', () => {
    it('defaults to null when ctx.changedBy is omitted', async () => {
      await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T100' }]);
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].changedBy).toBeNull();
    });

    it('forwards ctx.changedBy to the audited persistence call', async () => {
      const ctx: InvalidRowContext = { ...BASE_CTX, changedBy: 'worker-job-creator@example.com' };
      await recordInvalidRows(makeConnectionManager(), ctx, [{ tag: 'T101' }]);
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].changedBy).toBe('worker-job-creator@example.com');
    });

    it('an explicit null ctx.changedBy stays null (not coerced to a string)', async () => {
      const ctx: InvalidRowContext = { ...BASE_CTX, changedBy: null };
      await recordInvalidRows(makeConnectionManager(), ctx, [{ tag: 'T102' }]);
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].changedBy).toBeNull();
    });
  });

  describe('own-or-caller transaction contract (#507)', () => {
    it('opens its own transaction, delegates with it, and commits on success when no transactionID is supplied', async () => {
      const connectionManager = makeConnectionManager();
      const count = await recordInvalidRows(connectionManager, BASE_CTX, [{ tag: 'T200' }]);

      expect(count).toBe(1);
      expect(connectionManager.beginTransaction).toHaveBeenCalledTimes(1);
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].transactionID).toBe('owned-tx-1');
      expect(connectionManager.commitTransaction).toHaveBeenCalledWith('owned-tx-1');
      expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('reuses the supplied transactionID verbatim and never begins, commits, or rolls back its own', async () => {
      const connectionManager = makeConnectionManager();
      await recordInvalidRows(connectionManager, BASE_CTX, [{ tag: 'T201' }], 'caller-tx-7');

      expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].transactionID).toBe('caller-tx-7');
      expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
      expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('rolls back its own transaction and rethrows the original error when the audited call fails', async () => {
      const connectionManager = makeConnectionManager();
      const failure = new Error('audit write failed');
      recordAuditedIngestionFailureRowsMock.mockRejectedValueOnce(failure);

      await expect(recordInvalidRows(connectionManager, BASE_CTX, [{ tag: 'T202' }])).rejects.toBe(failure);

      expect(connectionManager.rollbackTransaction).toHaveBeenCalledWith('owned-tx-1');
      expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
    });

    it('does NOT roll back a caller-supplied transaction when the audited call fails — the caller owns that decision', async () => {
      const connectionManager = makeConnectionManager();
      const failure = new Error('audit write failed');
      recordAuditedIngestionFailureRowsMock.mockRejectedValueOnce(failure);

      await expect(recordInvalidRows(connectionManager, BASE_CTX, [{ tag: 'T203' }], 'caller-tx-8')).rejects.toBe(failure);

      expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
      expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
    });
  });
});

describe('recordFailedMeasurementRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAuditedIngestionFailureRowsMock.mockImplementation(async (params: { rows: unknown[] }) =>
      Promise.resolve({
        measurementIDs: params.rows.map((_row, i) => i + 1),
        insertedCount: params.rows.length,
        updatedCount: 0,
        unchangedCount: 0
      })
    );
  });

  it('empty rows returns 0 without calling recordAuditedIngestionFailureRows', async () => {
    const count = await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', [], 'f.csv', 'b-001', 1, 2);
    expect(count).toBe(0);
    expect(recordAuditedIngestionFailureRowsMock).not.toHaveBeenCalled();
  });

  it('ignores per-row fileID/batchID overrides and uses caller-level identity', async () => {
    const rows = [
      { tag: 'T030', failureReasons: 'bad data', fileID: 'override-file.csv', batchID: 'override-batch' } as any,
      { tag: 'T031', failureReasons: 'wrong coords' } as any
    ];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'default-file.csv', 'default-batch', 10, 20);

    const { rows: mapped } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    // Row 0 cannot redirect the persistence boundary.
    expect(mapped[0].fileID).toBe('default-file.csv');
    expect(mapped[0].batchID).toBe('default-batch');
    // Row 1 uses the same caller-level defaults.
    expect(mapped[1].fileID).toBe('default-file.csv');
    expect(mapped[1].batchID).toBe('default-batch');
  });

  it('plotID and censusID from caller args are applied to every row', async () => {
    const rows = [{ tag: 'T040', failureReasons: 'err A' } as any, { tag: 'T041', failureReasons: 'err B' } as any];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-002', 55, 99);

    const { rows: mapped } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(mapped[0].plotID).toBe(55);
    expect(mapped[0].censusID).toBe(99);
    expect(mapped[1].plotID).toBe(55);
    expect(mapped[1].censusID).toBe(99);
  });

  it('carries row.plotX/row.plotY through, NULL when absent', async () => {
    const rows = [
      { tag: 'T050', failureReasons: 'coordinate drift', plotX: -0.271, plotY: 267.5 } as any,
      { tag: 'T051', failureReasons: 'missing plot coordinates' } as any
    ];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-003', 1, 2);

    const { rows: mapped } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(mapped[0].plotX).toBe(-0.271);
    expect(mapped[0].plotY).toBe(267.5);
    expect(mapped[1].plotX, 'absent plot coordinate must map to null, not undefined/0').toBeNull();
    expect(mapped[1].plotY).toBeNull();
  });

  it('normalizes runtime numeric strings, preserves zero, and nulls malformed rejected values', async () => {
    const rows = [{ tag: 'T060', failureReasons: 'bad plot x', plotX: 'abc', plotY: 0, x: '1.25', y: '   ', dbh: 'Infinity' } as any];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-004', 1, 2);

    const {
      rows: [mapped]
    } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(mapped).toMatchObject({ x: 1.25, y: null, plotX: null, plotY: 0, dbh: null });
  });

  it('maps HTTP rejected-row comments from the wire field `comments`, not `description`', async () => {
    await recordFailedMeasurementRows(
      makeConnectionManager(),
      'forestgeo_testing',
      [{ comments: 'field note', failureReasons: 'reason text' } as any],
      'f.csv',
      'b1',
      1,
      2
    );
    const input = recordAuditedIngestionFailureRowsMock.mock.calls[0][0].rows[0];
    expect(input.comments).toBe('field note');
    expect(input.failureReason).toBe('reason text');
  });

  it('missing comments and failureReasons pass through as null', async () => {
    const rows = [{ tag: 'T070' } as any];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-005', 1, 2);

    const {
      rows: [mapped]
    } = recordAuditedIngestionFailureRowsMock.mock.calls[0][0];
    expect(mapped.comments).toBeNull();
    expect(mapped.failureReason).toBeNull();
  });

  describe('changedBy attribution', () => {
    it('defaults to null when the caller omits it', async () => {
      await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', [{ tag: 'T080' } as any], 'f.csv', 'b-006', 1, 2, undefined);
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].changedBy).toBeNull();
    });

    it('forwards an explicit changedBy (the batchedupload route passes the authenticated session identity)', async () => {
      await recordFailedMeasurementRows(
        makeConnectionManager(),
        'forestgeo_test',
        [{ tag: 'T081' } as any],
        'f.csv',
        'b-007',
        1,
        2,
        'tx-caller',
        'route-session-user@example.com'
      );
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].changedBy).toBe('route-session-user@example.com');
    });
  });

  describe('own-or-caller transaction contract (#507)', () => {
    it('opens its own transaction and commits on success when no transactionID is supplied', async () => {
      const connectionManager = makeConnectionManager();
      await recordFailedMeasurementRows(connectionManager, 'forestgeo_test', [{ tag: 'T090' } as any], 'f.csv', 'b-008', 1, 2);

      expect(connectionManager.beginTransaction).toHaveBeenCalledTimes(1);
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].transactionID).toBe('owned-tx-1');
      expect(connectionManager.commitTransaction).toHaveBeenCalledWith('owned-tx-1');
    });

    it("reuses the caller's transactionID (the batchedupload route's own begun transaction) without beginning or committing its own", async () => {
      const connectionManager = makeConnectionManager();
      await recordFailedMeasurementRows(connectionManager, 'forestgeo_test', [{ tag: 'T091' } as any], 'f.csv', 'b-009', 1, 2, 'route-tx-1');

      expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
      expect(recordAuditedIngestionFailureRowsMock.mock.calls[0][0].transactionID).toBe('route-tx-1');
      expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
    });
  });
});

describe('deleteUnresolvedRowsForBatchFamily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCoreMeasurementsInBoundedChunksWithAuditMock.mockResolvedValue(3);
  });

  it('forwards schema, censusID, and changedBy (defaulting to null) to the audited delete, using the explicitly supplied plotID', async () => {
    const connectionManager = makeConnectionManager();
    const count = await deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 20, 'caller-tx', [], null, 10);

    expect(count).toBe(3);
    expect(connectionManager.executeQuery, 'an explicitly supplied plotID must skip the census lookup entirely').not.toHaveBeenCalled();
    const [connArg, schemaArg, , , changedByArg, plotIDArg, censusIDArg, txArg] = deleteCoreMeasurementsInBoundedChunksWithAuditMock.mock.calls[0];
    expect(connArg).toBe(connectionManager);
    expect(schemaArg).toBe('forestgeo_test');
    expect(changedByArg).toBeNull();
    expect(plotIDArg).toBe(10);
    expect(censusIDArg).toBe(20);
    expect(txArg).toBe('caller-tx');
  });

  it('forwards an explicit changedBy through to the audited delete', async () => {
    const connectionManager = makeConnectionManager();
    await deleteUnresolvedRowsForBatchFamily(
      connectionManager,
      'forestgeo_test',
      'f.csv',
      'batch-1',
      20,
      'caller-tx',
      [],
      'worker-job-creator@example.com',
      10
    );

    const [, , , , changedByArg] = deleteCoreMeasurementsInBoundedChunksWithAuditMock.mock.calls[0];
    expect(changedByArg).toBe('worker-job-creator@example.com');
  });

  it('builds a family-scoped whereSQL/whereParams pair covering the original batch, its sub-batches, and the preserve-list exclusion', async () => {
    const connectionManager = makeConnectionManager();
    await deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 20, 'caller-tx', ['batch-1__sub001'], null, 10);

    const [, , whereSQL, whereParams] = deleteCoreMeasurementsInBoundedChunksWithAuditMock.mock.calls[0];
    expect(whereSQL).toMatch(/UploadFileID = \?/);
    expect(whereSQL).toMatch(/CensusID = \?/);
    expect(whereSQL).toMatch(/StemGUID IS NULL/);
    expect(whereSQL).toMatch(/UploadBatchID = \? OR UploadBatchID LIKE \?/);
    expect(whereSQL).toMatch(/UploadBatchID NOT IN \(\?\)/);
    expect(whereParams).toEqual(['f.csv', 20, 'batch-1', buildSubBatchPattern('batch-1'), 'batch-1__sub001']);
  });

  describe('plotID resolution from the census row (#507)', () => {
    it('resolves plotID via the census lookup when omitted, passing the resolved value through to the audited delete', async () => {
      const connectionManager = makeConnectionManagerWithCensusRow(77);
      await deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 20, 'caller-tx');

      expect(connectionManager.executeQuery).toHaveBeenCalledTimes(1);
      const [censusLookupSQL, censusLookupParams] = connectionManager.executeQuery.mock.calls[0];
      expect(censusLookupSQL).toMatch(/SELECT PlotID FROM .*\.census WHERE CensusID = \?/);
      expect(censusLookupParams).toEqual([20]);

      const plotIDArg = deleteCoreMeasurementsInBoundedChunksWithAuditMock.mock.calls[0][5];
      expect(plotIDArg).toBe(77);
    });

    it('throws MissingCensusPlotIDError and performs no delete when the census row is missing, rolling back its own transaction', async () => {
      const connectionManager = makeConnectionManagerWithCensusRow(null);

      await expect(deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 999)).rejects.toBeInstanceOf(
        MissingCensusPlotIDError
      );

      expect(deleteCoreMeasurementsInBoundedChunksWithAuditMock, 'a missing census row must short-circuit before any delete').not.toHaveBeenCalled();
      // No transactionID was supplied, so this still ran inside — and must roll back — its own transaction.
      expect(connectionManager.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connectionManager.rollbackTransaction).toHaveBeenCalledWith('owned-tx-1');
      expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('own-or-caller transaction contract (#507)', () => {
    it('opens its own transaction, commits on success, when no transactionID is supplied', async () => {
      const connectionManager = makeConnectionManagerWithCensusRow(55);
      await deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 20);

      expect(connectionManager.beginTransaction).toHaveBeenCalledTimes(1);
      const txArg = deleteCoreMeasurementsInBoundedChunksWithAuditMock.mock.calls[0][7];
      expect(txArg).toBe('owned-tx-1');
      expect(connectionManager.commitTransaction).toHaveBeenCalledWith('owned-tx-1');
    });

    it('rolls back its own transaction and rethrows when the audited delete fails', async () => {
      const connectionManager = makeConnectionManagerWithCensusRow(55);
      const failure = new Error('delete audit write failed');
      deleteCoreMeasurementsInBoundedChunksWithAuditMock.mockRejectedValueOnce(failure);

      await expect(deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 20)).rejects.toBe(failure);

      expect(connectionManager.rollbackTransaction).toHaveBeenCalledWith('owned-tx-1');
      expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
    });

    it("reuses the caller's transactionID without beginning, committing, or rolling back its own", async () => {
      const connectionManager = makeConnectionManager();
      await deleteUnresolvedRowsForBatchFamily(connectionManager, 'forestgeo_test', 'f.csv', 'batch-1', 20, 'caller-tx-9', [], null, 10);

      expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
      const txArg = deleteCoreMeasurementsInBoundedChunksWithAuditMock.mock.calls[0][7];
      expect(txArg).toBe('caller-tx-9');
      expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
      expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
    });
  });
});
