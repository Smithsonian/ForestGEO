import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/details/cmid/route';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { createMocks } from 'node-mocks-http';
import { NextRequest } from 'next/server';

vi.mock('@/components/processors/processormacros', () => ({
  getConn: vi.fn(),
  runQuery: vi.fn(),
}));

describe('GET /api/details/cmid', () => {
  it('should return 200 and data if query is successful', async () => {
    const mockData = [{
      CoreMeasurementID: 1,
      PlotName: 'Plot 1',
      QuadratName: 'Quadrat 1',
      PlotCensusNumber: 1,
      StartDate: '2023-01-01',
      EndDate: '2023-01-31',
      FirstName: 'John',
      LastName: 'Doe',
      SpeciesName: 'Species 1',
    }];

    const conn = {
      query: vi.fn().mockResolvedValue([mockData]),
      release: vi.fn(),
    };

    (getConn as jest.Mock).mockResolvedValue(conn);
    (runQuery as jest.Mock).mockResolvedValue(mockData);

    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/details/cmid?cmid=1&schema=test_schema',
    });

    const mockReq = new NextRequest(req.url);
    const response = await GET(mockReq);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mockData.map(row => ({
      coreMeasurementID: row.CoreMeasurementID,
      plotName: row.PlotName,
      quadratName: row.QuadratName,
      plotCensusNumber: row.PlotCensusNumber,
      censusStart: row.StartDate,
      censusEnd: row.EndDate,
      personnelName: `${row.FirstName} ${row.LastName}`,
      speciesName: row.SpeciesName,
    })));
  });

  it('should return 500 if there is a database error', async () => {
    (getConn as jest.Mock).mockRejectedValue(new Error('Database error'));

    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/details/cmid?cmid=1&schema=test_schema',
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq)).rejects.toThrow('Database error');
  });

  it('should return 400 if schema is not provided', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/details/cmid?cmid=1',
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq)).rejects.toThrow('no schema variable provided!');
  });
});
