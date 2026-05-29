import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  getContainerClient: vi.fn(),
  uploadValidFileAsBuffer: vi.fn(),
  generateBlobSASQueryParameters: vi.fn(() => ({ toString: () => 'sig=mock' })),
  blobDelete: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema
}));

vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: mocks.getContainerClient,
  uploadValidFileAsBuffer: mocks.uploadValidFileAsBuffer
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

vi.mock('@azure/storage-blob', () => {
  class StorageSharedKeyCredential {}
  const credential = new StorageSharedKeyCredential();

  return {
    BlobSASPermissions: {
      parse: vi.fn((value: string) => value)
    },
    BlobServiceClient: {
      fromConnectionString: vi.fn(() => ({ credential }))
    },
    StorageSharedKeyCredential,
    generateBlobSASQueryParameters: mocks.generateBlobSASQueryParameters
  };
});

function makeRequest(url: string, init?: RequestInit) {
  const request = new Request(url, init) as NextRequest;
  Object.defineProperty(request, 'nextUrl', { value: new URL(url) });
  return request;
}

function props(operation: string) {
  return { params: Promise.resolve({ operation }) };
}

function makeContainerClient(blobs: any[] = [], exists = true) {
  return {
    exists: vi.fn(async () => exists),
    getBlobClient: vi.fn((filename: string) => ({
      url: `https://storage.local/${filename}`,
      delete: mocks.blobDelete
    })),
    listBlobsFlat: vi.fn(async function* () {
      for (const blob of blobs) {
        yield blob;
      }
    })
  };
}

describe('/api/files/[operation]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=abc;EndpointSuffix=core.windows.net';
    mocks.auth.mockResolvedValue({
      user: {
        email: 'mason@example.com',
        name: 'Mason',
        userStatus: 'field crew',
        sites: [{ schemaName: 'forestgeo_testing' }],
        allsites: []
      }
    });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.getContainerClient.mockResolvedValue(
      makeContainerClient([
        {
          name: 'measurements.csv',
          metadata: { user: 'mason@example.com', FormType: 'measurements', FileErrorState: '[]' },
          properties: { lastModified: new Date('2026-01-01T00:00:00Z') }
        }
      ])
    );
    mocks.uploadValidFileAsBuffer.mockResolvedValue({ _response: { status: 201 } });
    mocks.blobDelete.mockResolvedValue(undefined);
  });

  it('rejects file list when authentication is missing', async () => {
    mocks.auth.mockResolvedValueOnce(null);

    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(401);
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('rejects file operations when permissions are unavailable', async () => {
    mocks.auth.mockResolvedValueOnce({
      user: { email: 'mason@example.com', permissionsUnavailable: true, sites: [], allsites: [] }
    });

    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(503);
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('rejects schemas outside the authenticated user site list', async () => {
    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_other&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(403);
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('rejects caller-supplied containers that do not match the authorized scope', async () => {
    const response = await GET(
      makeRequest('http://localhost/api/files/download?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&container=plot99-census99&filename=data.csv'),
      props('download')
    );

    expect(response.status).toBe(403);
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('rejects unauthorized upload scope before reading multipart body', async () => {
    const request = makeRequest(
      'http://localhost/api/files/upload?schema=forestgeo_other&plotID=1&plotName=BCI&census=2&fileName=measurements.csv&formType=measurements',
      {
        method: 'POST'
      }
    ) as any;
    request.formData = vi.fn();

    const response = await POST(request, props('upload'));

    expect(response.status).toBe(403);
    expect(request.formData).not.toHaveBeenCalled();
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('lists files from the server-derived plot/census container', async () => {
    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      responseMessage: 'List of files',
      containerName: 'plot1-census2',
      blobData: [{ name: 'measurements.csv', user: 'mason@example.com' }]
    });
    expect(mocks.getContainerClient).toHaveBeenCalledWith('plot1-census2', { createIfMissing: false });
  });

  it('deletes only from the server-derived plot/census container', async () => {
    const response = await DELETE(
      makeRequest('http://localhost/api/files/delete?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&filename=data.csv'),
      props('delete')
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(mocks.getContainerClient).toHaveBeenCalledWith('plot1-census2', { createIfMissing: false });
    const containerClient = await mocks.getContainerClient.mock.results[0].value;
    expect(containerClient.getBlobClient).toHaveBeenCalledWith('data.csv');
    expect(mocks.blobDelete).toHaveBeenCalled();
  });

  it('falls back to the legacy container without creating the missing primary container', async () => {
    const primaryClient = makeContainerClient([], false);
    const legacyClient = makeContainerClient([
      {
        name: 'legacy-measurements.csv',
        metadata: { user: 'mason@example.com', FormType: 'measurements', FileErrorState: '[]' },
        properties: { lastModified: new Date('2026-01-01T00:00:00Z') }
      }
    ]);
    mocks.getContainerClient.mockImplementation(async (containerName: string) => (containerName === 'plot1-census2' ? primaryClient : legacyClient));

    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      containerName: 'bci-2',
      blobData: [{ name: 'legacy-measurements.csv' }]
    });
    expect(mocks.getContainerClient).toHaveBeenNthCalledWith(1, 'plot1-census2', { createIfMissing: false });
    expect(mocks.getContainerClient).toHaveBeenNthCalledWith(2, 'bci-2', { createIfMissing: false });
  });

  it('uses authenticated identity for upload metadata instead of query user', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'measurements.csv', { type: 'text/csv' });
    formData.append('measurements.csv', file);

    const request = makeRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=measurements.csv&formType=measurements&user=attacker@example.com',
      { method: 'POST' }
    ) as any;
    request.formData = vi.fn(async () => formData);

    const response = await POST(request, props('upload'));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(mocks.getContainerClient).toHaveBeenCalledWith('plot1-census2');
    expect(mocks.uploadValidFileAsBuffer).toHaveBeenCalledWith(expect.anything(), file, 'mason@example.com', 'measurements', [], 'measurements.csv');
  });

  it('uploads using the sanitized filename that passed route validation', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'bad/name.csv', { type: 'text/csv' });
    formData.append('bad/name.csv', file);

    const request = makeRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=bad%2Fname.csv&formType=measurements',
      { method: 'POST' }
    ) as any;
    request.formData = vi.fn(async () => formData);

    const response = await POST(request, props('upload'));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(mocks.uploadValidFileAsBuffer).toHaveBeenCalledWith(expect.anything(), file, 'mason@example.com', 'measurements', [], 'name.csv');
  });
});
