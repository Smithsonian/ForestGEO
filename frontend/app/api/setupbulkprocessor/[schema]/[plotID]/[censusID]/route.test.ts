import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

const { loggerInfo, loggerWarn, loggerError, loggerDebug } = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn()
}));

vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const instance = { executeQuery };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/config/utils/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: loggerDebug
  }
}));

function makeRequest() {
  const url = new URL('http://localhost/api/setupbulkprocessor/forestgeo_testing/22/6');
  const req = new Request(url.toString(), { method: 'GET' }) as any;
  req.nextUrl = url;
  return req;
}

function makeProps() {
  return {
    params: Promise.resolve({
      schema: 'forestgeo_testing',
      plotID: '22',
      censusID: '6'
    })
  } as any;
}

describe('GET /api/setupbulkprocessor/[schema]/[plotID]/[censusID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only the latest batch per file from temporarymeasurements', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.executeQuery.mockResolvedValueOnce([
      {
        FileID: 'SERC_census4_2025(1).csv',
        BatchID: 'latest-batch',
        fileBatchCount: 2
      },
      {
        FileID: 'SERC_census4_failures.csv',
        BatchID: 'only-batch',
        fileBatchCount: 1
      }
    ]);

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { fileID: 'SERC_census4_2025(1).csv', batchID: 'latest-batch' },
      { fileID: 'SERC_census4_failures.csv', batchID: 'only-batch' }
    ]);

    const [sql, params] = cm.executeQuery.mock.calls[0];
    expect(String(sql)).toContain('ROW_NUMBER() OVER (PARTITION BY FileID');
    expect(String(sql)).toContain('COUNT(*) OVER (PARTITION BY FileID)');
    expect(params).toEqual(['22', '6']);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('Multiple temporarymeasurement batches detected for file SERC_census4_2025(1).csv'));
  });
});
