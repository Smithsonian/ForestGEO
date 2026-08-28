import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveTemporaryBatchToFailedMeasurements } from './batchfailuretransfer';

const ensureMeasurementErrorDefinition = vi.hoisted(() => vi.fn());

// Only the DB-touching definition upsert is stubbed. The classifier and message
// lookup stay REAL so this suite proves the code that actually reaches
// measurement_errors, rather than a hardcoded stand-in.
vi.mock('@/config/measurementerrors', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/measurementerrors')>();
  return { ...actual, ensureMeasurementErrorDefinition };
});

describe('moveTemporaryBatchToFailedMeasurements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves temporary rows into unresolved coremeasurements and deletes temp rows', async () => {
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-1'),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(22);

    const movedRows = await moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-1', 'failed');

    expect(movedRows).toBe(1);
    expect(ensureMeasurementErrorDefinition).toHaveBeenCalledTimes(1);
    expect(connectionManager.executeQuery).toHaveBeenCalledTimes(4);
    expect(connectionManager.commitTransaction).toHaveBeenCalledWith('tx-1');
    expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rolls back when the transfer fails', async () => {
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-2'),
      executeQuery: vi.fn().mockRejectedValue(new Error('select failed')),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;

    await expect(moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-2', 'failed')).rejects.toThrow(
      'select failed'
    );

    expect(connectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-2');
    expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
  });

  it('reuses an existing transaction when one is provided', async () => {
    const connectionManager = {
      beginTransaction: vi.fn(),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn()
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(22);

    const movedRows = await moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-3', 'failed', 'outer-tx');

    expect(movedRows).toBe(1);
    expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
    expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
    expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
    expect(connectionManager.executeQuery).toHaveBeenNthCalledWith(1, expect.any(String), ['file.csv', 'batch-3'], 'outer-tx');
  });

  /**
   * Incident path: when a batch is abandoned mid-flight, its staged rows are
   * moved to unresolved coremeasurements carrying the interruption reason. The
   * code recorded against them must say "interrupted", not "SQL exception" —
   * otherwise clean rows are permanently mislabelled as defective data.
   */
  it('records an interrupted batch under INTERRUPTED_UPLOAD rather than SQL_EXCEPTION', async () => {
    const INTERRUPTION_REASON = 'Upload session upload_ms3jw74a_97uvta1zlug cleaned up after abandonment';
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-interrupted'),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 3 }])
        .mockResolvedValueOnce({ affectedRows: 3 })
        .mockResolvedValueOnce({ affectedRows: 3 })
        .mockResolvedValueOnce({ affectedRows: 3 }),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(31);

    const movedRows = await moveTemporaryBatchToFailedMeasurements(
      connectionManager,
      'forestgeo_harvard',
      'harvard2014b.TXT',
      'batch-interrupted',
      INTERRUPTION_REASON
    );

    expect(movedRows).toBe(3);
    expect(ensureMeasurementErrorDefinition).toHaveBeenCalledTimes(1);

    const [, schema, source, errorCode, errorMessage] = ensureMeasurementErrorDefinition.mock.calls[0];
    expect(schema).toBe('forestgeo_harvard');
    expect(source).toBe('ingestion');
    expect(errorCode).toBe('INTERRUPTED_UPLOAD');
    expect(errorCode).not.toBe('SQL_EXCEPTION');
    expect(String(errorMessage).toLowerCase()).toContain('interrupted');
  });

  /**
   * This is the ONLY path that both materializes an abandoned batch's rows
   * into coremeasurements AND deletes their temporarymeasurements source
   * (see the DELETE FROM ??.temporarymeasurements below the INSERT in
   * moveTemporaryBatchToFailedMeasurements). If the INSERT doesn't carry
   * RawPlotX/RawPlotY across, the row's plot coordinates are permanently
   * unrecoverable — there is no second copy anywhere else.
   *
   * Splits the INSERT's column list and SELECT list on top-level commas
   * (paren-depth-aware, since `LEFT(?, 255)` contains a non-splitting comma)
   * so the assertion tracks the real column<->expression positions instead
   * of a hard-coded offset that breaks silently on column reordering.
   */
  it('threads RawPlotX/RawPlotY from temporarymeasurements.PlotX/PlotY into the coremeasurements INSERT', async () => {
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-plot'),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(22);

    await moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-plot', 'failed');

    const insertCall = connectionManager.executeQuery.mock.calls.find(
      (call: any[]) => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('coremeasurements')
    );
    expect(insertCall).toBeDefined();
    const insertSQL = String(insertCall![0]);

    const columnListText = insertSQL.match(/coremeasurements\s*\(([^)]+)\)/i)?.[1] ?? '';
    // safeFormatQuery has already substituted the `??` schema placeholder
    // with a backtick-quoted identifier by the time this reaches
    // executeQuery, so the SELECT list ends where "FROM `<schema>`" begins.
    const selectListText = insertSQL.split(/\bFROM\s+`/)[0].split(/SELECT\s+tm\.CensusID/)[1] ?? '';
    expect(columnListText, 'INSERT column list must be present').not.toBe('');
    expect(selectListText, 'SELECT expression list must be present').not.toBe('');

    const columns = splitTopLevelCommas(columnListText);
    const selectExpressions = splitTopLevelCommas(`tm.CensusID${selectListText}`);
    expect(selectExpressions.length, 'SELECT expression count must match INSERT column count').toBe(columns.length);

    const rawPlotXIndex = columns.indexOf('RawPlotX');
    const rawPlotYIndex = columns.indexOf('RawPlotY');
    expect(rawPlotXIndex, 'RawPlotX must be present in the INSERT column list').toBeGreaterThanOrEqual(0);
    expect(rawPlotYIndex, 'RawPlotY must be present in the INSERT column list').toBeGreaterThanOrEqual(0);

    // Shape parity anchor: RawX/RawY already mapped to tm.LocalX/tm.LocalY;
    // RawPlotX/RawPlotY must map to tm.PlotX/tm.PlotY at the same relative position.
    expect(selectExpressions[columns.indexOf('RawX')]).toBe('tm.LocalX');
    expect(selectExpressions[columns.indexOf('RawY')]).toBe('tm.LocalY');
    expect(selectExpressions[rawPlotXIndex], 'RawPlotX must be sourced from tm.PlotX').toBe('tm.PlotX');
    expect(selectExpressions[rawPlotYIndex], 'RawPlotY must be sourced from tm.PlotY').toBe('tm.PlotY');

    // Confirms this task's explicit exclusion: RawPublishedStemID is a
    // separate, pre-existing, out-of-scope gap and must NOT be added here.
    expect(columns).not.toContain('RawPublishedStemID');
  });
});

/** Paren-depth-aware split on top-level commas (so `LEFT(?, 255)` stays one item). */
function splitTopLevelCommas(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
