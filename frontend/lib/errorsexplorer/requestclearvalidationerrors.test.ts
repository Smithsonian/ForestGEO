import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEAR_MEASUREMENT_ERRORS_CODES, CLEAR_VALIDATION_ERRORS_ENDPOINT } from '@/config/errorsexplorer';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE } from '@/lib/db/transactionerrors';
import { requestClearValidationErrors } from './requestclearvalidationerrors';

const REQUEST = { schema: 'forestgeo_testing', plotID: 1, censusID: 6, measurementID: 42 };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('requestClearValidationErrors (P3-3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the row mutation scope once and reports cleared', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ clearedErrorCount: 2 }, 200));
    const outcome = await requestClearValidationErrors(REQUEST);
    console.log('[view-errors clear transport]', JSON.stringify(outcome), JSON.stringify(fetchMock.mock.calls[0]));
    expect(outcome).toEqual({ status: 'cleared', clearedErrorCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(CLEAR_VALIDATION_ERRORS_ENDPOINT);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual(REQUEST);
  });

  it.each([
    ['a rejected fetch', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
    ['an unreadable 2xx body', () => fetchMock.mockResolvedValueOnce(jsonResponse('not json', 200))],
    ['a 2xx body of the wrong shape', () => fetchMock.mockResolvedValueOnce(jsonResponse({ cleared: true }, 200))],
    ['the unknown-commit code', () => fetchMock.mockResolvedValueOnce(jsonResponse({ code: TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE }, 500))]
  ])('reports %s as unconfirmed and sends one request', async (_label, arrange) => {
    arrange();
    expect(await requestClearValidationErrors(REQUEST)).toEqual({ status: 'unconfirmed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [500, { code: CLEAR_MEASUREMENT_ERRORS_CODES.failed }, CLEAR_MEASUREMENT_ERRORS_CODES.failed],
    [409, { code: CLEAR_MEASUREMENT_ERRORS_CODES.failedRow }, CLEAR_MEASUREMENT_ERRORS_CODES.failedRow],
    [403, 'not json', null]
  ])('reports a %d as failed with its code', async (status, body, code) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
    expect(await requestClearValidationErrors(REQUEST)).toEqual({ status: 'failed', httpStatus: status, code });
  });

  it('reports 409 NOTHING_TO_CLEAR as failed with that code, so the page can say nothing changed (r3, R2)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear }, 409));
    const outcome = await requestClearValidationErrors(REQUEST);
    console.log('[view-errors clear transport nothing to clear]', JSON.stringify(outcome));
    expect(outcome).toEqual({ status: 'failed', httpStatus: 409, code: CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear });
    expect(fetchMock, 'never retried').toHaveBeenCalledTimes(1);
  });
});
