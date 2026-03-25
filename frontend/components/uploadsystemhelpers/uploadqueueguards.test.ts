import { describe, expect, it, vi } from 'vitest';
import { abortChunkProcessingAfterPermanentUploadFailure, shouldTimeoutPausedParser } from './uploadqueueguards';

describe('upload queue guards', () => {
  it('marks fatal upload errors and aborts parsing for permanent chunk failures', () => {
    const clearQueue = vi.fn();
    const abortParser = vi.fn();
    const fatalError = new Error('Server error 500');
    const markFatalUploadError = vi.fn(() => fatalError);

    const result = abortChunkProcessingAfterPermanentUploadFailure(new Error('Lock wait timeout exceeded'), {
      clearQueue,
      abortParser,
      markFatalUploadError
    });

    expect(result).toBe(fatalError);
    expect(markFatalUploadError).toHaveBeenCalledTimes(1);
    expect(clearQueue).toHaveBeenCalledTimes(1);
    expect(abortParser).toHaveBeenCalledTimes(1);
  });

  it('does not time out a paused parser while uploads are still active', () => {
    expect(shouldTimeoutPausedParser(2, 2, 1, 600000, 300000)).toBe(false);
    expect(shouldTimeoutPausedParser(2, 2, 0, 600000, 300000)).toBe(true);
  });
});
