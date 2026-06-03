import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPoolMonitorInstanceMock, poolMonitorMock, loggerMock } = vi.hoisted(() => ({
  getPoolMonitorInstanceMock: vi.fn(),
  poolMonitorMock: {
    getConnection: vi.fn(),
    signalActivity: vi.fn()
  },
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: getPoolMonitorInstanceMock
}));

vi.mock('@/ailogger', () => ({
  default: loggerMock
}));

describe('db primitives connection acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPoolMonitorInstanceMock.mockReturnValue(poolMonitorMock);
  });

  it('does not ping every acquired connection before returning it', async () => {
    const connection = {
      ping: vi.fn(),
      release: vi.fn()
    };
    poolMonitorMock.getConnection.mockResolvedValueOnce(connection);

    const { getConn } = await import('@/lib/db/primitives');
    const result = await getConn();

    expect(result).toBe(connection);
    expect(poolMonitorMock.getConnection).toHaveBeenCalledTimes(1);
    expect(connection.ping).not.toHaveBeenCalled();
  });
});
