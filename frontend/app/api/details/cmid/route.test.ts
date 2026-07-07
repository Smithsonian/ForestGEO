// app/api/details/cmid/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---- Import route AFTER mocks ----
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager'; // ---- Helpers ----

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

// ---- Ensure ConnectionManager.getInstance() returns the shared mock instance ----
vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  // Reuse your shared mock instance if present; otherwise provide a safe stub.
  const instance = (candidate && typeof candidate.executeQuery === 'function' && typeof candidate.closeConnection === 'function' && candidate) || {
    executeQuery: vi.fn(async () => []),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// ---- Helpers ----
function makeRequest(cmid?: string | number, schema?: string) {
  const url = new URL('http://localhost/api/details/cmid');
  if (cmid !== undefined) url.searchParams.set('cmid', String(cmid));
  if (schema) url.searchParams.set('schema', schema);
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url; // Next.js reads request.nextUrl
  return req as any;
}

describe('GET /api/details/cmid', () => {
  const emptyCtx = { params: Promise.resolve({}) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when schema is missing', async () => {
    const req = makeRequest(123 /* cmid present */, undefined /* no schema */);
    const res = await GET(req, emptyCtx);
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
  });

  it('200 with mapped results; builds expected SQL + params; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([
      {
        CoreMeasurementID: 123,
        PlotName: 'Alpha',
        QuadratName: 'Q-01',
        PlotCensusNumber: 7,
        StartDate: '2025-01-01', // not mapped out
        EndDate: '2025-12-31', // not mapped out
        SpeciesName: 'Ficus'
      }
    ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest(123, 'forestgeo_testing');
    const res = await GET(req, emptyCtx);

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual([
      {
        coreMeasurementID: 123,
        plotName: 'Alpha',
        quadratName: 'Q-01',
        plotCensusNumber: 7,
        speciesName: 'Ficus'
      }
    ]);

    // SQL + params sanity
    expect(exec).toHaveBeenCalledTimes(1);
    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM\s+`forestgeo_testing`\.coremeasurements\s+cm/i);
    expect(String(sql)).toMatch(/WHERE\s+cm\.CoreMeasurementID\s*=\s*\?\s*;?/i);
    expect(params).toEqual([123]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates SQL errors (rejects) and still closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest(999, 'forestgeo_testing');
    await expect(GET(req, emptyCtx)).rejects.toThrow(/SQL query failed: boom/i);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
