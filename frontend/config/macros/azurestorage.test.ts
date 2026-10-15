import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertBlobStorageReady, getBlobServiceClient } from './azurestorage';

describe('blob storage readiness', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails locally when configuration is absent without exposing configuration values', () => {
    vi.stubEnv('AZURE_STORAGE_CONNECTION_STRING', '');
    expect(() => assertBlobStorageReady()).toThrow('AZURE_STORAGE_CONNECTION_STRING environment variable is not set');
  });

  it('rejects malformed configuration with a stable sanitized error', () => {
    vi.stubEnv('AZURE_STORAGE_CONNECTION_STRING', 'AccountName=private-account;AccountKey=private-secret');
    expect(() => getBlobServiceClient()).toThrow(/malformed/);
    try {
      getBlobServiceClient();
    } catch (error) {
      expect((error as Error).message).not.toContain('private-secret');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
