import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';

// Route is now wrapped by withRouteAuthz, so auth() runs before the handler.
// A 'global' admin passes the per-site access gate; 'forestgeo_testing' is a
// structurally valid schema, so the guard's isValidSchema check passes too.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const beginTransaction = vi.fn();
  const executeQuery = vi.fn();
  const commitTransaction = vi.fn();
  const rollbackTransaction = vi.fn();
  const closeConnection = vi.fn();
  const instance = {
    beginTransaction,
    executeQuery,
    commitTransaction,
    rollbackTransaction,
    closeConnection
  };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    generateShortBatchID: () => 'test-batch-id-12345'
  };
});

function makeParams(schema = 'forestgeo_testing', targetRowID = '123') {
  return {
    params: Promise.resolve({ schema, targetRowID })
  } as any;
}

// Reads the bind-parameter position of a `orig.<column> = ?` assignment out of
// the sync UPDATE's own SET clause, so payload assertions track the real
// column order instead of a hard-coded offset that breaks silently on
// column reordering.
function syncSetParamIndex(updateSQL: string, columnName: string): number {
  const setClause = updateSQL.match(/SET\s+([\s\S]+?)\s+WHERE/i)?.[1] ?? '';
  const assignments = setClause
    .split(',')
    .map(assignment => assignment.trim())
    .filter(assignment => assignment.endsWith('= ?'));
  return assignments.findIndex(assignment => assignment.startsWith(`orig.${columnName} =`));
}

