// lib/uploads/record-invalid-rows.test.ts
//
// Unit tests for recordInvalidRows and recordFailedMeasurementRows.
// No real DB — insertIngestionFailureRows is mocked. The tests verify:
//   - empty string → null for numeric fields ('' must not become 0 or NaN)
//   - empty string → null for string fields (old-worker 'value || null' semantics)
//   - missing / empty failureReason passes through as null (choke point owns the fallback)
//   - date formatting → 'YYYY-MM-DD'
//   - sourceRowIndexOffset arithmetic (chunked callers must pass running offset)
//   - recordFailedMeasurementRows passes per-row fileID/batchID overrides through

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories so vi.mock() closures can reference them.
// ---------------------------------------------------------------------------

const { insertIngestionFailureRowsMock } = vi.hoisted(() => ({
  insertIngestionFailureRowsMock: vi.fn()
}));

vi.mock('@/config/measurementerrors', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/measurementerrors')>()),
  insertIngestionFailureRows: insertIngestionFailureRowsMock
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

import { recordInvalidRows, recordFailedMeasurementRows, type InvalidRowContext } from './record-invalid-rows';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnectionManager() {
  return {} as any;
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
    // Default: mock returns one inserted ID per row.
    insertIngestionFailureRowsMock.mockImplementation((_conn: unknown, _schema: unknown, rows: unknown[]) => Promise.resolve(rows.map((_r, i) => i + 1)));
  });

  it('empty rows array returns 0 without calling insertIngestionFailureRows', async () => {
    const count = await recordInvalidRows(makeConnectionManager(), BASE_CTX, []);
    expect(count).toBe(0);
    expect(insertIngestionFailureRowsMock).not.toHaveBeenCalled();
  });

  it('empty-string numeric fields map to null, not 0 or NaN', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T001', lx: '', ly: '', dbh: '', hom: '' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].x).toBeNull();
    expect(rows[0].y).toBeNull();
    expect(rows[0].dbh).toBeNull();
    expect(rows[0].hom).toBeNull();
  });

  it('non-numeric strings for numeric fields map to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T002', lx: 'n/a', ly: 'unknown', dbh: '--', hom: 'tbd' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].x).toBeNull();
    expect(rows[0].y).toBeNull();
    expect(rows[0].dbh).toBeNull();
    expect(rows[0].hom).toBeNull();
  });

  it('non-scalar, non-decimal, and out-of-range runtime values map to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T002b', lx: true, ly: [], px: '0x10', py: 1000000, dbh: {}, hom: '-1000000' } as any]);

    const [row] = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(row).toMatchObject({ x: null, y: null, plotX: null, plotY: null, dbh: null, hom: null });
  });

  it('valid numeric strings produce finite numbers', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T003', lx: '1.5', ly: '2.75', dbh: '12.345', hom: '1.3' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].x).toBeCloseTo(1.5);
    expect(rows[0].y).toBeCloseTo(2.75);
    expect(rows[0].dbh).toBeCloseTo(12.345);
    expect(rows[0].hom).toBeCloseTo(1.3);
  });

  it('empty-string string fields (tag, stemTag, spCode, quadrat, codes, comments) map to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [
      { tag: '', stemtag: '', spcode: '', quadrat: '', codes: '', comments: '', failureReason: 'err' }
    ]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].tag).toBeNull();
    expect(rows[0].stemTag).toBeNull();
    expect(rows[0].spCode).toBeNull();
    expect(rows[0].quadrat).toBeNull();
    expect(rows[0].codes).toBeNull();
    expect(rows[0].comments).toBeNull();
  });

  it('maps px/py to plotX/plotY, NULL when absent', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T009a', px: '-0.271', py: '267.5' }, { tag: 'T009b' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].plotX).toBeCloseTo(-0.271);
    expect(rows[0].plotY).toBeCloseTo(267.5);
    expect(rows[1].plotX, 'absent plot coordinate must map to null, not 0').toBeNull();
    expect(rows[1].plotY).toBeNull();
  });

  it('missing failureReason passes through as null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T004' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].failureReason).toBeNull();
  });

  it('empty-string failureReason passes through as null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T005', failureReason: '' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].failureReason).toBeNull();
  });

  it('present failureReason is preserved as-is', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T006', failureReason: 'Missing required fields: quadrat' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].failureReason).toBe('Missing required fields: quadrat');
  });

  it('date is formatted as YYYY-MM-DD', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T007', date: '2024-05-20' }]);

    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].date).toBe('2024-05-20');
  });

  it('absent date maps to null', async () => {
    await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T008' }]);
    const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(rows[0].date).toBeNull();
  });

  describe('sourceRowIndexOffset arithmetic', () => {
    it('offset=0 (default): first row gets sourceRowIndex=1', async () => {
      await recordInvalidRows(makeConnectionManager(), BASE_CTX, [{ tag: 'T010' }, { tag: 'T011' }, { tag: 'T012' }]);

      const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
      expect(rows[0].sourceRowIndex).toBe(1);
      expect(rows[1].sourceRowIndex).toBe(2);
      expect(rows[2].sourceRowIndex).toBe(3);
    });

    it('offset=3: first row gets sourceRowIndex=4 (chunked second call scenario)', async () => {
      const ctx: InvalidRowContext = { ...BASE_CTX, sourceRowIndexOffset: 3 };
      await recordInvalidRows(makeConnectionManager(), ctx, [{ tag: 'T020' }, { tag: 'T021' }]);

      const rows = insertIngestionFailureRowsMock.mock.calls[0][2];
      expect(rows[0].sourceRowIndex).toBe(4);
      expect(rows[1].sourceRowIndex).toBe(5);
    });

    it('two sequential chunk calls with offsets 0 and 3 produce non-overlapping indexes', async () => {
      const ctxChunk1: InvalidRowContext = { ...BASE_CTX, sourceRowIndexOffset: 0 };
      const ctxChunk2: InvalidRowContext = { ...BASE_CTX, sourceRowIndexOffset: 3 };

      await recordInvalidRows(makeConnectionManager(), ctxChunk1, [{ tag: 'A001' }, { tag: 'A002' }, { tag: 'A003' }]);
      await recordInvalidRows(makeConnectionManager(), ctxChunk2, [{ tag: 'A004' }, { tag: 'A005' }]);

      const chunk1Rows = insertIngestionFailureRowsMock.mock.calls[0][2];
      const chunk2Rows = insertIngestionFailureRowsMock.mock.calls[1][2];

      const chunk1Indexes = chunk1Rows.map((r: any) => r.sourceRowIndex);
      const chunk2Indexes = chunk2Rows.map((r: any) => r.sourceRowIndex);

      expect(chunk1Indexes).toEqual([1, 2, 3]);
      expect(chunk2Indexes).toEqual([4, 5]);

      const allIndexes = [...chunk1Indexes, ...chunk2Indexes];
      const unique = new Set(allIndexes);
      expect(unique.size).toBe(allIndexes.length);
    });
  });
});

