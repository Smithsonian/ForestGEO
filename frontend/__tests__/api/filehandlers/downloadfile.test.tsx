import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/filehandlers/downloadfile/route';
import { getContainerClient } from '@/config/macros/azurestorage';
import { createMocks } from 'node-mocks-http';
import { NextRequest } from 'next/server';
import {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} from '@azure/storage-blob';

vi.mock('@azure/storage-blob', async () => {
  const actual = await vi.importActual<typeof import('@azure/storage-blob')>('@azure/storage-blob');
  return {
    ...actual,
    BlobServiceClient: {
      fromConnectionString: vi.fn()
    },
    generateBlobSASQueryParameters: vi.fn()
  };
});

vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: vi.fn()
}));

describe('GET /api/filehandlers/downloadfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if container name, filename, or storage connection string is missing', async () => {
    const { req } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/filehandlers/downloadfile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(400);
    const data = await response.text();
    expect(data).toBe('Container name, filename, and storage connection string are required');
  });

  it('should return 400 if container client creation fails', async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'test-connection-string';
    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { req } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/filehandlers/downloadfile?container=testContainer&filename=testFile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(400);
    const data = await response.text();
    expect(data).toBe('Failed to get container client');
  });

  it('should return 200 and SAS token URL if successful', async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'test-connection-string';

    const mockContainerClient = {
      getBlobClient: vi.fn().mockReturnValue({
        url: 'https://testaccount.blob.core.windows.net/testcontainer/testblob'
      })
    };

    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainerClient);

    (BlobServiceClient.fromConnectionString as ReturnType<typeof vi.fn>).mockReturnValue({
      credential: new StorageSharedKeyCredential('testaccount', 'testkey')
    });

    (generateBlobSASQueryParameters as ReturnType<typeof vi.fn>).mockReturnValue({
      toString: () => 'sastoken'
    });

    const { req } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/filehandlers/downloadfile?container=testContainer&filename=testFile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.url).toBe('https://testaccount.blob.core.windows.net/testcontainer/testblob?sastoken');
  });

  it('should return 500 if there is an error', async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'test-connection-string';

    (getContainerClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Test error'));

    const { req } = createMocks({
      method: 'GET',
      url: 'http://localhost/api/filehandlers/downloadfile?container=testContainer&filename=testFile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(500);
    const data = await response.text();
    expect(data).toBe('Test error');
  });
});