describe('reingestsinglefailure API route', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    mockConnectionManager.beginTransaction.mockResolvedValue('txn-1');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
    mockConnectionManager.closeConnection.mockResolvedValue(undefined);
  });

  it('returns 400 when targetRowID is not a positive integer', async () => {
    const req = new Request('http://localhost/api/reingestsinglefailure/forestgeo_testing/abc') as any;
    const res = await GET(req, makeParams('forestgeo_testing', 'abc'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/positive integer/i);
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('reconciles onto original row without overwriting upload metadata fields', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce({ affectedRows: 1, insertId: 501 }) // shift into temporarymeasurements
      .mockResolvedValueOnce(undefined) // bulkingestionprocess
      .mockResolvedValueOnce([
        {
          CensusID: 1,
          StemGUID: 77,
          IsValidated: null,
          MeasurementDate: '2024-06-15',
          MeasuredDBH: 12.3,
          MeasuredHOM: 1.3,
          Description: null,
          UserDefinedFields: null,
          RawTreeTag: 'T-1',
          RawStemTag: '1',
          RawSpCode: 'ACRU',
          RawQuadrat: 'Q01',
          RawX: 1.23,
          RawY: 4.56,
          RawPlotX: -0.271,
          RawPlotY: 267.5,
          RawCodes: 'AL',
          RawPublishedStemID: 5001,
          RawComments: null,
          IsActive: 1
        }
      ]) // snapshot result row
      .mockResolvedValueOnce([{ Code: 'AL' }]) // snapshot attributes
      .mockResolvedValueOnce(undefined) // resolve ingestion errors
      .mockResolvedValueOnce(undefined) // transfer errors
      .mockResolvedValueOnce(undefined) // delete transient row
      .mockResolvedValueOnce(undefined) // sync original row
      .mockResolvedValueOnce(undefined) // clear original attributes
      .mockResolvedValueOnce(undefined); // restore original attributes

    const req = new Request('http://localhost/api/reingestsinglefailure/forestgeo_testing/123') as any;
    const res = await GET(req, makeParams('forestgeo_testing', '123'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Success');

    const calls = mockConnectionManager.executeQuery.mock.calls;
    const shiftCall = calls.find((call: any[]) => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('temporarymeasurements'));
    expect(shiftCall).toBeDefined();
    expect(String(shiftCall?.[0])).toContain('EXISTS (');
    expect(String(shiftCall?.[0])).not.toContain('mel.IsResolved = FALSE');
    expect(calls.some((call: any[]) => String(call[0]).includes('SELECT COALESCE(MAX(id), 0) as maxId'))).toBe(false);

    const syncCall = calls.find((call: any[]) => String(call[0]).includes('SET orig.CensusID'));
    expect(syncCall).toBeDefined();
    expect(String(syncCall?.[0])).toContain('orig.RawPublishedStemID');
    expect(syncCall?.[1]).toContain(5001);
    expect(String(syncCall?.[0])).not.toContain('orig.UploadFileID');
    expect(String(syncCall?.[0])).not.toContain('orig.UploadBatchID');
    expect(String(syncCall?.[0])).not.toContain('orig.SourceRowIndex');
  });

  it('threads RawPlotX/RawPlotY through restaging, the snapshot SELECT, and back onto the original CoreMeasurementID', async () => {
    const TARGET_MEASUREMENT_ID = 123;
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce({ affectedRows: 1, insertId: 501 }) // shift into temporarymeasurements
      .mockResolvedValueOnce(undefined) // bulkingestionprocess
      .mockResolvedValueOnce([
        {
          CensusID: 1,
          StemGUID: 77,
          IsValidated: null,
          MeasurementDate: '2024-06-15',
          MeasuredDBH: 12.3,
          MeasuredHOM: 1.3,
          Description: null,
          UserDefinedFields: null,
          RawTreeTag: 'T-1',
          RawStemTag: '1',
          RawSpCode: 'ACRU',
          RawQuadrat: 'Q01',
          RawX: 1.23,
          RawY: 4.56,
          RawPlotX: -0.271,
          RawPlotY: 267.5,
          RawCodes: 'AL',
          RawPublishedStemID: 5001,
          RawComments: null,
          IsActive: 1
        }
      ]) // snapshot result row
      .mockResolvedValueOnce([{ Code: 'AL' }]) // snapshot attributes
      .mockResolvedValueOnce(undefined) // resolve ingestion errors
      .mockResolvedValueOnce(undefined) // transfer errors
      .mockResolvedValueOnce(undefined) // delete transient row
      .mockResolvedValueOnce(undefined) // sync original row
      .mockResolvedValueOnce(undefined) // clear original attributes
      .mockResolvedValueOnce(undefined); // restore original attributes

    const req = new Request(`http://localhost/api/reingestsinglefailure/forestgeo_testing/${TARGET_MEASUREMENT_ID}`) as any;
    const res = await GET(req, makeParams('forestgeo_testing', String(TARGET_MEASUREMENT_ID)));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Success');

    const calls = mockConnectionManager.executeQuery.mock.calls;

    // Restaging: shiftQuery must carry cm.RawPlotX/RawPlotY into the
    // temporarymeasurements PlotX/PlotY columns at the matching position.
    const shiftCall = calls.find((call: any[]) => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('temporarymeasurements'));
    expect(shiftCall).toBeDefined();
    expect(String(shiftCall?.[0])).toContain('PlotX');
    expect(String(shiftCall?.[0])).toContain('PlotY');
    expect(String(shiftCall?.[0])).toContain('cm.RawPlotX');
    expect(String(shiftCall?.[0])).toContain('cm.RawPlotY');

    // snapshotResultSQL must select the new columns from coremeasurements.
    // (Identified by its unique 'LIMIT 1' — safeFormatQuery has already
    // substituted every '??' schema placeholder by the time it reaches
    // executeQuery, so matching on 'FROM ??.coremeasurements' would not work.)
    const snapshotCall = calls.find((call: any[]) => String(call[0]).startsWith('SELECT') && String(call[0]).includes('LIMIT 1'));
    expect(snapshotCall).toBeDefined();
    expect(String(snapshotCall?.[0])).toContain('RawPlotX');
    expect(String(snapshotCall?.[0])).toContain('RawPlotY');

    // syncOriginalRowSQL: the original CoreMeasurementID receives the
    // reingested raw coordinates at the correct bind-parameter position.
    const syncCall = calls.find((call: any[]) => String(call[0]).includes('SET orig.CensusID'));
    expect(syncCall).toBeDefined();
    expect(String(syncCall?.[0])).toContain('orig.RawPlotX = ?');
    expect(String(syncCall?.[0])).toContain('orig.RawPlotY = ?');

    const bindArray = syncCall?.[1] as unknown[];
    const rawPlotXIndex = syncSetParamIndex(String(syncCall?.[0]), 'RawPlotX');
    const rawPlotYIndex = syncSetParamIndex(String(syncCall?.[0]), 'RawPlotY');
    expect(rawPlotXIndex).toBeGreaterThanOrEqual(0);
    expect(rawPlotYIndex).toBeGreaterThanOrEqual(0);
    expect(bindArray[rawPlotXIndex]).toBe(-0.271);
    expect(bindArray[rawPlotYIndex]).toBe(267.5);
    expect(bindArray[bindArray.length - 1]).toBe(TARGET_MEASUREMENT_ID); // WHERE orig.CoreMeasurementID = ? stays last
  });
});
