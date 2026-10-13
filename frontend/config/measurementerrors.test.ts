import { describe, expect, it, vi } from 'vitest';

import {
  buildFailedMeasurementsSelectQuery,
  classifyIngestionFailure,
  ensureMeasurementErrorDefinition,
  fetchUnresolvedMeasurementErrors,
  FALLBACK_FAILURE_REASON,
  getIngestionErrorMessage,
  INGESTION_ERROR_SOURCE,
  inferAllIngestionErrorCodes,
  inferSystemFailureKind,
  insertIngestionFailureRows,
  refreshIngestionErrorsForMeasurement,
  resolveCheckedMeasurementErrors,
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

    const lookupCall = lookupCalls[0];
    expect(lookupCall[0]).toContain('UploadFileID <=> ?');
    expect(lookupCall[1]).toEqual(['upload.csv', 'batch-1', 1]);
  });

  it('bounds and coerces runtime reject reasons before classification', () => {
    expect(() => inferAllIngestionErrorCodes({ reason: 'not a string' })).not.toThrow();
    expect(inferAllIngestionErrorCodes({ reason: 'not a string' })).toEqual(['UNCLASSIFIED_REJECT']);
    expect(inferAllIngestionErrorCodes('x'.repeat(500))).toEqual(['UNCLASSIFIED_REJECT']);
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

    const { errors, checkedCodes } = await revalidateEditedFailedRow(
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
    // Issue #307 F4: the cross-census priorStem lookup is not PlotID-scoped
    // and does not mirror the stored procedure's prior-active-PlotCensusNumber
    // contract, so it can never authoritatively resolve a *stored*
    // QUADRAT_MISMATCH or COORDINATE_DRIFT — it may only report a fresh
    // finding (above). Both stay unresolved here regardless of which fields
    // were present or which comparisons this call happened to run.
    expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
    expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
  });

  it('keeps coordinate-drift rows failing during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);

    const connectionManager = { executeQuery } as any;

    const { errors, checkedCodes } = await revalidateEditedFailedRow(
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
    // Issue #307 F4: a fresh COORDINATE_DRIFT finding still fires (above),
    // but — like QUADRAT_MISMATCH — it is never added to checkedCodes, so a
    // stored occurrence of either code cannot be resolved by this row-level
    // comparison alone.
    expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
    expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
  });

  it('flags ambiguous active quadrat and species lookups during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([]);

    const connectionManager = { executeQuery } as any;

    const { errors, checkedCodes } = await revalidateEditedFailedRow(
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
    // Both reference lookups actually ran this call (Quadrat and SpCode were
    // non-empty and the plot resolved), so a caller may resolve a stale
    // INVALID_QUADRAT/INVALID_SPECIES link once it stops firing.
    expect(checkedCodes).toEqual(expect.arrayContaining(['INVALID_QUADRAT', 'AMBIGUOUS_QUADRAT', 'INVALID_SPECIES', 'AMBIGUOUS_SPECIES']));
    // Issue #307 F4: the priorStem lookup found no row (mocked as `[]`), but
    // that no longer implies QUADRAT_MISMATCH/COORDINATE_DRIFT were checked —
    // the lookup is not PlotID-scoped, so "no row" is not proof there is no
    // real prior-census conflict in another plot.
    expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
    expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
  });

  describe('revalidateEditedFailedRow — cross-census QUADRAT_MISMATCH/COORDINATE_DRIFT never enter checkedCodes (issue #307 F4)', () => {
    const BASE_FIELDS = {
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
    } as const;

    it('resolves neither QUADRAT_MISMATCH nor COORDINATE_DRIFT when Tag or StemTag is missing (lookup never runs)', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }]) // plot lookup (Quadrat non-empty)
        .mockResolvedValueOnce([{ cnt: 1 }]) // quadrat existence check
        .mockResolvedValueOnce([{ cnt: 1 }]); // species existence check
      const connectionManager = { executeQuery } as any;

      const { checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, { ...BASE_FIELDS, Tag: '' }, 'tx-1');

      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
      // No fourth query means the cross-census priorStem lookup was never
      // attempted — proving the codes are absent because the lookup was
      // skipped, not merely because F4 forbids checkedCodes either way.
      expect(executeQuery.mock.calls.length).toBe(3);
    });

    it('does not mark QUADRAT_MISMATCH checked (and reports no fresh finding) when the current row has no quadrat value', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ cnt: 1 }]) // species existence check (Quadrat block skipped entirely)
        .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]); // priorStem lookup
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, { ...BASE_FIELDS, Quadrat: '' }, 'tx-1');

      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'QUADRAT_MISMATCH' }));
      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'COORDINATE_DRIFT' }));
      expect(checkedCodes).not.toContain('INVALID_QUADRAT');
      expect(checkedCodes).not.toContain('AMBIGUOUS_QUADRAT');
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
      expect(checkedCodes).toContain('INVALID_SPECIES');
      expect(checkedCodes).toContain('AMBIGUOUS_SPECIES');
    });

    it('does not mark QUADRAT_MISMATCH checked (and reports no fresh finding) when the prior-census stem has no quadrat value', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ PrevQuadratName: null, PrevX: 10, PrevY: 20 }]);
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, BASE_FIELDS, 'tx-1');

      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'QUADRAT_MISMATCH' }));
      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'COORDINATE_DRIFT' }));
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
      expect(checkedCodes).toContain('INVALID_QUADRAT');
      expect(checkedCodes).toContain('AMBIGUOUS_QUADRAT');
    });

    it('reports a fresh QUADRAT_MISMATCH finding when the quadrats differ, but never marks it checked (F4: the lookup is not PlotID-scoped, so it cannot authoritatively resolve a stored mismatch)', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ PrevQuadratName: '1402', PrevX: 10, PrevY: 20 }]);
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, BASE_FIELDS, 'tx-1');

      // The finding still fires — a brand-new QUADRAT_MISMATCH must still be
      // surfaced and upserted immediately.
      expect(errors).toContainEqual({ errorCode: 'QUADRAT_MISMATCH', errorMessage: 'Quadrat mismatch across censuses' });
      // But it is never a candidate for resolving a *stored* QUADRAT_MISMATCH,
      // since this lookup cannot reproduce the stored procedure's same-PlotID
      // + prior-active-PlotCensusNumber contract.
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
    });

    it('reports no fresh COORDINATE_DRIFT finding (current row has a non-finite coordinate) and never marks either code checked', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, { ...BASE_FIELDS, X: null }, 'tx-1');

      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'COORDINATE_DRIFT' }));
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
    });

    it('reports no fresh COORDINATE_DRIFT finding (prior-census stem has a non-finite coordinate) and never marks either code checked', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: null, PrevY: 20 }]);
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, BASE_FIELDS, 'tx-1');

      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'COORDINATE_DRIFT' }));
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
    });

    it('reports no fresh COORDINATE_DRIFT finding when the quadrat matches and every coordinate is within tolerance, but still never marks it checked (F4 supersedes the prior "positive clear" expectation)', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, BASE_FIELDS, 'tx-1');

      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'COORDINATE_DRIFT' }));
      // Issue #307 F4: a prior round of this suite asserted
      // `checkedCodes.toContain('COORDINATE_DRIFT')` here — that was the
      // overconfident "positive clear" expectation this round removes. The
      // PlotID-less, non-PlotCensusNumber-aware lookup can never authoritatively
      // resolve a stored COORDINATE_DRIFT, so it stays retained even when this
      // call's own comparison finds nothing wrong.
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
    });

    it('reports a fresh COORDINATE_DRIFT finding for a matching quadrat, but never marks QUADRAT_MISMATCH or COORDINATE_DRIFT checked (F4 supersedes the prior "positive clear" expectation)', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(
        connectionManager,
        'forestgeo_testing',
        4,
        { ...BASE_FIELDS, X: 25 }, // drift of 15 > 10 threshold, but quadrat still matches
        'tx-1'
      );

      expect(errors).toContainEqual({ errorCode: 'COORDINATE_DRIFT', errorMessage: 'Coordinate drift exceeds allowed threshold' });
      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'QUADRAT_MISMATCH' }));
      // Issue #307 F4: a prior round asserted
      // `checkedCodes.toContain('QUADRAT_MISMATCH')` here — superseded.
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
    });

    it('never marks QUADRAT_MISMATCH or COORDINATE_DRIFT checked even when there is no prior-census stem to conflict with (F4: the dead "trivially satisfied" branch was removed)', async () => {
      const executeQuery = vi
        .fn()
        .mockResolvedValueOnce([{ PlotID: 22 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([]); // no prior-census stem found
      const connectionManager = { executeQuery } as any;

      const { errors, checkedCodes } = await revalidateEditedFailedRow(connectionManager, 'forestgeo_testing', 4, BASE_FIELDS, 'tx-1');

      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'QUADRAT_MISMATCH' }));
      expect(errors).not.toContainEqual(expect.objectContaining({ errorCode: 'COORDINATE_DRIFT' }));
      // Issue #307 F4: a prior round asserted both codes WERE checked here
      // ("no prior stem ⇒ trivially satisfied ⇒ safe to resolve"). That
      // reasoning only holds if the lookup itself is trustworthy, and this one
      // is not PlotID-scoped, so "no row found" could just as easily mean
      // "this TreeTag+StemTag's real prior stem lives in a different plot that
      // this query never considered." The branch that used to add these codes
      // here has been deleted; absence of a prior-stem row is no longer
      // treated as proof of anything.
      expect(checkedCodes).not.toContain('QUADRAT_MISMATCH');
      expect(checkedCodes).not.toContain('COORDINATE_DRIFT');
    });
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

