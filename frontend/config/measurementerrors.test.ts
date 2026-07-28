import { describe, expect, it, vi } from 'vitest';

import {
  buildFailedMeasurementsSelectQuery,
  ensureMeasurementErrorDefinition,
  getIngestionErrorMessage,
  inferAllIngestionErrorCodes,
  insertIngestionFailureRows,
  revalidateEditedFailedRow
} from './measurementerrors';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('measurementerrors helpers', () => {
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
});

/**
 * Regression cover for the 2026-07-27 Harvard Forest incident: 106,227 rows were
 * parked as SQL_EXCEPTION because the Azure front-end timeout and the abandoned
 * upload session produced reasons that matched no classifier pattern. An
 * interruption is not a data defect — the row was never judged at all — so it
 * must carry its own code.
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

  it.each(INTERRUPTION_REASONS)('maps %j to INTERRUPTED_UPLOAD, not SQL_EXCEPTION', reason => {
    expect(inferAllIngestionErrorCodes(reason)).toEqual(['INTERRUPTED_UPLOAD']);
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

  it('still defaults genuinely unmapped reasons to SQL_EXCEPTION', () => {
    expect(inferAllIngestionErrorCodes('some brand new failure nobody has classified')).toEqual(['SQL_EXCEPTION']);
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
