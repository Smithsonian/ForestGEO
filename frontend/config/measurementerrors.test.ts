import { describe, expect, it, vi } from 'vitest';

import {
  buildFailedMeasurementsSelectQuery,
  classifyIngestionFailure,
  ensureMeasurementErrorDefinition,
  FALLBACK_FAILURE_REASON,
  getIngestionErrorMessage,
  inferAllIngestionErrorCodes,
  insertIngestionFailureRows,
  revalidateEditedFailedRow,
  toFiniteNumber
} from './measurementerrors';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('measurementerrors helpers', () => {
  it('accepts only finite base-10 scalar values that fit the failed-row DECIMAL columns', () => {
    expect(toFiniteNumber(' -12.5e2 ')).toBe(-1250);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber('999999.999999')).toBe(999999.999999);

    expect(toFiniteNumber(true)).toBeNull();
    expect(toFiniteNumber([])).toBeNull();
    expect(toFiniteNumber('0x10')).toBeNull();
    expect(toFiniteNumber('Infinity')).toBeNull();
    expect(toFiniteNumber(1000000)).toBeNull();
    expect(toFiniteNumber('-1000000')).toBeNull();
  });

  it('includes stored coremeasurement descriptions in failed-measurements queries', () => {
    const sql = buildFailedMeasurementsSelectQuery('forestgeo_testing');

    expect(sql).toContain('cm.Description AS Description');
  });

  it('persists every inferred ingestion error for a failed row with a single bulk error-log upsert', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 1001 })
      .mockResolvedValueOnce({ insertId: 1002 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ CoreMeasurementID: 77, SourceRowIndex: 1 }])
      .mockResolvedValueOnce(undefined);

    const connectionManager = { executeQuery } as any;

    const insertedIDs = await insertIngestionFailureRows(
      connectionManager,
      'forestgeo_testing',
      [
        {
          plotID: 1,
          censusID: 2,
          tag: 'T-1',
          stemTag: '1',
          spCode: '',
          quadrat: '',
          failureReason: 'Missing required field: SpeciesCode | Missing required field: QuadratName',
          fileID: 'upload.csv',
          batchID: 'batch-1',
          sourceRowIndex: 1
        }
      ],
      'tx-1'
    );

    expect(insertedIDs).toEqual([77]);

    const bulkMeasurementInsertCalls = executeQuery.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    expect(bulkMeasurementInsertCalls).toHaveLength(1);

    const lookupCalls = executeQuery.mock.calls.filter(([sql]: [string]) => sql.includes('SELECT CoreMeasurementID, SourceRowIndex'));
    expect(lookupCalls).toHaveLength(1);

    const logInsertCalls = executeQuery.mock.calls.filter(
      ([sql]: [string]) => sql.includes('measurement_error_log') && sql.includes('ON DUPLICATE KEY UPDATE')
    );

    expect(logInsertCalls).toHaveLength(1);
    expect(logInsertCalls[0][1]).toEqual([77, 1001, 77, 1002]);
  });

  it('writes RawPlotX/RawPlotY on the bulk insert path and refreshes them on ON DUPLICATE KEY UPDATE', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 2001 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ CoreMeasurementID: 88, SourceRowIndex: 1 }])
      .mockResolvedValueOnce(undefined);

    const connectionManager = { executeQuery } as any;

    await insertIngestionFailureRows(
      connectionManager,
      'forestgeo_testing',
      [
        {
          plotID: 1,
          censusID: 2,
          tag: 'T-3',
          stemTag: '1',
          spCode: 'ULMALA',
          quadrat: 'A01',
          x: 5,
          y: 5,
          plotX: -0.271,
          plotY: 267.5,
          failureReason: 'Row dropped by INSERT IGNORE',
          fileID: 'coords.csv',
          batchID: 'batch-1',
          sourceRowIndex: 1
        }
      ],
      'tx-1'
    );

    const bulkMeasurementInsertCall = executeQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    expect(bulkMeasurementInsertCall, 'bulk coremeasurements insert was never issued').toBeDefined();
    const [sql, params] = bulkMeasurementInsertCall!;

    expect(sql).toContain('RawPlotX');
    expect(sql).toContain('RawPlotY');
    expect(sql).toContain('RawPlotX = VALUES(RawPlotX)');
    expect(sql).toContain('RawPlotY = VALUES(RawPlotY)');
    expect(params).toContain(-0.271);
    expect(params).toContain(267.5);
  });

  it('writes RawPlotX/RawPlotY on the sequential insert path (no batchID → falls back to sequential)', async () => {
    const executeQuery = vi.fn().mockResolvedValueOnce({ insertId: 3001 }).mockResolvedValueOnce(undefined);

    const connectionManager = { executeQuery } as any;

    await insertIngestionFailureRows(
      connectionManager,
      'forestgeo_testing',
      [
        {
          plotID: 1,
          censusID: 2,
          tag: 'T-4',
          stemTag: '1',
          spCode: 'ULMALA',
          quadrat: 'A01',
          plotX: -0.271,
          plotY: 267.5,
          failureReason: 'Missing required field: SpeciesCode',
          fileID: 'coords.csv',
          batchID: null,
          sourceRowIndex: null
        }
      ],
      'tx-1'
    );

    const sequentialInsertCall = executeQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    expect(sequentialInsertCall, 'sequential coremeasurements insert was never issued').toBeDefined();
    const [sql, params] = sequentialInsertCall!;

    expect(sql).toContain('RawPlotX');
    expect(sql).toContain('RawPlotY');
    expect(params).toContain(-0.271);
    expect(params).toContain(267.5);
  });

  it('falls back to sequential inserts when batch metadata is missing', async () => {
    const executeQuery = vi.fn().mockResolvedValueOnce({ insertId: 1001 }).mockResolvedValueOnce({ insertId: 88 }).mockResolvedValueOnce(undefined);

    const connectionManager = { executeQuery } as any;

    const insertedIDs = await insertIngestionFailureRows(
      connectionManager,
      'forestgeo_testing',
      [
        {
          plotID: 1,
          censusID: 2,
          tag: 'T-2',
          stemTag: '1',
          spCode: '',
          quadrat: '1301',
          failureReason: 'Missing required field: SpeciesCode',
          fileID: 'upload.csv',
          batchID: null,
          sourceRowIndex: null
        }
      ],
      'tx-1'
    );

    expect(insertedIDs).toEqual([88]);
    expect(executeQuery.mock.calls.some(([sql]: [string]) => sql.includes('SELECT CoreMeasurementID, SourceRowIndex'))).toBe(false);
  });

  it('keeps quadrat-mismatch rows failing during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);

    const connectionManager = { executeQuery } as any;

    const errors = await revalidateEditedFailedRow(
      connectionManager,
      'forestgeo_testing',
      4,
      {
        Tag: '100001',
        StemTag: '1',
        SpCode: 'FAGR',
        Quadrat: '1317',
        X: 10,
        Y: 20,
        DBH: 3.5,
        HOM: 1.3,
        Date: '2010-03-17',
        Codes: 'LI'
      },
      'tx-1'
    );

    expect(errors).toContainEqual({
      errorCode: 'QUADRAT_MISMATCH',
      errorMessage: 'Quadrat mismatch across censuses'
    });
  });

  it('keeps coordinate-drift rows failing during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);

    const connectionManager = { executeQuery } as any;

    const errors = await revalidateEditedFailedRow(
      connectionManager,
      'forestgeo_testing',
      4,
      {
        Tag: '100001',
        StemTag: '1',
        SpCode: 'FAGR',
        Quadrat: '1301',
        X: 25,
        Y: 20,
        DBH: 3.5,
        HOM: 1.3,
        Date: '2010-03-17',
        Codes: 'LI'
      },
      'tx-1'
    );

    expect(errors).toContainEqual({
      errorCode: 'COORDINATE_DRIFT',
      errorMessage: 'Coordinate drift exceeds allowed threshold'
    });
  });

  it('flags ambiguous active quadrat and species lookups during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([]);

    const connectionManager = { executeQuery } as any;

    const errors = await revalidateEditedFailedRow(
      connectionManager,
      'forestgeo_testing',
      4,
      {
        Tag: '100001',
        StemTag: '1',
        SpCode: 'FAGR',
        Quadrat: '1301',
        X: 10,
        Y: 20,
        DBH: 3.5,
        HOM: 1.3,
        Date: '2010-03-17',
        Codes: 'LI'
      },
      'tx-1'
    );

    expect(errors).toContainEqual({
      errorCode: 'AMBIGUOUS_QUADRAT',
      errorMessage: 'Quadrat name resolves to multiple active quadrats in the same plot'
    });
    expect(errors).toContainEqual({
      errorCode: 'AMBIGUOUS_SPECIES',
      errorMessage: 'Species code resolves to multiple active species records'
    });
    expect(String(executeQuery.mock.calls[1]?.[0])).toContain('IsActive = 1');
    expect(String(executeQuery.mock.calls[2]?.[0])).toContain('LOWER(SpeciesCode) = LOWER(?)');
  });

  it('persists the failure reason into Description and keeps comments in RawComments only', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 1001 }) // ensureMeasurementErrorDefinition upsert
      .mockResolvedValueOnce({ affectedRows: 1 }) // bulk INSERT
      .mockResolvedValueOnce([{ CoreMeasurementID: 90, SourceRowIndex: 1 }]) // SELECT-back
      .mockResolvedValueOnce(undefined); // error-log INSERT
    const connectionManager = { executeQuery } as any;

    await insertIngestionFailureRows(connectionManager, 'forestgeo_testing', [
      {
        plotID: 1,
        censusID: 2,
        tag: 'T-9',
        stemTag: '1',
        spCode: 'ULMALA',
        quadrat: 'A01',
        comments: 'leaning stem',
        failureReason: 'Non-numeric value for dbh: n/a',
        fileID: 'upload.csv',
        batchID: 'batch-9',
        sourceRowIndex: 1
      }
    ]);

    const insertCall = executeQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    const params = insertCall![1] as unknown[];
    expect(params[4]).toBe('Non-numeric value for dbh: n/a'); // Description = reason
    expect(params[16]).toBe('leaning stem'); // RawComments = comments
  });

  it('falls back to FALLBACK_FAILURE_REASON when the reason is blank', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 1001 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ CoreMeasurementID: 91, SourceRowIndex: 1 }])
      .mockResolvedValueOnce(undefined);
    const connectionManager = { executeQuery } as any;

    await insertIngestionFailureRows(connectionManager, 'forestgeo_testing', [
      { plotID: 1, censusID: 2, failureReason: '   ', fileID: 'upload.csv', batchID: 'batch-9', sourceRowIndex: 1 }
    ]);

    const insertCall = executeQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    expect((insertCall![1] as unknown[])[4]).toBe(FALLBACK_FAILURE_REASON);
  });

  it('truncates over-length reasons to the Description column width', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 1001 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ CoreMeasurementID: 92, SourceRowIndex: 1 }])
      .mockResolvedValueOnce(undefined);
    const connectionManager = { executeQuery } as any;

    await insertIngestionFailureRows(connectionManager, 'forestgeo_testing', [
      { plotID: 1, censusID: 2, failureReason: 'x'.repeat(300), fileID: 'upload.csv', batchID: 'batch-9', sourceRowIndex: 1 }
    ]);

    const insertCall = executeQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    expect((insertCall![1] as unknown[])[4]).toBe('x'.repeat(255));
  });

  it('persists the failure reason into Description on the sequential insert path (no batchID)', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 1001 }) // ensureMeasurementErrorDefinition upsert
      .mockResolvedValueOnce({ insertId: 93 }) // row INSERT
      .mockResolvedValueOnce(undefined); // error-log INSERT
    const connectionManager = { executeQuery } as any;

    await insertIngestionFailureRows(connectionManager, 'forestgeo_testing', [
      {
        plotID: 1,
        censusID: 2,
        tag: 'T-10',
        stemTag: '1',
        spCode: 'ULMALA',
        quadrat: 'A01',
        comments: 'broken stem',
        failureReason: 'Unrecognized failure text for sequential path',
        fileID: 'upload.csv',
        batchID: null,
        sourceRowIndex: null
      }
    ]);

    const insertCall = executeQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements'));
    const params = insertCall![1] as unknown[];
    expect(params[4]).toBe('Unrecognized failure text for sequential path'); // Description = reason
    expect(params[16]).toBe('broken stem'); // RawComments = comments
  });

  it('classifies explicit system-failure kinds directly, bypassing reason inference', () => {
    expect(classifyIngestionFailure('sql_exception', 'wording with no keywords')).toEqual([
      { errorCode: 'SQL_EXCEPTION', errorMessage: getIngestionErrorMessage('SQL_EXCEPTION') }
    ]);
    expect(classifyIngestionFailure('interrupted_upload', 'GatewayTimeout')).toEqual([
      { errorCode: 'INTERRUPTED_UPLOAD', errorMessage: getIngestionErrorMessage('INTERRUPTED_UPLOAD') }
    ]);
  });

  it('still classifies parser_reject via reason-text inference (unchanged behavior)', () => {
    expect(classifyIngestionFailure('parser_reject', 'Missing required field: TreeTag')).toEqual([
      { errorCode: 'MISSING_FIELD_TREETAG', errorMessage: getIngestionErrorMessage('MISSING_FIELD_TREETAG') }
    ]);
  });

  it.each<(string | null)[]>([
    [null],
    [''],
    ['   '],
    ['Unknown parse error'],
    ['some reason mentioning sql and deadlock'],
    ['GatewayTimeout while flushing batch']
  ])('parser inference returns UNCLASSIFIED_REJECT for unrecognized reason %j', reason => {
    expect(inferAllIngestionErrorCodes(reason)).toEqual(['UNCLASSIFIED_REJECT']);
  });

  // These reasons are the ACTUAL strings validateMeasurementRow/resolveMeasurementChunk
  // emit (lib/column-mapping/measurement-rows.ts) — plural "Missing required fields:"
  // joined with ', ' over lowercase canonical labels, "Decimal value for X is out of
  // range: <value>" for lx/ly/px/py/dbh/hom, and multi-error rows joined with '|'.
  it('maps the plural missing-required-fields reason to per-field codes', () => {
    expect(inferAllIngestionErrorCodes('Missing required fields: tag, stemtag, date')).toEqual([
      'MISSING_FIELD_TREETAG',
      'MISSING_FIELD_STEMTAG',
      'MISSING_FIELD_DATE'
    ]);
    expect(inferAllIngestionErrorCodes('Missing required fields: lx, ly')).toEqual(['MISSING_FIELD_LOCALX', 'MISSING_FIELD_LOCALY']);
  });

  it('maps out-of-range coordinate rejects to INVALID_COORDINATE', () => {
    expect(inferAllIngestionErrorCodes('Decimal value for lx is out of range: -0.3')).toEqual(['INVALID_COORDINATE']);
    expect(inferAllIngestionErrorCodes('Decimal value for px is out of range: 12345678')).toEqual(['INVALID_COORDINATE']);
  });

  it('maps out-of-range negative dbh/hom to their sign codes', () => {
    expect(inferAllIngestionErrorCodes('Decimal value for dbh is out of range: -5')).toEqual(['NEGATIVE_DBH']);
    expect(inferAllIngestionErrorCodes('Decimal value for hom is out of range: -1.3')).toEqual(['NEGATIVE_HOM']);
  });

  it('collects every code from a |-joined multi-error reason', () => {
    expect(inferAllIngestionErrorCodes('Missing required fields: tag|Decimal value for ly is out of range: -1.2')).toEqual([
      'MISSING_FIELD_TREETAG',
      'INVALID_COORDINATE'
    ]);
  });

  it('silently drops an unrecognized label from the missing-fields list rather than inventing a code for it', () => {
    // 'px' has no MISSING_FIELD_* code (it only participates in the decimal-range check),
    // so it must not surface a bogus code or block the sibling 'tag' label from mapping.
    expect(inferAllIngestionErrorCodes('Missing required fields: tag, px')).toEqual(['MISSING_FIELD_TREETAG']);
  });
});