describe('inferSystemFailureKind — the setupbulkfailure reason boundary', () => {
  // setupbulkfailure is the only transfer whose failure kind is not known by
  // its caller: the browser sends whatever killed its setupbulkprocedure
  // request as free text. Hardcoding 'sql_exception' there is what parked
  // 106,227 clean Harvard Forest rows as if each carried a data error.
  const CLIENT_INTERRUPTION_REASONS = [
    'Server error 504: 504.0 GatewayTimeout',
    'Upload session upload_ms3jw74a_97uvta1zlug cleaned up after abandonment',
    'Client disconnected',
    'Batch cancelled before completion',
    // Composed by uploadfiresql's own fetchWithTimeout / abort paths.
    'Request timeout after 480000ms',
    'Request aborted for /api/setupbulkprocedure/file-1/batch-1',
    // The browser's native fetch failures.
    'TypeError: Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed'
  ];

  it.each(CLIENT_INTERRUPTION_REASONS)('classifies %j as interrupted_upload', reason => {
    expect(inferSystemFailureKind(reason)).toBe('interrupted_upload');
  });

  const GENUINE_SERVER_FAILURE_REASONS = [
    'Server error 500: Duplicate entry for key uq_coremeasurements',
    'Client error (400): schema outside the authenticated user scope',
    'Batch moved after max attempts',
    'ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded'
  ];

  it.each(GENUINE_SERVER_FAILURE_REASONS)('leaves %j as sql_exception', reason => {
    expect(inferSystemFailureKind(reason)).toBe('sql_exception');
  });

  it('defaults an absent or non-string reason to sql_exception rather than silently excusing the batch', () => {
    expect(inferSystemFailureKind(undefined)).toBe('sql_exception');
    expect(inferSystemFailureKind(null)).toBe('sql_exception');
    expect(inferSystemFailureKind({ nested: 'gateway timeout' })).toBe('sql_exception');
  });

  it('produces the INTERRUPTED_UPLOAD code end-to-end for a front-end timeout', () => {
    const reason = 'Server error 504: 504.0 GatewayTimeout';

    expect(classifyIngestionFailure(inferSystemFailureKind(reason), reason)).toEqual([
      { errorCode: 'INTERRUPTED_UPLOAD', errorMessage: getIngestionErrorMessage('INTERRUPTED_UPLOAD') }
    ]);
  });
});

