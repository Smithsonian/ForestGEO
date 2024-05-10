// app/api/fetchall/[fetchType]/route.test.ts
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '@/app/api/fetchall/[fetchType]/route';
import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory from "@/config/datamapper";  // Ensure it is imported as default
import { PoolConnection } from 'mysql2/promise';
import { IDataMapper } from '@/config/datamapper';

// Mock dependencies
vi.mock('@/components/processors/processormacros', () => ({
  getConn: vi.fn(),
  runQuery: vi.fn(),
}));

// Correctly mock default export 'MapperFactory'
vi.mock('@/config/datamapper', () => ({
  default: {  // Mock the default export structure
    getMapper: vi.fn(() => ({
      mapData: vi.fn().mockReturnValue([{ id: 1, name: 'Mock Data' }]),
    })),
  },
}));

let mockConnection: PoolConnection;

beforeEach(() => {
  // Reset mocks before each test
  vi.resetAllMocks();

  // Setup a mock database connection
  mockConnection = {
    release: vi.fn(),
    execute: vi.fn(),
  } as unknown as PoolConnection;

  (getConn as Mock).mockResolvedValue(mockConnection);
});

describe('GET /api/fetchall/[fetchType]', () => {
  const fetchTypes = ['plots', 'quadrats', 'census'];
  fetchTypes.forEach(type => {
    it(`fetches data for ${type} successfully`, async () => {
      const mockResults = [{ id: 1, name: `${type} Data` }];
      (runQuery as Mock).mockResolvedValue(mockResults);

      const mockMapper = { mapData: vi.fn().mockReturnValue(mockResults) };
      (MapperFactory.getMapper as Mock).mockReturnValue(mockMapper);

      const url = new URL(`http://localhost/api/fetchall/${type}?schema=testschema`);
      const request = new NextRequest(url.toString());

      const response = await GET(request, { params: { fetchType: type } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(mockResults);
    });
  });

  it('throws an error if the schema parameter is missing', async () => {
    const fetchType = 'plots';
    const url = new URL(`http://localhost/api/fetchall/${fetchType}`);
    const request = new NextRequest(url.toString());

    await expect(GET(request, { params: { fetchType } })).rejects.toThrow("Schema selection was not provided to API endpoint");
  });

  it('handles SQL errors gracefully', async () => {
    const errorMessage = 'SQL query failed';
    (runQuery as Mock).mockRejectedValue(new Error(errorMessage));

    const fetchType = 'plots';
    const url = new URL(`http://localhost/api/fetchall/${fetchType}?schema=testschema`);
    const request = new NextRequest(url.toString());

    await expect(GET(request, { params: { fetchType } })).rejects.toThrow("Call failed");
  });
});
