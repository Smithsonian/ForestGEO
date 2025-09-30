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

// Keep mysql2.format deterministic for assertions (optional)
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params: any[]) => `FORMATTED_SQL:${sql}::PARAMS:${JSON.stringify(params)}`;
  return { format };
});

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

describe('batchedupload POST route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400s when requirements are missing: empty body', async () => {
    const req = makeRequest([]); // empty array -> invalid per route
    const res = await POST(req, makeParams('myschema', ['1', '2']));

    expect(res.status).toBe(400);
    const body = await res.json(); // ⟵ FIX: consume, don't use .resolves on a value
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
    const res = await POST(req, makeParams('myschema', ['1']));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error || body.message).toMatch(/Database error|validate context/i);
  });

  it('400s when plotID or censusID are not numbers', async () => {
    const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams('myschema', ['NaN', '2']));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/Invalid plotID or censusID/i);
  });

  it('200s and calls executeQuery on success; adds plotID/censusID and excludes id fields', async () => {
    const payload = [
      { id: 999, failedMeasurementID: 123, treeID: 10, stemGUID: 20, reason: 'bad diameter' },
      { treeID: 11, stemGUID: 21, reason: 'missing height' }
    ];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams('myschema', ['42', '7']));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Insert to SQL successful/i);

    // ⟵ FIX: default import already *is* the mocked module
    const exec = connectionmanager.getInstance().executeQuery as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);

    // With mocked mysql2.format we can sanity-check the SQL + params
    const sqlArg = exec.mock.calls[0][0] as string;
    expect(sqlArg).toContain('FORMATTED_SQL:');
    expect(sqlArg).toContain('INSERT INTO ?? ('); // don’t assert exact number of ?? (order can vary)
    expect(sqlArg).toContain('myschema.failedmeasurements');

    // Ensure excluded keys don’t appear as column names
    expect(sqlArg).not.toMatch(/failedMeasurementID/);
    // Beware: /id/ would also match 'plotID', so avoid that generic check.

    // Ensure plotID/censusID are present in params blob
    expect(sqlArg).toContain('"plotID"');
    expect(sqlArg).toContain('"censusID"');
    expect(sqlArg).toContain('42'); // plotID
    expect(sqlArg).toContain('7'); // censusID
  });

  it('500s and logs on DB error', async () => {
    const exec = connectionmanager.getInstance().executeQuery as ReturnType<typeof vi.fn>;
    exec.mockRejectedValueOnce(new Error('boom'));

    const payload = [{ treeID: 1, stemGUID: 2, reason: 'oops' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams('myschema', ['1', '2']));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toMatch(/Database error/i);
    expect(body.error).toMatch(/boom/);

    const logErr = ((ailogger as any).error ?? (ailogger as any).default?.error) as ReturnType<typeof vi.fn>;

    expect(logErr).toHaveBeenCalled();
  });
});