describe('inferAllIngestionErrorCodes — parser reject shapes', () => {
  // Every message validateMeasurementRow can emit must land on a code with a
  // field map, otherwise the errors explorer shows the researcher a rejected
  // row and no cell to fix.
  it('classifies a non-numeric DBH, the single most common real reject', () => {
    expect(inferAllIngestionErrorCodes('Non-numeric value for dbh: N/A')).toEqual(['NON_NUMERIC_DBH']);
  });

  it('classifies a non-numeric HOM', () => {
    expect(inferAllIngestionErrorCodes('Non-numeric value for hom: unknown')).toEqual(['NON_NUMERIC_HOM']);
  });

  it.each(['lx', 'ly', 'px', 'py'])('classifies a non-numeric %s coordinate', field => {
    expect(inferAllIngestionErrorCodes(`Non-numeric value for ${field}: ~12`)).toEqual(['NON_NUMERIC_COORDINATE']);
  });

  it('classifies an unparseable date', () => {
    expect(inferAllIngestionErrorCodes('Unparseable date value: 31/02/2026')).toEqual(['INVALID_DATE']);
  });

  it('classifies a delimiter-contaminated tag pair as a mis-parsed row', () => {
    const reason = 'Tag values contain delimiter character ",": tag="T1,S1", stemtag="". This suggests parsing error.';

    expect(inferAllIngestionErrorCodes(reason)).toContain('MALFORMED_ROW');
  });

  it('classifies concatenated over-long tags as a mis-parsed row', () => {
    const reason =
      'Unusually long tag values detected: tag="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA...", stemtag="BBB...". This may indicate concatenated fields due to parsing error.';

    expect(inferAllIngestionErrorCodes(reason)).toContain('MALFORMED_ROW');
  });

  it('reports every defect on a row that trips more than one parser check', () => {
    const reason = 'Missing required fields: quadrat | Non-numeric value for dbh: N/A | Unparseable date value: yesterday';

    expect(inferAllIngestionErrorCodes(reason).sort()).toEqual(['INVALID_DATE', 'MISSING_FIELD_QUADRATNAME', 'NON_NUMERIC_DBH']);
  });

  it('never re-emits the retired MISSING_FIELD_COORDINATES code for an lx/ly reject', () => {
    const codes = inferAllIngestionErrorCodes('Missing required fields: lx, ly');

    expect(codes).toEqual(['MISSING_FIELD_LOCALX', 'MISSING_FIELD_LOCALY']);
    expect(codes).not.toContain('MISSING_FIELD_COORDINATES');
  });

  it('still resolves the retired code for rows persisted under it before the per-field split', () => {
    // Removing it from the catalog would leave historical rows with the generic
    // 'Ingestion error' fallback in the explorer.
    expect(getIngestionErrorMessage('MISSING_FIELD_COORDINATES')).toBe('Missing required coordinate fields (lx, ly)');
  });
});

