import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { CHANGE_EXPORT_ERROR_CODES, DEFAULT_RECENT_CHANGES_FILTERS, MAX_EXPORT_ROWS } from '@/config/recentchangesexplorer';
import { changeExportFailureMessage, CHANGE_EXPORT_FAILURE_MESSAGES, ChangeExportRequestError, postRecentChangesExport } from '@/lib/changes/explorertransport';

const SCOPE = { schema: 'forestgeo_testing', plotID: 7 };
const CSV_BODY = 'LogID,ChangedBy\r\n1,mason@si.edu';
const SERVER_FILENAME = 'changelog-forestgeo_testing-plot7-2026-11-22.csv';

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function exportFailure(response: Response): Promise<ChangeExportRequestError> {
  stubFetch(response);
  const failure = await postRecentChangesExport(SCOPE, DEFAULT_RECENT_CHANGES_FILTERS, new AbortController().signal).catch((error: unknown) => error);
  expect(failure, `expected a ChangeExportRequestError, got ${String(failure)}`).toBeInstanceOf(ChangeExportRequestError);
  return failure as ChangeExportRequestError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postRecentChangesExport', () => {
  it('posts the scope and the filters, dates included, and returns the blob under the server’s filename', async () => {
    const fetchMock = stubFetch(
      new Response(CSV_BODY, { status: HTTPResponses.OK, headers: { 'Content-Disposition': `attachment; filename="${SERVER_FILENAME}"` } })
    );
    const filters = { ...DEFAULT_RECENT_CHANGES_FILTERS, tableName: 'trees', changedFrom: '2026-11-01', changedTo: '2026-11-05' };
    const controller = new AbortController();

    const result = await postRecentChangesExport(SCOPE, filters, controller.signal);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/changes/explorer/export');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type'), 'the body is JSON').toBe('application/json');
    expect(init?.signal, 'the caller’s signal aborts the request').toBe(controller.signal);
    expect(JSON.parse(String(init?.body))).toEqual({ ...SCOPE, filters });
    expect(result.filename).toBe(SERVER_FILENAME);
    expect(result.blob.size, 'the CSV bytes').toBe(new TextEncoder().encode(CSV_BODY).length);
  });

  it('falls back to changelog.csv when the response names no file', async () => {
    stubFetch(new Response(CSV_BODY, { status: HTTPResponses.OK }));
    const result = await postRecentChangesExport(SCOPE, DEFAULT_RECENT_CHANGES_FILTERS, new AbortController().signal);
    expect(result.filename).toBe('changelog.csv');
  });

  it('carries the status and the code of a coded rejection', async () => {
    const failure = await exportFailure(
      Response.json({ error: 'The export is larger than the row limit', code: CHANGE_EXPORT_ERROR_CODES.tooLarge }, { status: HTTPResponses.PAYLOAD_TOO_LARGE })
    );
    expect([failure.status, failure.code]).toEqual([HTTPResponses.PAYLOAD_TOO_LARGE, CHANGE_EXPORT_ERROR_CODES.tooLarge]);
    expect(failure.message, 'server text is not carried into the message').not.toContain('larger than the row limit');
  });

  it('carries the status alone when the rejection has no code', async () => {
    const failure = await exportFailure(Response.json({ error: 'permissions unavailable' }, { status: HTTPResponses.SERVICE_UNAVAILABLE }));
    expect([failure.status, failure.code]).toEqual([HTTPResponses.SERVICE_UNAVAILABLE, undefined]);
  });

  it('tolerates an error body that is not JSON', async () => {
    const failure = await exportFailure(new Response('<html>Bad Gateway</html>', { status: HTTPResponses.INTERNAL_SERVER_ERROR }));
    expect([failure.status, failure.code]).toEqual([HTTPResponses.INTERNAL_SERVER_ERROR, undefined]);
  });
});

describe('changeExportFailureMessage', () => {
  it.each([
    {
      label: 'EXPORT_TOO_LARGE',
      failure: { status: HTTPResponses.PAYLOAD_TOO_LARGE, code: CHANGE_EXPORT_ERROR_CODES.tooLarge },
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge
    },
    { label: '403 with no code', failure: { status: HTTPResponses.FORBIDDEN, code: undefined }, expected: CHANGE_EXPORT_FAILURE_MESSAGES.forbidden },
    {
      label: '503 with no code',
      failure: { status: HTTPResponses.SERVICE_UNAVAILABLE, code: undefined },
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.unavailable
    },
    {
      label: '503 SCHEMA_QUARANTINED',
      failure: { status: HTTPResponses.SERVICE_UNAVAILABLE, code: 'SCHEMA_QUARANTINED' },
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.unavailable
    },
    {
      label: '400 INVALID_EXPORT_REQUEST',
      failure: { status: HTTPResponses.INVALID_REQUEST, code: CHANGE_EXPORT_ERROR_CODES.invalidRequest },
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.invalidRequest
    },
    {
      label: '400 INVALID_SCHEMA from the authz wrapper',
      failure: { status: HTTPResponses.INVALID_REQUEST, code: 'INVALID_SCHEMA' },
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.invalidRequest
    },
    {
      label: '500 CHANGE_EXPORT_FAILED',
      failure: { status: HTTPResponses.INTERNAL_SERVER_ERROR, code: CHANGE_EXPORT_ERROR_CODES.failed },
      expected: CHANGE_EXPORT_FAILURE_MESSAGES.generic
    },
    { label: '401 with no code', failure: { status: HTTPResponses.UNAUTHORIZED, code: undefined }, expected: CHANGE_EXPORT_FAILURE_MESSAGES.generic }
  ])('$label', ({ failure, expected }) => {
    expect(changeExportFailureMessage(failure)).toBe(expected);
  });

  it('names the row limit and both ways to narrow the export', () => {
    expect(CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge).toContain(MAX_EXPORT_ROWS.toLocaleString('en-US'));
    expect(CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge).toMatch(/date range/);
    expect(CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge).toMatch(/table/);
  });
});