describe('recordFailedMeasurementRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertIngestionFailureRowsMock.mockImplementation((_conn: unknown, _schema: unknown, rows: unknown[]) => Promise.resolve(rows.map((_r, i) => i + 1)));
  });

  it('empty rows returns 0 without calling insertIngestionFailureRows', async () => {
    const count = await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', [], 'f.csv', 'b-001', 1, 2);
    expect(count).toBe(0);
    expect(insertIngestionFailureRowsMock).not.toHaveBeenCalled();
  });

  it('per-row fileID/batchID overrides take precedence over caller-level defaults', async () => {
    const rows = [
      { tag: 'T030', failureReasons: 'bad data', fileID: 'override-file.csv', batchID: 'override-batch' } as any,
      { tag: 'T031', failureReasons: 'wrong coords' } as any
    ];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'default-file.csv', 'default-batch', 10, 20);

    const mapped = insertIngestionFailureRowsMock.mock.calls[0][2];
    // Row 0 has per-row overrides — must win.
    expect(mapped[0].fileID).toBe('override-file.csv');
    expect(mapped[0].batchID).toBe('override-batch');
    // Row 1 falls back to caller-level defaults.
    expect(mapped[1].fileID).toBe('default-file.csv');
    expect(mapped[1].batchID).toBe('default-batch');
  });

  it('plotID and censusID from caller args are applied to every row', async () => {
    const rows = [{ tag: 'T040', failureReasons: 'err A' } as any, { tag: 'T041', failureReasons: 'err B' } as any];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-002', 55, 99);

    const mapped = insertIngestionFailureRowsMock.mock.calls[0][2];
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

    const mapped = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(mapped[0].plotX).toBe(-0.271);
    expect(mapped[0].plotY).toBe(267.5);
    expect(mapped[1].plotX, 'absent plot coordinate must map to null, not undefined/0').toBeNull();
    expect(mapped[1].plotY).toBeNull();
  });

  it('normalizes runtime numeric strings, preserves zero, and nulls malformed rejected values', async () => {
    const rows = [{ tag: 'T060', failureReasons: 'bad plot x', plotX: 'abc', plotY: 0, x: '1.25', y: '   ', dbh: 'Infinity' } as any];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-004', 1, 2);

    const [mapped] = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(mapped).toMatchObject({ x: 1.25, y: null, plotX: null, plotY: 0, dbh: null });
  });

  it('maps HTTP rejected-row comments from the wire field `comments`, not `description`', async () => {
    insertIngestionFailureRowsMock.mockResolvedValue([1]);
    await recordFailedMeasurementRows(
      makeConnectionManager(),
      'forestgeo_testing',
      [{ comments: 'field note', failureReasons: 'reason text' } as any],
      'f.csv',
      'b1',
      1,
      2
    );
    const input = insertIngestionFailureRowsMock.mock.calls[0][2][0];
    expect(input.comments).toBe('field note');
    expect(input.failureReason).toBe('reason text');
  });

  it('missing comments and failureReasons pass through as null', async () => {
    const rows = [{ tag: 'T070' } as any];

    await recordFailedMeasurementRows(makeConnectionManager(), 'forestgeo_test', rows, 'f.csv', 'b-005', 1, 2);

    const [mapped] = insertIngestionFailureRowsMock.mock.calls[0][2];
    expect(mapped.comments).toBeNull();
    expect(mapped.failureReason).toBeNull();
  });
});
