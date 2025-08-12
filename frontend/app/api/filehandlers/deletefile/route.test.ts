// app/api/filehandlers/deletefile/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---- Import the handler after mocks ----
import { DELETE } from './route';

// ---- Hoisted spies used inside mocks ----
const { getContainerClientSpy, logErrorSpy } = vi.hoisted(() => ({
  getContainerClientSpy: vi.fn(),
  logErrorSpy: vi.fn()
}));

// ---- Mocks (must be before importing the route) ----
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: getContainerClientSpy
}));

vi.mock('@/ailogger', () => ({
  default: { error: logErrorSpy, info: vi.fn(), warn: vi.fn() }
}));

// ---- Helpers ----
function makeRequest(container?: string, filename?: string) {
  const url = new URL('http://localhost/api/filehandlers/deletefile');
  if (container !== undefined) url.searchParams.set('container', container);
  if (filename !== undefined) url.searchParams.set('filename', filename);
  const req: any = new Request(url.toString(), { method: 'DELETE' });
  req.nextUrl = url; // Next.js reads request.nextUrl
  return req as any;
}

describe('DELETE /api/filehandlers/deletefile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400 when container or filename is missing', async () => {
    const r1 = await DELETE(makeRequest(undefined, 'file.csv'));
    expect(r1.status).toBe(400);
    expect(await r1.text()).toMatch(/Container name and filename are required/i);

    const r2 = await DELETE(makeRequest('MyContainer', undefined));
    expect(r2.status).toBe(400);
    expect(await r2.text()).toMatch(/Container name and filename are required/i);
  });

  it('400 when getContainerClient returns falsy', async () => {
    getContainerClientSpy.mockResolvedValueOnce(null as any);

    const res = await DELETE(makeRequest('MyContainer', 'file.csv'));
    expect(getContainerClientSpy).toHaveBeenCalledWith('mycontainer'); // lowercased
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Container name and filename are required/i);
  });

  it('200 on success: deletes blob and returns success text', async () => {
    const deleteMock = vi.fn(async () => {});
    const blobClient = { delete: deleteMock };
    const containerClient = { getBlobClient: vi.fn(() => blobClient) };

    getContainerClientSpy.mockResolvedValueOnce(containerClient as any);

    const res = await DELETE(makeRequest('UPPER-CASE', 'My File.csv'));

    // Called with lowercased container
    expect(getContainerClientSpy).toHaveBeenCalledWith('upper-case');

    // Correct blob + delete invoked
    expect(containerClient.getBlobClient).toHaveBeenCalledWith('My File.csv');
    expect(deleteMock).toHaveBeenCalledTimes(1);

    // Response
    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.text()).toBe('File deleted successfully');
  });

  it('500 when blob deletion throws and logs error', async () => {
    const deleteMock = vi.fn(async () => {
      throw new Error('boom');
    });
    const blobClient = { delete: deleteMock };
    const containerClient = { getBlobClient: vi.fn(() => blobClient) };

    getContainerClientSpy.mockResolvedValueOnce(containerClient as any);

    const res = await DELETE(makeRequest('bucket', 'bad.csv'));

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/boom/i);
    expect(logErrorSpy).toHaveBeenCalled(); // ailogger.error('Delete file error:', ...)
  });
});
