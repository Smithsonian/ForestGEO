import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, POST } from './route';
import { HTTPResponses } from '@/config/macros';
import { SourceFormat } from '@/config/macros/formdetails';
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_REQUEST_BODY_BYTES,
  UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE,
  UPLOAD_LENGTH_REQUIRED_MESSAGE,
  UPLOAD_UNREADABLE_MESSAGE,
  ARCGIS_UPLOAD_RECOVERY_ADVICE,
  CSV_UPLOAD_RECOVERY_ADVICE,
  uploadFileTooLargeMessage,
  uploadRequestBodyTooLargeMessage
} from '@/lib/uploads/upload-request-limits';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  getContainerClient: vi.fn(),
  uploadValidFileAsBufferWithMetadata: vi.fn(),
  generateBlobSASQueryParameters: vi.fn(() => ({ toString: () => 'sig=mock' })),
  blobDelete: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema
}));

vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: mocks.getContainerClient,
  uploadValidFileAsBufferWithMetadata: mocks.uploadValidFileAsBufferWithMetadata
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

const SMALL_DECLARED_BODY_BYTES = 4096;
const UPLOAD_URL = 'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=measurements.csv&formType=measurements';

function makeUploadRequest(url: string, formData: FormData | null, declaredBodyBytes: number | null = SMALL_DECLARED_BODY_BYTES) {
  const headers: Record<string, string> = {};
  if (declaredBodyBytes !== null) headers['content-length'] = String(declaredBodyBytes);
  const request = makeRequest(url, { method: 'POST', headers }) as any;
  request.formData = vi.fn(async () => formData);
  return request;
}

