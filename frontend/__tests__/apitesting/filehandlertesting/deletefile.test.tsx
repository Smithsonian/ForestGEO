// app/api/filehandlers/deletefile/route.test.ts

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '@/app/api/filehandlers/deletefile/route';
import { getContainerClient } from '@/config/macros/azurestorage';

// Mock `getContainerClient` dependency
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: vi.fn(),
}));

let mockBlobClient: { delete: Mock };
let mockContainerClient: { getBlobClient: Mock };

beforeEach(() => {
  // Reset mocks before each test
  vi.resetAllMocks();

  // Setup a mock blob client with a delete method
  mockBlobClient = {
    delete: vi.fn().mockResolvedValue(undefined),
  };

  // Mock the container client to return the mock blob client
  mockContainerClient = {
    getBlobClient: vi.fn().mockReturnValue(mockBlobClient),
  };

  // Configure `getContainerClient` to return the mock container client
  (getContainerClient as Mock).mockResolvedValue(mockContainerClient);
});

describe('DELETE /api/filehandlers/deletefile', () => {
  it('deletes the file successfully', async () => {
    // Setup a request with the required query parameters
    const url = new URL('http://localhost/api/filehandlers/deletefile?container=test-container&filename=test-file.txt');
    const request = new NextRequest(url.toString());

    // Call the DELETE handler
    const response = await DELETE(request);

    // Verify the results
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('File deleted successfully');
    expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith('test-file.txt');
    expect(mockBlobClient.delete).toHaveBeenCalledTimes(1);
  });

  it('returns an error if container or filename is missing', async () => {
    // Missing `filename` parameter
    const url = new URL('http://localhost/api/filehandlers/deletefile?container=test-container');
    const request = new NextRequest(url.toString());

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Container name and filename are required');
  });

  it('returns an error if the container client creation fails', async () => {
    // Simulate failure in creating the container client
    (getContainerClient as Mock).mockResolvedValue(null);

    const url = new URL('http://localhost/api/filehandlers/deletefile?container=test-container&filename=test-file.txt');
    const request = new NextRequest(url.toString());

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Container name and filename are required');
  });

  it('handles exceptions thrown during file deletion', async () => {
    // Simulate an error during the `delete` operation
    const errorMessage = 'Azure deletion error';
    mockBlobClient.delete.mockRejectedValue(new Error(errorMessage));

    const url = new URL('http://localhost/api/filehandlers/deletefile?container=test-container&filename=test-file.txt');
    const request = new NextRequest(url.toString());

    const response = await DELETE(request);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe(errorMessage);
  });
});
