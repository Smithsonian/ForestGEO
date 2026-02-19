// app/api/batchedupload/[schema]/[[...slugs]]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ailogger from '@/ailogger';
import connectionmanager from '@/config/connectionmanager';

vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const instance = { executeQuery };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const mockCapabilities = {
  hasUploadErrors: true,
  hasIngestMeasurements: true,
  hasValidateMeasurements: true
};

vi.mock('@/config/utils/schemacapabilities', () => ({
  getSchemaCapabilities: vi.fn().mockImplementation(() => Promise.resolve(mockCapabilities))
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
}

function makeParams(schema: string | undefined, slugs?: string[]) {
  return { params: Promise.resolve({ schema: schema as any, slugs }) } as any;
}

const VALID_SCHEMA = 'forestgeo_testing';
const ERROR_TYPE_PARSE = 'PARSE_VALIDATION_ERROR';

describe('batchedupload POST route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-establish mock after clearAllMocks
    const { getSchemaCapabilities } = await import('@/config/utils/schemacapabilities');
    (getSchemaCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue(mockCapabilities);
  });

  it('400s when requirements are missing: empty body', async () => {
    const req = makeRequest([]);
    const res = await POST(req, makeParams('myschema', ['1', '2']));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/No data provided for batch upload/i);
  });

  it('500s when schema is missing/empty', async () => {
    const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams('', ['1', '2']));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error || body.message).toMatch(/Database error|validate context/i);
  });

  it('500s when slugs is not exactly length 2', async () => {
    const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams(VALID_SCHEMA, ['1']));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error || body.message).toMatch(/Database error|validate context/i);
  });

  it('400s when plotID or censusID are not numbers', async () => {
    const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams(VALID_SCHEMA, ['NaN', '2']));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/Invalid plotID or censusID/i);
  });

  it('inserts into upload_errors with correct structure when schema supports it', async () => {
    const payload = [
      { id: 999, failedMeasurementID: 123, tag: 'T1', stemTag: 'S1', failureReasons: 'bad diameter', fileID: 'file1.csv', batchID: 'batch-abc' },
      { tag: 'T2', stemTag: 'S2', failureReasons: 'missing height' }
    ];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams(VALID_SCHEMA, ['42', '7']));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Insert to SQL successful/i);

    const exec = connectionmanager.getInstance().executeQuery as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);

    const sqlArg = exec.mock.calls[0][0] as string;
    expect(sqlArg).toContain('INSERT INTO');
    expect(sqlArg).toContain('upload_errors');
    expect(sqlArg).not.toContain('failedmeasurements');

    const valuesArg = exec.mock.calls[0][1] as any[][];
    expect(valuesArg[0]).toHaveLength(2); // Two rows

    const firstRow = valuesArg[0][0];
    // Column order: FileID, BatchID, PlotID, CensusID, RowIndex, RawData, ErrorType, ErrorMessage
    expect(firstRow[0]).toBe('file1.csv'); // FileID preserved, not null
    expect(firstRow[1]).toBe('batch-abc'); // BatchID preserved, not null
    expect(firstRow[2]).toBe(42); // PlotID from URL
    expect(firstRow[3]).toBe(7); // CensusID from URL
    expect(firstRow[4]).toBe(1); // RowIndex
    expect(firstRow[6]).toBe(ERROR_TYPE_PARSE);
    expect(firstRow[7]).toBe('bad diameter');

    // RawData should be parseable JSON with measurement fields
    const rawData = JSON.parse(firstRow[5]);
    expect(rawData.tag).toBe('T1');
    expect(rawData.stemTag).toBe('S1');

    // Second row should not have FileID/BatchID (wasn't provided)
    const secondRow = valuesArg[0][1];
    expect(secondRow[0]).toBeNull(); // No fileID on source row
    expect(secondRow[4]).toBe(2); // RowIndex increments
    expect(secondRow[7]).toBe('missing height');
  });

  it('inserts into failedmeasurements when schema lacks upload_errors', async () => {
    const { getSchemaCapabilities } = await import('@/config/utils/schemacapabilities');
    (getSchemaCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasUploadErrors: false,
      hasIngestMeasurements: false,
      hasValidateMeasurements: false
    });

    const payload = [
      { tag: 'T1', stemTag: 'S1', dbh: 10.5, failureReasons: 'bad diameter' }
    ];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams(VALID_SCHEMA, ['42', '7']));

    expect(res.status).toBe(200);

    const exec = connectionmanager.getInstance().executeQuery as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);

    const sqlArg = exec.mock.calls[0][0] as string;
    expect(sqlArg).toContain('failedmeasurements');
    expect(sqlArg).not.toContain('upload_errors');

    const valuesArg = exec.mock.calls[0][1] as any[][];
    const firstRow = valuesArg[0][0];
    // Legacy column order: PlotID, CensusID, Tag, StemTag, SpCode, ...
    expect(firstRow[0]).toBe(42); // PlotID
    expect(firstRow[1]).toBe(7); // CensusID
    expect(firstRow[2]).toBe('T1'); // Tag
    expect(firstRow[3]).toBe('S1'); // StemTag
  });

  it('500s and logs on DB error', async () => {
    const exec = connectionmanager.getInstance().executeQuery as ReturnType<typeof vi.fn>;
    exec.mockRejectedValueOnce(new Error('boom'));

    const payload = [{ treeID: 1, stemGUID: 2, reason: 'oops' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams(VALID_SCHEMA, ['1', '2']));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toMatch(/Database error/i);
    expect(body.error).toMatch(/boom/);

    const logErr = ((ailogger as any).error ?? (ailogger as any).default?.error) as ReturnType<typeof vi.fn>;
    expect(logErr).toHaveBeenCalled();
  });
});
