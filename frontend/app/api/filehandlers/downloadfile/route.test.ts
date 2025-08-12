// app/api/filehandlers/downloadfile/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---------- Import handler AFTER mocks ----------
import { GET } from './route'; // ---------- Helpers ----------

// ---------- Hoisted mocks & classes (safe for use inside vi.mock) ----------
const { getContainerClientSpy, fromConnectionStringSpy, generateSASpy, parsePermsSpy, loggerErrSpy, MockStorageSharedKeyCredential } = vi.hoisted(() => ({
  getContainerClientSpy: vi.fn(),
  fromConnectionStringSpy: vi.fn(),
  generateSASpy: vi.fn(),
  parsePermsSpy: vi.fn(),
  loggerErrSpy: vi.fn(),
  // class must be created here so it's available to the hoisted vi.mock factory
  MockStorageSharedKeyCredential: class {}
}));

// ---------- Mocks (must be BEFORE importing the route) ----------
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: getContainerClientSpy
}));

vi.mock('@azure/storage-blob', () => {
  return {
    StorageSharedKeyCredential: MockStorageSharedKeyCredential,
    BlobSASPermissions: { parse: parsePermsSpy },
    generateBlobSASQueryParameters: generateSASpy,
    BlobServiceClient: { fromConnectionString: fromConnectionStringSpy }
  };
});

vi.mock('@/ailogger', () => ({
  default: { error: loggerErrSpy, warn: vi.fn(), info: vi.fn() }
}));

// ---------- Helpers ----------
function makeRequest(container?: string, filename?: string) {
  const url = new URL('http://localhost/api/filehandlers/downloadfile');
  if (container !== undefined) url.searchParams.set('container', container);
  if (filename !== undefined) url.searchParams.set('filename', filename);
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url; // Next.js reads request.nextUrl
  return req as any;
}

const OLD_ENV = { ...process.env };

describe('GET /api/filehandlers/downloadfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true;' };

    parsePermsSpy.mockImplementation((_s: string) => ({ r: true }) as any);
    generateSASpy.mockImplementation((_opts: any, _cred: any) => ({ toString: () => 'sas-token' }) as any);
    fromConnectionStringSpy.mockImplementation((_cs: string) => ({
      credential: new (MockStorageSharedKeyCredential as any)()
    }));
  });

  it('400 when container, filename, or connection string missing', async () => {
    const r1 = await GET(makeRequest(undefined, undefined));
    expect(r1.status).toBe(400);
    expect(await r1.text()).toMatch(/Container name, filename, and storage connection string are required/i);

    const r2 = await GET(makeRequest('bucket', undefined));
    expect(r2.status).toBe(400);

    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    const r3 = await GET(makeRequest('bucket', 'file.csv'));
    expect(r3.status).toBe(400);
  });

  it('400 when container client cannot be created', async () => {
    getContainerClientSpy.mockResolvedValueOnce(null as any);

    const res = await GET(makeRequest('MyContainer', 'file.csv'));
    expect(getContainerClientSpy).toHaveBeenCalledWith('mycontainer'); // route lowercases
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Failed to get container client/i);
  });

  it('200 on success with SAS token', async () => {
    const blobClient = { url: 'https://example.blob.core.windows.net/mycontainer/file.csv' };
    const containerClient = { getBlobClient: vi.fn(() => blobClient) };
    getContainerClientSpy.mockResolvedValueOnce(containerClient as any);

    const res = await GET(makeRequest('UPPER-CASE', 'file.csv'));
    expect(res.status).toBe(HTTPResponses.OK);

    expect(getContainerClientSpy).toHaveBeenCalledWith('upper-case');
    expect(fromConnectionStringSpy).toHaveBeenCalledWith('UseDevelopmentStorage=true;');
    expect(parsePermsSpy).toHaveBeenCalledWith('r');
    expect(generateSASpy).toHaveBeenCalledTimes(1);

    const body = await res.json();
    expect(body.url).toBe('https://example.blob.core.windows.net/mycontainer/file.csv?sas-token');
    expect(containerClient.getBlobClient).toHaveBeenCalledWith('file.csv');
  });

  it('200 when credential is NOT StorageSharedKeyCredential (empty SAS)', async () => {
    fromConnectionStringSpy.mockImplementationOnce((_cs: string) => ({ credential: {} }) as any);

    const blobClient = { url: 'https://example/foo.txt' };
    const containerClient = { getBlobClient: vi.fn(() => blobClient) };
    getContainerClientSpy.mockResolvedValueOnce(containerClient as any);

    const res = await GET(makeRequest('c', 'foo.txt'));
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.url).toBe('https://example/foo.txt?'); // route still appends '?'
    expect(generateSASpy).not.toHaveBeenCalled();
  });

  it('500 when any error is thrown and logs via ailogger.error', async () => {
    getContainerClientSpy.mockRejectedValueOnce(new Error('kaboom'));

    const res = await GET(makeRequest('bucket', 'x.csv'));
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/kaboom/i);
    expect(loggerErrSpy).toHaveBeenCalled(); // ailogger.error('Download file error:', error)
  });
});
