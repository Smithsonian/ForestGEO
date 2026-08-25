import { afterEach, describe, expect, it, vi } from 'vitest';
import ailogger from '@/ailogger';
import { cleanupUploadedFiles, rekeyByStoredFileName, type BlobUploadResult, type UploadedFileReference } from './uploadasyncjob';

vi.mock('@/ailogger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

const file: BlobUploadResult = {
  fileName: 'measurements.csv',
  blobContainer: 'forestgeo-testing-plot1-census2',
  blobName: 'measurements_1.csv',
  contentType: 'text/csv',
  byteSize: 10,
  formType: 'measurements',
  sourceFormat: 'csv'
};

describe('rekeyByStoredFileName', () => {
  // /api/files/upload replaces every character outside [a-zA-Z0-9._-] with '_'
  // and stores the blob under that name. The wizard keys its delimiter and
  // column-mapping maps by the raw browser File.name, so without re-keying the
  // job route rejects the whole request with "unknown file name" and the worker
  // would never find the mapping for the file it is processing.
  const uploadedFiles: UploadedFileReference[] = [
    {
      originalFileName: 'Harvard Forest 2014.csv',
      blob: { ...file, fileName: 'Harvard_Forest_2014.csv', blobName: 'Harvard_Forest_2014.csv' }
    },
    {
      originalFileName: 'plain.csv',
      blob: { ...file, fileName: 'plain.csv', blobName: 'plain.csv' }
    }
  ];

  it('re-keys wizard maps from the browser file name to the stored blob file name', () => {
    const delimiters = { 'Harvard Forest 2014.csv': ',', 'plain.csv': '\t' };

    expect(rekeyByStoredFileName(delimiters, uploadedFiles)).toEqual({
      'Harvard_Forest_2014.csv': ',',
      'plain.csv': '\t'
    });
  });

  it('drops entries for files that were never uploaded rather than sending unknown names', () => {
    const mappings = { 'Harvard Forest 2014.csv': { version: 1 }, 'removed-by-user.csv': { version: 1 } };

    expect(rekeyByStoredFileName(mappings, uploadedFiles)).toEqual({ 'Harvard_Forest_2014.csv': { version: 1 } });
  });

  it('returns an empty map when nothing was uploaded', () => {
    expect(rekeyByStoredFileName({ 'Harvard Forest 2014.csv': ',' }, [])).toEqual({});
  });
});

describe('cleanupUploadedFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('deletes every blob from the authorized storage scope', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await cleanupUploadedFiles([file], { schema: 'forestgeo_testing', plotID: 1, plotCensusNumber: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/files/delete?');
    expect(String(url)).toContain('filename=measurements_1.csv');
    expect(String(url)).toContain('container=forestgeo-testing-plot1-census2');
    expect(init).toEqual({ method: 'DELETE' });
  });

  it('logs cleanup failures without masking the original upload error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );

    await expect(cleanupUploadedFiles([file], { schema: 'forestgeo_testing', plotID: 1, plotCensusNumber: 2 })).resolves.toBeUndefined();
    expect(ailogger.warn).toHaveBeenCalled();
  });
});
