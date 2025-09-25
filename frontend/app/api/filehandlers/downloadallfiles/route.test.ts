// app/api/filehandlers/downloadallfiles/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---- Import handler after mocks ----
import { GET } from './route';

// ---- Hoisted spies used inside mocks ----
const { getContainerClientSpy, logWarnSpy, logErrorSpy } = vi.hoisted(() => ({
  getContainerClientSpy: vi.fn(),
  logWarnSpy: vi.fn(),
  logErrorSpy: vi.fn()
}));

// ---- Mocks (must be before importing the route) ----
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: getContainerClientSpy
}));

vi.mock('@/ailogger', () => ({
  default: { warn: logWarnSpy, error: logErrorSpy, info: vi.fn() }
}));

// ---- Helpers ----
function makeRequest(plot?: string, census?: string) {
  const url = new URL('http://localhost/api/filehandlers/downloadallfiles');
  if (plot !== undefined) url.searchParams.set('plot', plot);
  if (census !== undefined) url.searchParams.set('census', census);
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url; // Next.js handler reads request.nextUrl
  return req as any;
}

function asyncGen<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const it of items) {
        // tiny tick to simulate async
        await Promise.resolve();
        yield it as any;
      }
    }
  };
}

describe('GET /api/filehandlers/downloadallfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400 when plot or census is missing', async () => {
    const r1 = await GET(makeRequest(undefined, '7'));
    expect(r1.status).toBe(400);
    expect(await r1.text()).toMatch(/Both plot and census parameters are required/i);

    const r2 = await GET(makeRequest('Alpha', undefined));
    expect(r2.status).toBe(400);
    expect(await r2.text()).toMatch(/Both plot and census parameters are required/i);
  });

  it('400 when container client cannot be created', async () => {
    getContainerClientSpy.mockResolvedValueOnce(null as any);

    const res = await GET(makeRequest('Alpha', '9'));
    expect(getContainerClientSpy).toHaveBeenCalledWith('Alpha-9'); // no lowercasing in this route
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ statusText: 'Container client creation error' });
    expect(logWarnSpy).not.toHaveBeenCalled();
  });

  it('200 on success: lists blobs, maps fields, warns once', async () => {
    const blobs = [
      {
        name: 'file-1.csv',
        metadata: { user: 'sam', FormType: 'trees', FileErrorState: JSON.stringify(['err1', 'err2']) },
        properties: { lastModified: '2025-08-10T10:00:00Z' }
      },
      {
        name: 'file-2.csv',
        metadata: { user: 'amy', FormType: 'stems' }, // no FileErrorState
        properties: { lastModified: '2025-08-10T11:00:00Z' }
      }
    ];

    const listBlobsFlat = vi.fn(() => asyncGen(blobs));
    const containerClient = { listBlobsFlat } as any;
    getContainerClientSpy.mockResolvedValueOnce(containerClient);

    const res = await GET(makeRequest('Beta', '3'));

    // container creation + warn
    expect(getContainerClientSpy).toHaveBeenCalledWith('Beta-3');
    expect(logWarnSpy).toHaveBeenCalledWith('container client created');

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.responseMessage).toBe('List of files');
    expect(Array.isArray(body.blobData)).toBe(true);
    expect(body.blobData).toHaveLength(2);

    // keys are 1-indexed and fields mapped correctly
    expect(body.blobData[0]).toEqual({
      key: 1,
      name: 'file-1.csv',
      user: 'sam',
      formType: 'trees',
      fileErrors: ['err1', 'err2'],
      date: '2025-08-10T10:00:00Z'
    });
    expect(body.blobData[1]).toEqual({
      key: 2,
      name: 'file-2.csv',
      user: 'amy',
      formType: 'stems',
      fileErrors: '',
      date: '2025-08-10T11:00:00Z'
    });

    // ensure iterator invoked with options that include metadata/versions
    expect(listBlobsFlat).toHaveBeenCalledTimes(1);
    const [opts] = listBlobsFlat.mock.calls[0] as any[];
    expect(opts).toMatchObject({ includeMetadata: true, includeVersions: false });
  });

  it('400 when listBlobsFlat iteration throws; logs error with endpoint', async () => {
    const throwingIterable = {
      async *[Symbol.asyncIterator]() {
        throw new Error('boom');
      }
    };
    const containerClient = { listBlobsFlat: vi.fn(() => throwingIterable) } as any;
    getContainerClientSpy.mockResolvedValueOnce(containerClient);

    const req = makeRequest('Gamma', '4');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'boom' });
    expect(logErrorSpy).toHaveBeenCalled(); // ailogger.error('error in blob listing: ', error, { endpoint: ... })
  });
});
