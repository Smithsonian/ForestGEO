import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/cmprevalidation/[dataType]/[[...slugs]]/route';
import { createMocks } from 'node-mocks-http';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import { NextRequest } from 'next/server';

vi.mock('@/components/processors/processormacros', () => ({
  getConn: vi.fn(),
  runQuery: vi.fn(),
}));

describe('GET /api/cmprevalidation/[dataType]/[[...slugs]]', () => {
  it('should return 412 if required tables are empty', async () => {
    const conn = {
      query: vi.fn().mockResolvedValue([[]]),
      release: vi.fn(),
    };

    (getConn as jest.Mock).mockResolvedValue(conn);
    (runQuery as jest.Mock).mockResolvedValue([]);

    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/cmprevalidation/attributes/schema/1/1',
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq, { params: { dataType: 'attributes', slugs: ['schema', '1', '1'] } });

    expect(response.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);
  });

  it('should return 200 if required tables are populated', async () => {
    const conn = {
      query: vi.fn().mockResolvedValue([[1]]),
      release: vi.fn(),
    };

    (getConn as jest.Mock).mockResolvedValue(conn);
    (runQuery as jest.Mock).mockResolvedValue([[1]]);

    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/cmprevalidation/attributes/schema/1/1',
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq, { params: { dataType: 'attributes', slugs: ['schema', '1', '1'] } });

    expect(response.status).toBe(HTTPResponses.OK);
  });

  it('should return 500 if there is a database error', async () => {
    (getConn as jest.Mock).mockRejectedValue(new Error('Database error'));

    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/cmprevalidation/attributes/schema/1/1',
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq, { params: { dataType: 'attributes', slugs: ['schema', '1', '1'] } }))
      .rejects
      .toThrow('Database error');
  });

  it('should return 400 if slugs are missing', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/cmprevalidation/attributes',
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq, { params: { dataType: 'attributes', slugs: [] } }))
      .rejects
      .toThrow('incorrect slugs provided');
  });

  it('should return 400 if slugs are incorrect', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/cmprevalidation/attributes/schema',
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq, { params: { dataType: 'attributes', slugs: ['schema'] } }))
      .rejects
      .toThrow('incorrect slugs provided');
  });
});
