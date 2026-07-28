import { afterEach, describe, expect, it, vi } from 'vitest';
import ailogger from '@/ailogger';
import { cleanupUploadedFiles, type BlobUploadResult } from './uploadasyncjob';

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
