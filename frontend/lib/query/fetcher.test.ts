import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultFetcher, QueryError } from './fetcher';

describe('QueryError', () => {
  it('captures status, body, and message', () => {
    const err = new QueryError(418, { reason: 'teapot' }, 'GET /x 418');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(418);
    expect(err.body).toEqual({ reason: 'teapot' });
    expect(err.message).toBe('GET /x 418');
  });
});

describe('defaultFetcher', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns JSON on a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rows: [1, 2] }), { status: 200, headers: { 'content-type': 'application/json' } })
    ));
    const result = await defaultFetcher('/api/x');
    expect(result).toEqual({ rows: [1, 2] });
  });

  it('passes credentials: include to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await defaultFetcher('/api/x');
    expect(fetchMock).toHaveBeenCalledWith('/api/x', { credentials: 'include' });
  });

  it('throws QueryError with parsed body on a JSON 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reason: 'missing' }), { status: 404, headers: { 'content-type': 'application/json' } })
    ));
    await expect(defaultFetcher('/api/x')).rejects.toMatchObject({
      status: 404,
      body: { reason: 'missing' }
    });
  });

  it('throws QueryError with undefined body on a non-JSON 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html/>', { status: 500 })));
    await expect(defaultFetcher('/api/x')).rejects.toMatchObject({ status: 500, body: undefined });
  });

  it('propagates network errors unchanged', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(netErr));
    await expect(defaultFetcher('/api/x')).rejects.toBe(netErr);
  });
});
