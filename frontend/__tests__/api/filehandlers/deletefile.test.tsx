import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE } from '@/app/api/filehandlers/deletefile/route';
import { getContainerClient } from '@/config/macros/azurestorage';
import { createMocks } from 'node-mocks-http';
import { NextRequest } from 'next/server';

vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: vi.fn()
}));

describe('DELETE /api/filehandlers/deletefile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if container name or filename is missing', async () => {
    const { req } = createMocks({
      method: 'DELETE',
      url: 'http://localhost/api/filehandlers/deletefile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await DELETE(mockReq);
    expect(response.status).toBe(400);
    const data = await response.text();
    expect(data).toBe('Container name and filename are required');
  });

  it('should return 400 if container client creation fails', async () => {
    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { req } = createMocks({
      method: 'DELETE',
      url: 'http://localhost/api/filehandlers/deletefile?container=testContainer&filename=testFile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await DELETE(mockReq);
    expect(response.status).toBe(400);
    const data = await response.text();
    expect(data).toBe('Container name and filename are required');
  });

  it('should return 200 and delete the file if successful', async () => {
    const mockBlobClient = {
      delete: vi.fn().mockResolvedValue({})
    };
    const mockContainerClient = {
      getBlobClient: vi.fn().mockReturnValue(mockBlobClient)
    };

    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainerClient);

    const { req } = createMocks({
      method: 'DELETE',
      url: 'http://localhost/api/filehandlers/deletefile?container=testContainer&filename=testFile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await DELETE(mockReq);
    expect(response.status).toBe(200);
    const data = await response.text();
    expect(data).toBe('File deleted successfully');
    expect(mockBlobClient.delete).toHaveBeenCalled();
  });

  it('should return 500 if there is an error', async () => {
    (getContainerClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Test error'));

    const { req } = createMocks({
      method: 'DELETE',
      url: 'http://localhost/api/filehandlers/deletefile?container=testContainer&filename=testFile'
    });

    const mockReq = new NextRequest(req.url);

    const response = await DELETE(mockReq);
    expect(response.status).toBe(500);
    const data = await response.text();
    expect(data).toBe('Test error');
  });
});