function fileReportingSize(name: string, byteCount: number, type = 'text/csv'): File {
  const file = new File(['TreeTag\n1'], name, { type });
  Object.defineProperty(file, 'size', { value: byteCount });
  return file;
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
    mocks.uploadValidFileAsBufferWithMetadata.mockImplementation(async (_containerClient, _file, _user, _formType, _fileRowErrors, blobFileName) => ({
      response: { _response: { status: 201 } },
      blobName: blobFileName
    }));
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

  it('rejects requests without a plotID since the container cannot be derived (F19)', async () => {
    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'plotID parameter is required' });
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

  it('lists files from the schema-scoped plot/census container', async () => {
    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      responseMessage: 'List of files',
      containerName: 'forestgeo-testing-plot1-census2',
      blobData: [{ name: 'measurements.csv', user: 'mason@example.com' }]
    });
    expect(mocks.getContainerClient).toHaveBeenCalledWith('forestgeo-testing-plot1-census2', { createIfMissing: false });
  });

  it('deletes only from the schema-scoped plot/census container', async () => {
    const response = await DELETE(
      makeRequest('http://localhost/api/files/delete?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&filename=data.csv'),
      props('delete')
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(mocks.getContainerClient).toHaveBeenCalledWith('forestgeo-testing-plot1-census2', { createIfMissing: false });
    const containerClient = await mocks.getContainerClient.mock.results[0].value;
    expect(containerClient.getBlobClient).toHaveBeenCalledWith('data.csv');
    expect(mocks.blobDelete).toHaveBeenCalled();
  });

  it('never consults the legacy shared container when the schema-scoped one is empty (F19)', async () => {
    const emptyScopedClient = makeContainerClient([], true);
    mocks.getContainerClient.mockResolvedValue(emptyScopedClient);

    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2'), props('list'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      containerName: 'forestgeo-testing-plot1-census2',
      blobData: []
    });
    // Only the schema-scoped container is ever consulted.
    expect(mocks.getContainerClient).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerClient).toHaveBeenCalledWith('forestgeo-testing-plot1-census2', { createIfMissing: false });
    expect(mocks.getContainerClient).not.toHaveBeenCalledWith('plot1-census2', expect.anything());
    expect(mocks.getContainerClient).not.toHaveBeenCalledWith('bci-2', expect.anything());
  });

  it('does not serve another schema’s files sharing plotID/census (F19)', async () => {
    const containersTouched: string[] = [];
    mocks.getContainerClient.mockImplementation(async (containerName: string) => {
      containersTouched.push(containerName);
      return makeContainerClient(
        [
          {
            name: 'measurements.csv',
            metadata: { user: 'crew@example.com', FormType: 'measurements', FileErrorState: '[]' },
            properties: { lastModified: new Date('2026-01-01T00:00:00Z') }
          }
        ],
        true
      );
    });

    mocks.auth.mockResolvedValue({
      user: { email: 'alpha@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_alpha' }], allsites: [] }
    });
    const alphaResponse = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_alpha&plotID=1&plotName=Shared&census=1'), props('list'));
    expect(alphaResponse.status).toBe(200);
    await expect(alphaResponse.json()).resolves.toMatchObject({ containerName: 'forestgeo-alpha-plot1-census1' });

    mocks.auth.mockResolvedValue({
      user: { email: 'beta@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_beta' }], allsites: [] }
    });
    const betaResponse = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_beta&plotID=1&plotName=Shared&census=1'), props('list'));
    expect(betaResponse.status).toBe(200);
    await expect(betaResponse.json()).resolves.toMatchObject({ containerName: 'forestgeo-beta-plot1-census1' });

    // Each site resolves only its own schema-scoped container...
    expect(containersTouched).toEqual(['forestgeo-alpha-plot1-census1', 'forestgeo-beta-plot1-census1']);
    // ...and the legacy shared container that caused the cross-site leak is never touched.
    expect(containersTouched).not.toContain('plot1-census1');
  });

  it('rejects a site requesting another schema’s files even with a shared plotID/census (F19)', async () => {
    // Session scoped to forestgeo_alpha may not reach forestgeo_beta's container.
    mocks.auth.mockResolvedValue({
      user: { email: 'alpha@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_alpha' }], allsites: [] }
    });

    const response = await GET(makeRequest('http://localhost/api/files/list?schema=forestgeo_beta&plotID=1&plotName=Shared&census=1'), props('list'));

    expect(response.status).toBe(403);
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('uses authenticated identity for upload metadata instead of query user', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'measurements.csv', { type: 'text/csv' });
    formData.append('measurements.csv', file);

    const request = makeUploadRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=measurements.csv&formType=measurements&user=attacker@example.com',
      formData
    );

    const response = await POST(request, props('upload'));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(mocks.getContainerClient).toHaveBeenCalledWith('forestgeo-testing-plot1-census2');
    expect(responseBody).toMatchObject({ blobContainer: 'forestgeo-testing-plot1-census2', blobName: 'measurements.csv', byteSize: file.size });
    expect(mocks.uploadValidFileAsBufferWithMetadata).toHaveBeenCalledWith(
      expect.anything(),
      file,
      'mason@example.com',
      'measurements',
      [],
      'measurements.csv',
      'csv',
      undefined
    );
  });

  it('rejects measurement filenames longer than 50 characters before uploading the blob', async () => {
    const fileName = `${'a'.repeat(47)}.csv`;
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], fileName, { type: 'text/csv' });
    formData.append(fileName, file);
    const request = makeUploadRequest(
      `http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&census=2&fileName=${fileName}&formType=measurements`,
      formData
    );

    const response = await POST(request, props('upload'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'MEASUREMENT_FILE_NAME_TOO_LONG' });
    expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed fileRowErrors metadata', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'measurements.csv', { type: 'text/csv' });
    formData.append('measurements.csv', file);
    formData.append('fileRowErrors', '{not-json');
    const request = makeUploadRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&census=2&fileName=measurements.csv&formType=measurements',
      formData
    );

    const response = await POST(request, props('upload'));

    expect(response.status).toBe(400);
    expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
  });

  /**
   * fileRowErrors elements go into blob metadata and are read back as a trusted
   * FileRowErrors[]. The old code checked only "is it an array" and then cast,
   * so any caller-shaped objects were written through under a type nothing
   * re-validates.
   */
  describe('fileRowErrors element shape is validated, not asserted', () => {
    const VALID_ROW_ERROR = { tag: 'T1', stemtag: 'S1', validationErrorID: 7 };

    async function postWithFileRowErrors(rawFileRowErrors: string) {
      const formData = new FormData();
      const file = new File(['TreeTag\n1'], 'measurements.csv', { type: 'text/csv' });
      formData.append('measurements.csv', file);
      formData.append('fileRowErrors', rawFileRowErrors);
      const request = makeUploadRequest(
        'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&census=2&fileName=measurements.csv&formType=measurements',
        formData
      );
      return POST(request, props('upload'));
    }

    it('accepts a well-formed array and passes it through', async () => {
      const response = await postWithFileRowErrors(JSON.stringify([VALID_ROW_ERROR]));

      expect(response.status).toBe(200);
      expect(mocks.uploadValidFileAsBufferWithMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'mason@example.com',
        'measurements',
        [VALID_ROW_ERROR],
        'measurements.csv',
        'csv',
        undefined
      );
    });

    it.each([
      { label: 'a non-array', raw: JSON.stringify({ tag: 'T1' }) },
      { label: 'elements that are not objects', raw: JSON.stringify(['not-an-object']) },
      { label: 'a missing field', raw: JSON.stringify([{ tag: 'T1', stemtag: 'S1' }]) },
      { label: 'a wrongly-typed field', raw: JSON.stringify([{ tag: 'T1', stemtag: 'S1', validationErrorID: 'seven' }]) },
      { label: 'a fractional validationErrorID', raw: JSON.stringify([{ tag: 'T1', stemtag: 'S1', validationErrorID: 1.5 }]) },
      { label: 'a null element', raw: JSON.stringify([null]) }
    ])('rejects $label with 400 and uploads nothing', async ({ raw }) => {
      const response = await postWithFileRowErrors(raw);

      expect(response.status).toBe(400);
      expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
    });
  });

  it('uploads using the sanitized filename that passed route validation', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'bad/name.csv', { type: 'text/csv' });
    formData.append('bad/name.csv', file);

    const request = makeUploadRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=bad%2Fname.csv&formType=measurements',
      formData
    );

    const response = await POST(request, props('upload'));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody).toMatchObject({ blobName: 'name.csv', fileName: 'name.csv' });
    expect(mocks.uploadValidFileAsBufferWithMetadata).toHaveBeenCalledWith(
      expect.anything(),
      file,
      'mason@example.com',
      'measurements',
      [],
      'name.csv',
      'csv',
      undefined
    );
  });

  it('propagates the arcgis_xlsx sourceFormat so archived blob provenance is preserved', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'arcgis-export.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    formData.append('arcgis-export.xlsx', file);

    const request = makeUploadRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=arcgis-export.xlsx&formType=measurements&sourceFormat=arcgis_xlsx',
      formData
    );

    const response = await POST(request, props('upload'));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody).toMatchObject({ sourceFormat: 'arcgis_xlsx', blobName: 'arcgis-export.xlsx' });
    expect(mocks.uploadValidFileAsBufferWithMetadata).toHaveBeenCalledWith(
      expect.anything(),
      file,
      'mason@example.com',
      'measurements',
      [],
      'arcgis-export.xlsx',
      'arcgis_xlsx',
      undefined
    );
  });

  it('rejects an unknown sourceFormat before storing provenance', async () => {
    const formData = new FormData();
    const file = new File(['TreeTag\n1'], 'measurements.csv', { type: 'text/csv' });
    formData.append('measurements.csv', file);

    const request = makeUploadRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=measurements.csv&formType=measurements&sourceFormat=pretend_arcgis',
      formData
    );

    const response = await POST(request, props('upload'));

    expect(response.status).toBe(400);
    expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
  });

  it('rejects arcgis_xlsx provenance for non-measurement uploads', async () => {
    const formData = new FormData();
    const file = new File(['code,description\nA,Attr'], 'attributes.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    formData.append('attributes.xlsx', file);

    const request = makeUploadRequest(
      'http://localhost/api/files/upload?schema=forestgeo_testing&plotID=1&plotName=BCI&census=2&fileName=attributes.xlsx&formType=attributes&sourceFormat=arcgis_xlsx',
      formData
    );

    const response = await POST(request, props('upload'));

    expect(response.status).toBe(400);
    expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
  });

  describe('upload body size and readability', () => {
    function measurementsForm(file: File) {
      const formData = new FormData();
      formData.append('measurements.csv', file);
      return formData;
    }

    it('rejects an unauthenticated upload with 401 before checking size or reading the body', async () => {
      mocks.auth.mockResolvedValueOnce(null);
      const request = makeUploadRequest(UPLOAD_URL, measurementsForm(fileReportingSize('measurements.csv', 10)), null);

      const response = await POST(request, props('upload'));

      expect(response.status, 'upload routes must not rely on middleware for auth').toBe(HTTPResponses.UNAUTHORIZED);
      expect(request.formData).not.toHaveBeenCalled();
    });

    it('answers 411 when the upload declares no Content-Length, without parsing', async () => {
      const request = makeUploadRequest(UPLOAD_URL, measurementsForm(fileReportingSize('measurements.csv', 10)), null);

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.LENGTH_REQUIRED);
      expect(body.error).toBe(UPLOAD_LENGTH_REQUIRED_MESSAGE);
      expect(request.formData).not.toHaveBeenCalled();
      expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
    });

    it('answers 413 with the request-body message when metadata pushes an under-limit file over the ceiling', async () => {
      const underLimitFile = fileReportingSize('measurements.csv', MAX_UPLOAD_FILE_BYTES - 10);
      const request = makeUploadRequest(UPLOAD_URL, measurementsForm(underLimitFile), MAX_UPLOAD_REQUEST_BODY_BYTES + 1);

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.PAYLOAD_TOO_LARGE);
      expect(body.error).toBe(uploadRequestBodyTooLargeMessage(SourceFormat.csv));
      expect(body.error, 'must not present the request length as the file size').not.toMatch(/^File is/);
      expect(request.formData).not.toHaveBeenCalled();
    });

    it('answers 400 "could not be read" when the multipart body cannot be parsed, never "File is required"', async () => {
      const request = makeUploadRequest(UPLOAD_URL, null);
      request.formData = vi.fn(async () => {
        throw new TypeError('Failed to parse body as FormData.');
      });

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.INVALID_REQUEST);
      expect(body.error).toBe(UPLOAD_UNREADABLE_MESSAGE);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse body as FormData'),
        expect.objectContaining({ route: '/api/files/upload' })
      );
    });

    it('still answers "File is required" when the form parses but carries no fields', async () => {
      const request = makeUploadRequest(UPLOAD_URL, new FormData());

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
      expect(body.error).toBe('File is required');
    });

    it('accepts a file exactly at the per-file limit', async () => {
      const request = makeUploadRequest(
        UPLOAD_URL,
        measurementsForm(fileReportingSize('measurements.csv', MAX_UPLOAD_FILE_BYTES)),
        MAX_UPLOAD_REQUEST_BODY_BYTES
      );

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);
      expect(body.byteSize).toBe(MAX_UPLOAD_FILE_BYTES);
    });

    it('rejects a file one byte over the per-file limit with the file-size message', async () => {
      const overLimit = MAX_UPLOAD_FILE_BYTES + 1;
      const request = makeUploadRequest(UPLOAD_URL, measurementsForm(fileReportingSize('measurements.csv', overLimit)), MAX_UPLOAD_REQUEST_BODY_BYTES);

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.PAYLOAD_TOO_LARGE);
      expect(body.error).toBe(uploadFileTooLargeMessage(overLimit, SourceFormat.csv));
      expect(mocks.uploadValidFileAsBufferWithMetadata).not.toHaveBeenCalled();
    });

    it.each([
      ['csv (default when sourceFormat is omitted)', '', CSV_UPLOAD_RECOVERY_ADVICE],
      ['arcgis_xlsx', '&sourceFormat=arcgis_xlsx', ARCGIS_UPLOAD_RECOVERY_ADVICE],
      ['an unrecognised sourceFormat', '&sourceFormat=shapefile', UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE]
    ])('gives %s recovery advice on a request-body rejection', async (_label, sourceFormatQuery, advice) => {
      const request = makeUploadRequest(`${UPLOAD_URL}${sourceFormatQuery}`, null, MAX_UPLOAD_REQUEST_BODY_BYTES + 1);

      const response = await POST(request, props('upload'));
      const body = await response.json();

      expect(response.status).toBe(HTTPResponses.PAYLOAD_TOO_LARGE);
      expect(body.error.endsWith(advice), body.error).toBe(true);
    });
  });
});