describe('resolveCheckedMeasurementErrors (issue #307: targeted resolution)', () => {
  it('is a no-op when no codes were actually re-checked — never a blanket resolve', async () => {
    const executeQuery = vi.fn();
    const connectionManager = { executeQuery } as any;

    await resolveCheckedMeasurementErrors(connectionManager, 'forestgeo_testing', 501, INGESTION_ERROR_SOURCE, [], 'tx-empty');

    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('binds each checked code as its own scalar placeholder, never a single ? bound to an array', async () => {
    const executeQuery = vi.fn().mockResolvedValueOnce({ affectedRows: 2 });
    const connectionManager = { executeQuery } as any;

    await resolveCheckedMeasurementErrors(
      connectionManager,
      'forestgeo_testing',
      501,
      INGESTION_ERROR_SOURCE,
      ['MISSING_FIELD_TREETAG', 'NEGATIVE_DBH', 'NEGATIVE_HOM'],
      'tx-501'
    );

    expect(executeQuery).toHaveBeenCalledTimes(1);
    const [sql, params, transactionID] = executeQuery.mock.calls[0];
    // Scalar placeholders: one '?' per code inside the IN clause, not a single
    // '?' meant to be bound to the whole array (mysql2 execute() would not
    // expand that).
    expect(sql).toContain('ErrorCode IN (?, ?, ?)');
    expect(sql).not.toMatch(/ErrorCode IN \(\?\)/);
    expect(params).toEqual([501, INGESTION_ERROR_SOURCE, 'MISSING_FIELD_TREETAG', 'NEGATIVE_DBH', 'NEGATIVE_HOM']);
    expect(transactionID).toBe('tx-501');
  });
});

describe('fetchUnresolvedMeasurementErrors (issue #307: effective-set read-back)', () => {
  it('selects only unresolved rows for the given measurement and source, mapped to RevalidationResult shape', async () => {
    const executeQuery = vi.fn().mockResolvedValueOnce([
      { errorCode: 'DUPLICATE_ENTRY', errorMessage: 'Duplicate measurement row detected' },
      { errorCode: 'MISSING_FIELD_TREETAG', errorMessage: 'Missing required field: TreeTag' }
    ]);
    const connectionManager = { executeQuery } as any;

    const result = await fetchUnresolvedMeasurementErrors(connectionManager, 'forestgeo_testing', 777, INGESTION_ERROR_SOURCE, 'tx-777');

    expect(executeQuery).toHaveBeenCalledTimes(1);
    const [sql, params, transactionID] = executeQuery.mock.calls[0];
    expect(sql).toContain('IsResolved = FALSE');
    expect(sql).toContain('ORDER BY me.ErrorCode ASC');
    expect(params).toEqual([777, INGESTION_ERROR_SOURCE]);
    expect(transactionID).toBe('tx-777');
    expect(result).toEqual([
      { errorCode: 'DUPLICATE_ENTRY', errorMessage: 'Duplicate measurement row detected' },
      { errorCode: 'MISSING_FIELD_TREETAG', errorMessage: 'Missing required field: TreeTag' }
    ]);
  });
});

describe('refreshIngestionErrorsForMeasurement (issue #307: retention contract)', () => {
  const MEASUREMENT_ID = 909;
  const CENSUS_ID = 4;

  // Fields chosen so revalidateEditedFailedRow's DB-backed reference checks
  // (quadrat/species/cross-census) are all skipped — Quadrat, SpCode and
  // StemTag are empty, so only the 8 unconditional in-memory checks run and
  // every executeQuery call below belongs to the refresh helper itself, not
  // to revalidateEditedFailedRow. This isolates the sequencing contract this
  // suite is verifying.
  const FIELDS_SKIPPING_REFERENCE_LOOKUPS = {
    Tag: 'T1',
    StemTag: null,
    SpCode: null,
    Quadrat: null,
    X: null,
    Y: null,
    DBH: 1,
    HOM: 1,
    Date: '2024-01-01',
    Codes: 'M',
    Comments: null
  };

  function classifyCall(
    sql: string
  ): 'resolve' | 'ensureDefinition' | 'linkInsert' | 'fetch' | 'plotID' | 'quadratCheck' | 'speciesCheck' | 'priorStem' | 'unknown' {
    if (sql.includes('UPDATE') && sql.includes('measurement_error_log') && sql.includes('ErrorCode IN')) return 'resolve';
    if (sql.includes('INSERT') && sql.includes('measurement_errors') && sql.includes('ErrorMessage = VALUES')) return 'ensureDefinition';
    if (sql.includes('INSERT') && sql.includes('measurement_error_log') && sql.includes('IsResolved = FALSE,')) return 'linkInsert';
    if (sql.includes('SELECT') && sql.includes('ErrorCode AS errorCode')) return 'fetch';
    if (sql.includes('SELECT PlotID FROM')) return 'plotID';
    if (sql.includes('COUNT(*)') && sql.includes('.quadrats')) return 'quadratCheck';
    if (sql.includes('COUNT(*)') && sql.includes('.species')) return 'speciesCheck';
    if (sql.includes('PrevQuadratName')) return 'priorStem';
    return 'unknown';
  }

  it('resolves exactly the checked-but-not-fresh codes, upserts fresh findings, then reads back the effective set — in that order', async () => {
    const callOrder: string[] = [];
    let ensureDefinitionInsertId = 6000;

    const executeQuery = vi.fn().mockImplementation(async (sql: string) => {
      const kind = classifyCall(sql);
      callOrder.push(kind);
      switch (kind) {
        case 'resolve':
          return { affectedRows: 6 };
        case 'ensureDefinition':
          return { insertId: ++ensureDefinitionInsertId };
        case 'linkInsert':
          return { affectedRows: 1 };
        case 'fetch':
          // Simulated effective set after the DB has actually applied the
          // writes above: the row validator's three fresh findings, PLUS a
          // DUPLICATE_ENTRY link that was never in checkedCodes or freshErrors
          // (revalidateEditedFailedRow never checks for duplicates) and so was
          // never a candidate for resolution. If the helper returned
          // freshErrors directly instead of this read-back, DUPLICATE_ENTRY
          // would be silently dropped from the result — asserting it IS
          // present below proves the final value really comes from
          // fetchUnresolvedMeasurementErrors, not from freshErrors.
          return [
            { errorCode: 'DUPLICATE_ENTRY', errorMessage: 'Duplicate measurement row detected' },
            { errorCode: 'MISSING_FIELD_QUADRATNAME', errorMessage: 'Missing required field: QuadratName' },
            { errorCode: 'MISSING_FIELD_SPECIESCODE', errorMessage: 'Missing required field: SpeciesCode' },
            { errorCode: 'MISSING_FIELD_STEMTAG', errorMessage: 'Missing required field: StemTag' }
          ];
        default:
          throw new Error(`unexpected query shape in refreshIngestionErrorsForMeasurement test: ${sql}`);
      }
    });
    const connectionManager = { executeQuery } as any;

    const result = await refreshIngestionErrorsForMeasurement(
      connectionManager,
      'forestgeo_testing',
      MEASUREMENT_ID,
      CENSUS_ID,
      FIELDS_SKIPPING_REFERENCE_LOOKUPS,
      'tx-909'
    );

    // Order matters: resolving the stale checked codes before upserting fresh
    // ones is safe only because codesToResolve excludes freshCodes, but the
    // read-back MUST happen last or it could observe a stale snapshot.
    expect(callOrder[0]).toBe('resolve');
    expect(callOrder[callOrder.length - 1]).toBe('fetch');
    expect(callOrder.filter(k => k === 'ensureDefinition' || k === 'linkInsert')).toHaveLength(6); // 3 fresh errors * 2 queries each

    const resolveCall = executeQuery.mock.calls[0];
    // StemTag/SpCode/Quadrat are empty, so their MISSING_FIELD_* codes are
    // fresh (not resolved); only the remaining 5 unconditional codes that did
    // NOT reappear get resolved. DUPLICATE_ENTRY/SQL_EXCEPTION/FIELD_TOO_LONG/
    // etc. are never in this list — FIELD_TOO_LONG is a fresh-only finding
    // (issue #307 F3) and the helper never checks for duplicates at all.
    expect(resolveCall[1]).toEqual([
      MEASUREMENT_ID,
      INGESTION_ERROR_SOURCE,
      'MISSING_FIELD_TREETAG',
      'MISSING_FIELD_DATE',
      'NEGATIVE_DBH',
      'NEGATIVE_HOM',
      'MISSING_MEASUREMENT_DATA'
    ]);

    // The helper's return value is exactly what the read-back produced,
    // including the retained DUPLICATE_ENTRY link that was never checked or
    // freshly found this call — proving the result is the effective set from
    // fetchUnresolvedMeasurementErrors, not freshErrors.
    expect(result.map(e => e.errorCode).sort()).toEqual(['DUPLICATE_ENTRY', 'MISSING_FIELD_QUADRATNAME', 'MISSING_FIELD_SPECIESCODE', 'MISSING_FIELD_STEMTAG']);
  });

  it('never resolves a pre-existing QUADRAT_MISMATCH/COORDINATE_DRIFT, even while freshly reporting a new QUADRAT_MISMATCH, so both survive the full refresh (issue #307 F4 x retention)', async () => {
    const FIELDS_WITH_DIFFERING_QUADRAT = {
      Tag: 'T1',
      StemTag: '1',
      SpCode: 'FAGR',
      Quadrat: '1402',
      X: 10,
      Y: 20,
      DBH: 1,
      HOM: 1,
      Date: '2024-01-01',
      Codes: 'M',
      Comments: null
    };

    const executeQuery = vi.fn().mockImplementation(async (sql: string) => {
      switch (classifyCall(sql)) {
        case 'plotID':
          return [{ PlotID: 22 }];
        case 'quadratCheck':
          return [{ cnt: 1 }]; // '1402' resolves to exactly one active quadrat
        case 'speciesCheck':
          return [{ cnt: 1 }]; // 'FAGR' resolves to exactly one active species
        case 'priorStem':
          // Prior census stem sat in quadrat '1301' — differs from the
          // current row's '1402', so a fresh QUADRAT_MISMATCH finding fires.
          // Per F4, that finding is still upserted, but neither code is ever
          // added to checkedCodes regardless of this outcome.
          return [{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }];
        case 'resolve':
          return { affectedRows: 1 };
        case 'ensureDefinition':
          return { insertId: 7000 };
        case 'linkInsert':
          return { affectedRows: 1 };
        case 'fetch':
          // The DB effective set still carries a COORDINATE_DRIFT link from
          // an earlier ingestion attempt, plus the QUADRAT_MISMATCH link this
          // call's fresh finding just (re)upserted. Neither was a candidate
          // for resolveCheckedMeasurementErrors (asserted below), so the mock
          // database realistically still reports both as unresolved.
          return [
            { errorCode: 'COORDINATE_DRIFT', errorMessage: 'Coordinate drift exceeds allowed threshold' },
            { errorCode: 'QUADRAT_MISMATCH', errorMessage: 'Quadrat mismatch across censuses' }
          ];
        default:
          throw new Error(`unexpected query shape in F4 x retention integration test: ${sql}`);
      }
    });
    const connectionManager = { executeQuery } as any;

    const result = await refreshIngestionErrorsForMeasurement(
      connectionManager,
      'forestgeo_testing',
      MEASUREMENT_ID,
      CENSUS_ID,
      FIELDS_WITH_DIFFERING_QUADRAT,
      'tx-909'
    );

    const resolveCall = executeQuery.mock.calls.find(call => classifyCall(call[0]) === 'resolve');
    expect(resolveCall).toBeDefined();
    // Neither code may ever appear in the list of codes passed to
    // resolveCheckedMeasurementErrors — the cross-census lookup is never an
    // authoritative check under F4, regardless of what it found this call.
    expect(resolveCall![1]).not.toContain('QUADRAT_MISMATCH');
    expect(resolveCall![1]).not.toContain('COORDINATE_DRIFT');

    // Both the stale COORDINATE_DRIFT link and the freshly-reported
    // QUADRAT_MISMATCH link are present in the effective set returned to the
    // caller — retained/reported, not silently dropped.
    expect(result.map(e => e.errorCode)).toContain('COORDINATE_DRIFT');
    expect(result.map(e => e.errorCode)).toContain('QUADRAT_MISMATCH');
  });

  it('propagates a failure from the resolve step without swallowing it, and never reaches the read-back (AC7: fail loud, do not claim readiness)', async () => {
    const RESOLVE_FAILURE = new Error('measurement_error_log UPDATE failed: deadlock found when trying to get lock');
    const executeQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (classifyCall(sql) === 'resolve') throw RESOLVE_FAILURE;
      throw new Error(`should not reach this query after the resolve step failed: ${sql}`);
    });
    const connectionManager = { executeQuery } as any;

    await expect(
      refreshIngestionErrorsForMeasurement(connectionManager, 'forestgeo_testing', MEASUREMENT_ID, CENSUS_ID, FIELDS_SKIPPING_REFERENCE_LOOKUPS, 'tx-909')
    ).rejects.toThrow(RESOLVE_FAILURE);

    // Exactly the resolve call ran; the caller must not fall through to
    // upsert/read-back and report a false "clean" result after a DB error.
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(classifyCall(executeQuery.mock.calls[0][0])).toBe('resolve');
  });
});
