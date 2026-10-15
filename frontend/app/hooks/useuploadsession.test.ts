import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadSession } from './useuploadsession';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('useUploadSession', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears the active session ref before unmount cleanup fires', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        session: {
          sessionId: 'session-1',
          state: 'initialized',
          uploadedChunks: 0,
          processedBatches: 0,
          totalBatches: 0
        }
      })
    });
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { result, unmount } = renderHook(() =>
      useUploadSession({
        schema: 'forestgeo_testing',
        plotId: 1,
        censusId: 2
      })
    );

    await act(async () => {
      await result.current.createSession('census2.csv', 1, 'attempt-hash');
    });

    const getCurrentSessionId = result.current.getCurrentSessionId;
    expect(getCurrentSessionId()).toBe('session-1');

    unmount();

    expect(getCurrentSessionId()).toBe(null);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/uploadsession?schema=forestgeo_testing&sessionId=session-1&cleanup=true',
      expect.objectContaining({
        method: 'DELETE',
        keepalive: true
      })
    );
  });

  it('clears the active session ref immediately when heartbeat returns 404', async () => {
    const onSessionExpired = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        session: {
          sessionId: 'session-404',
          state: 'initialized',
          uploadedChunks: 0,
          processedBatches: 0,
          totalBatches: 0
        }
      })
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404
    });

    const { result } = renderHook(() =>
      useUploadSession({
        schema: 'forestgeo_testing',
        plotId: 1,
        censusId: 2,
        onSessionExpired
      })
    );

    await act(async () => {
      await result.current.createSession('census2.csv', 1, 'attempt-hash');
    });

    expect(result.current.getCurrentSessionId()).toBe('session-404');

    await act(async () => {
      const heartbeatSucceeded = await result.current.sendManualHeartbeat();
      expect(heartbeatSucceeded).toBe(false);
    });

    expect(result.current.getCurrentSessionId()).toBe(null);
    expect(result.current.session.sessionId).toBe(null);
    expect(result.current.session.isActive).toBe(false);
    expect(result.current.session.error).toBe('Session expired');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});
