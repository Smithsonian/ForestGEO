import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}));

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-1'),
    executeQuery: vi.fn(async () => []),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

describe('GET /api/validations/validationerrordisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to measurement_errors details when sitespecificvalidations row is missing', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([
      {
        CoreMeasurementID: 1048722,
        ValidationErrorIDs: '20',
        Descriptions: 'Species mismatch from previous census',
        Criteria: 'Validation 20'
      }
    ]);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const request = {
      nextUrl: new URL('http://localhost:3000/api/validations/validationerrordisplay?schema=myschema&plotIDParam=22&censusPCNParam=4')
    };
    const response = await GET(request as any);

    expect(response.status).toBe(HTTPResponses.OK);
    await expect(response.json()).resolves.toEqual({
      failed: [
        {
          coreMeasurementID: 1048722,
          validationErrorIDs: [20],
          descriptions: ['Species mismatch from previous census'],
          criteria: ['Validation 20']
        }
      ]
    });

    const sql = exec.mock.calls[0][0] as string;
    expect(sql).toMatch(/LEFT JOIN\s+myschema\.sitespecificvalidations AS ve/i);
    expect(sql).toMatch(/COALESCE\(NULLIF\(ve\.Description, ''\), me\.ErrorMessage\)/);
    expect(sql).toMatch(/COALESCE\(NULLIF\(ve\.Criteria, ''\), CONCAT\('Validation ', me\.ErrorCode\)\)/);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rolls back and returns 500 when the query fails', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
    vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('query failed'));
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const request = {
      nextUrl: new URL('http://localhost:3000/api/validations/validationerrordisplay?schema=myschema&plotIDParam=22&censusPCNParam=4')
    };
    const response = await GET(request as any);

    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    await expect(response.json()).resolves.toEqual({ error: 'query failed' });
    expect(rollback).toHaveBeenCalledWith('tx-2');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
