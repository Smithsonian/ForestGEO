import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fromConnectionString } = vi.hoisted(() => ({ fromConnectionString: vi.fn() }));

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString },
  BlobUploadCommonResponse: class {},
  ContainerClient: class {}
}));

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: logger }));

import { BlobServiceClient } from '@azure/storage-blob';
import { assertBlobStorageReady } from './azurestorage';

describe('assertBlobStorageReady', () => {
  const originalConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  });

  afterEach(() => {
    if (originalConnectionString === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    else process.env.AZURE_STORAGE_CONNECTION_STRING = originalConnectionString;
  });

  it('rejects missing configuration before constructing an SDK client', () => {
    expect(() => assertBlobStorageReady()).toThrow('AZURE_STORAGE_CONNECTION_STRING environment variable is not set');
    expect(fromConnectionString).not.toHaveBeenCalled();
  });

  it('rejects malformed connection strings before constructing an SDK client', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=only-name;';
    expect(() => assertBlobStorageReady()).toThrow(/appears to be invalid/);
    expect(fromConnectionString).not.toHaveBeenCalled();
  });

  it('does not expose SDK constructor errors, causes, logs, or fake credentials', () => {
    const fakeCredential = 'fake-secret-key-not-for-logs';
    process.env.AZURE_STORAGE_CONNECTION_STRING = `DefaultEndpointsProtocol=https;AccountName=fake;AccountKey=${fakeCredential};EndpointSuffix=core.windows.net`;
    fromConnectionString.mockImplementationOnce(() => {
      throw new Error(`SDK parse error included ${fakeCredential}`);
    });

    let thrown: unknown;
    try {
      assertBlobStorageReady();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AZURE_STORAGE_CONNECTION_STRING is malformed');
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(logger)).not.toContain(fakeCredential);
    expect(logger.error).not.toHaveBeenCalled();
    expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledOnce();
  });

  it('revalidates after configuration is corrected without probing containers or the network', () => {
    const getContainerClient = vi.fn();
    fromConnectionString.mockReturnValueOnce({ getContainerClient });

    expect(() => assertBlobStorageReady()).toThrow(/not set/);
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=fake;AccountKey=fake-key;EndpointSuffix=core.windows.net';
    expect(() => assertBlobStorageReady()).not.toThrow();

    expect(fromConnectionString).toHaveBeenCalledOnce();
    expect(getContainerClient).not.toHaveBeenCalled();
  });
});
