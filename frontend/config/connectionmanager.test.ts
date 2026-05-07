import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnMock, runQueryMock, loggerMock } = vi.hoisted(() => ({
  getConnMock: vi.fn(),
  runQueryMock: vi.fn(),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@/components/processors/processormacros', () => ({
  getConn: getConnMock,
  runQuery: runQueryMock
}));

vi.mock('@/lib/connectionlogger', () => ({
  patchConnectionManager: vi.fn(),
  flushTransactionChangelog: vi.fn(),
  discardTransactionChangelog: vi.fn()
}));

vi.mock('@/ailogger', () => ({
  default: loggerMock
}));

vi.mock('chalk', () => ({
  default: {
    red: (value: unknown) => String(value),
    yellow: (value: unknown) => String(value),
    green: (value: unknown) => String(value),
    blue: (value: unknown) => String(value)
  }
}));

describe('ConnectionManager.executeQuery timing', () => {
  const originalThreshold = process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalThreshold === undefined) {
      delete process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS;
    } else {
      process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS = originalThreshold;
    }
  });

  it('measures acquisition, schema switch, query, and total duration for pool queries', async () => {
    const query = 'SELECT * FROM forestgeo_testing.trees WHERE TreeID = ?';
    const connection = {
      query: vi.fn().mockResolvedValue([[]]),
      release: vi.fn(),
      ping: vi.fn()
    };

    getConnMock.mockResolvedValueOnce(connection);
    runQueryMock.mockResolvedValueOnce([{ TreeID: 1 }]);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(15)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(27)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(60);

    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const result = await ConnectionManager.getInstance().executeQuery(query, [1]);

    expect(result).toEqual([{ TreeID: 1 }]);
    expect(connection.query).toHaveBeenCalledWith('USE `forestgeo_testing`');
    expect(runQueryMock).toHaveBeenCalledWith(connection, query, [1]);
    expect(connection.ping).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith(
      'ConnectionManager.executeQuery timing',
      expect.objectContaining({
        schema: 'forestgeo_testing',
        acquireMs: 10,
        schemaUseMs: 7,
        queryMs: 20,
        totalMs: 60,
        failed: false,
        queryPreview: query
      })
    );
  });
});