/**
 * Regression cover for the 2026-07-27 Harvard Forest incident: 106,227 rows were
 * parked as SQL_EXCEPTION because the Azure front-end timeout and the abandoned
 * upload session produced reasons that matched no classifier pattern. An
 * interruption is not a data defect — the row was never judged at all — so it
 * must carry its own code, sourced from the caller's explicit failure kind
 * rather than sniffed out of the reason text (prose inference was removed —
 * `inferAllIngestionErrorCodes` never returns INTERRUPTED_UPLOAD on its own).
 */
describe('inferAllIngestionErrorCodes — upload interruptions', () => {
  const INTERRUPTION_REASONS = [
    // Verbatim from the incident's parked rows.
    'Server error 504: 504.0 GatewayTimeout',
    'Upload session upload_ms3jw74a_97uvta1zlug cleaned up after abandonment',
    'Client disconnected',
    // Emitted by the revived async pipeline when a job is cancelled mid-flight.
    'Batch cancelled before completion'
  ];

  it.each(INTERRUPTION_REASONS)('maps %j to INTERRUPTED_UPLOAD via the explicit kind, not SQL_EXCEPTION', reason => {
    expect(classifyIngestionFailure('interrupted_upload', reason)).toEqual([
      { errorCode: 'INTERRUPTED_UPLOAD', errorMessage: getIngestionErrorMessage('INTERRUPTED_UPLOAD') }
    ]);
  });

  it('gives INTERRUPTED_UPLOAD a message that distinguishes it from a rejected row', () => {
    const message = getIngestionErrorMessage('INTERRUPTED_UPLOAD');

    expect(message).not.toBe('Ingestion error');
    expect(message.toLowerCase()).toContain('interrupted');
    // The operator-facing point of the code: the row itself was never rejected.
    expect(message.toLowerCase()).toContain('not rejected');
  });

  it('does not swallow genuine data errors that merely mention a timeout-adjacent word', () => {
    // A real per-row defect must keep its specific code even when the reason
    // string is unusual — the interruption branch must not become a catch-all.
    expect(inferAllIngestionErrorCodes('Missing required field: TreeTag')).toEqual(['MISSING_FIELD_TREETAG']);
    expect(inferAllIngestionErrorCodes('Duplicate measurement row detected')).toEqual(['DUPLICATE_ENTRY']);
  });

  it.each(INTERRUPTION_REASONS)('no longer infers INTERRUPTED_UPLOAD from reason prose — %j defaults to UNCLASSIFIED_REJECT', reason => {
    expect(inferAllIngestionErrorCodes(reason)).toEqual(['UNCLASSIFIED_REJECT']);
  });

  it('still defaults genuinely unmapped reasons to UNCLASSIFIED_REJECT, never SQL_EXCEPTION', () => {
    expect(inferAllIngestionErrorCodes('some brand new failure nobody has classified')).toEqual(['UNCLASSIFIED_REJECT']);
  });

  /**
   * INTERRUPTED_UPLOAD is not seeded anywhere: measurement_errors is a per-site
   * table, so the definition has to be creatable on first use in whichever
   * schema hits an interruption first.
   */
  it('creates the INTERRUPTED_UPLOAD definition in the per-site measurement_errors table on first use', async () => {
    const NEW_ERROR_ID = 42;
    const executeQuery = vi.fn().mockResolvedValueOnce({ insertId: NEW_ERROR_ID });
    const connectionManager = { executeQuery } as any;

    const errorID = await ensureMeasurementErrorDefinition(
      connectionManager,
      'forestgeo_harvard',
      'ingestion',
      'INTERRUPTED_UPLOAD',
      getIngestionErrorMessage('INTERRUPTED_UPLOAD'),
      'tx-9'
    );

    expect(errorID).toBe(NEW_ERROR_ID);
    expect(executeQuery).toHaveBeenCalledTimes(1);

    const [sql, params, transactionID] = executeQuery.mock.calls[0];
    // safeFormatQuery backtick-quotes the validated schema identifier.
    expect(String(sql)).toContain('`forestgeo_harvard`.measurement_errors');
    expect(String(sql)).toContain('ON DUPLICATE KEY UPDATE');
    expect(params[0]).toBe('ingestion');
    expect(params[1]).toBe('INTERRUPTED_UPLOAD');
    expect(String(params[2]).toLowerCase()).toContain('interrupted');
    expect(transactionID).toBe('tx-9');
  });
});
