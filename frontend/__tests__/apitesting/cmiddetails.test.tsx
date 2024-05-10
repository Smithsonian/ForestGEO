// app/api/details/cmid/route.test.ts

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '@/app/api/details/cmid/route'; // Import the API handler
import { getConn, runQuery } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';

// Mock dependencies
vi.mock('@/components/processors/processormacros', () => ({
  getConn: vi.fn(),
  runQuery: vi.fn(),
}));

let mockConnection: PoolConnection | null = null;

beforeEach(() => {
  // Reset the mocks before each test
  vi.resetAllMocks();

  // Mock the database connection and behavior
  mockConnection = {
    release: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
  } as unknown as PoolConnection;

  (getConn as Mock).mockResolvedValue(mockConnection);
});

describe('GET /api/details/cmid', () => {
  it('returns core measurement details with status 200', async () => {
    const mockResults = [
      {
        CoreMeasurementID: 1,
        PlotName: 'Test Plot',
        QuadratName: 'Test Quadrat',
        PlotCensusNumber: 2,
        StartDate: '2024-01-01',
        EndDate: '2024-02-01',
        FirstName: 'John',
        LastName: 'Doe',
        SpeciesName: 'Test Species',
      },
    ];

    // Mock the behavior of runQuery to return specific results
    (runQuery as Mock).mockResolvedValue(mockResults);

    // Create a request with parameters
    const url = new URL('http://localhost/api/details/cmid?cmid=1&schema=testschema');
    const request = new NextRequest(url.toString());

    // Call the GET handler
    const response = await GET(request);

    // Check the response status and data
    expect(response.status).toBe(200);
    const jsonResponse = await response.json();
    expect(jsonResponse).toEqual([
      {
        coreMeasurementID: 1,
        plotName: 'Test Plot',
        quadratName: 'Test Quadrat',
        plotCensusNumber: 2,
        censusStart: '2024-01-01',
        censusEnd: '2024-02-01',
        personnelName: 'John Doe',
        speciesName: 'Test Species',
      },
    ]);
  });

  it('throws an error when the schema parameter is missing', async () => {
    // Create a request without the schema parameter
    const url = new URL('http://localhost/api/details/cmid?cmid=1');
    const request = new NextRequest(url.toString());

    // Catch the error thrown by the GET handler
    await expect(GET(request)).rejects.toThrow('no schema variable provided!');
  });

  it('handles SQL errors gracefully', async () => {
    // Simulate an error in the runQuery function
    const errorMessage = 'SQL query failed';
    (runQuery as Mock).mockRejectedValue(new Error(errorMessage));

    // Create a request with parameters
    const url = new URL('http://localhost/api/details/cmid?cmid=1&schema=testschema');
    const request = new NextRequest(url.toString());

    // Catch the error thrown by the GET handler
    await expect(GET(request)).rejects.toThrow(`SQL query failed: ${errorMessage}`);
  });
});
