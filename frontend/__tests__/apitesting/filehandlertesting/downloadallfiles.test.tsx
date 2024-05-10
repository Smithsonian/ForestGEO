// app/api/filehandlers/downloadall/route.test.ts

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/filehandlers/downloadallfiles/route';
import { getContainerClient } from '@/config/macros/azurestorage';

// Mock dependencies
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: vi.fn(),
}));

let mockContainerClient: { listBlobsFlat: Mock };

beforeEach(() => {
  // Reset mocks before each test
  vi.resetAllMocks();

  // Create a mock container client
  mockContainerClient = {
    listBlobsFlat: vi.fn().mockImplementation(async function* () {
      yield {
        name: 'test-file.txt',
        metadata: {
          user: 'user1',
          FormType: 'typeA',
          FileErrorState: JSON.stringify({ error: 'none' }),
        },
        properties: {
          lastModified: new Date(),
        },
      };
    }),
  };

  // Mock `getContainerClient` to return the mock container client
  (getContainerClient as Mock).mockResolvedValue(mockContainerClient);
});

describe('GET /api/filehandlers/downloadall', () => {
  it('returns a list of files successfully', async () => {
    // Create a request with required parameters
    const url = new URL('http://localhost/api/filehandlers/downloadall?plot=plot1&census=census1');
    const request = new NextRequest(url.toString());

    // Call the GET handler
    const response = await GET(request);

    // Verify the results
    expect(response.status).toBe(200);
    const jsonResponse = await response.json();
    expect(jsonResponse.responseMessage).toBe('List of files');
    expect(jsonResponse.blobData).toHaveLength(1);
    expect(jsonResponse.blobData[0].name).toBe('test-file.txt');
  });

  it('returns an error if plot or census is missing', async () => {
    // Missing `census` parameter
    const url = new URL('http://localhost/api/filehandlers/downloadall?plot=plot1');
    const request = new NextRequest(url.toString());

    const response = await GET(request);

    expect(response.status).toBe(400);
    let json = await response.json();
    expect(json).toEqual({ statusText: 'Container client creation error' });
  });

  it('returns an error if the container client creation fails', async () => {
    // Simulate a failure in creating the container client
    (getContainerClient as Mock).mockResolvedValue(null);

    const url = new URL('http://localhost/api/filehandlers/downloadall?plot=plot1&census=census1');
    const request = new NextRequest(url.toString());

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ statusText: 'Container client creation error' });
  });

  it('handles errors during blob listing', async () => {
    // Simulate an error during the `listBlobsFlat` operation
    mockContainerClient.listBlobsFlat.mockImplementationOnce(async function* () {
      throw new Error('Blob listing failed');
    });

    const url = new URL('http://localhost/api/filehandlers/downloadall?plot=plot1&census=census1');
    const request = new NextRequest(url.toString());

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Blob listing failed' });
  });
});
