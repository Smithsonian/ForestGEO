import { describe, expect, it } from 'vitest';
import { parseExplorerRequest } from '@/lib/errorsexplorer/explorerrequest';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import { CHANGE_EXPORT_ERROR_CODES, DEFAULT_RECENT_CHANGES_FILTERS, type RecentChangesServerFilters } from '@/config/recentchangesexplorer';
import {
  CHANGE_QUICK_SEARCH_MAX_LENGTH,
  CHANGE_TABLE_NAME_MAX_LENGTH,
  INVALID_CHANGE_EXPORT_REQUEST_RESPONSE,
  LATEST_FILTER_DATE_YEAR,
  changeExportRequestSchema,
  isCalendarDate,
  recentChangesQueryRequestSchema,
  RECENT_CHANGES_DEFAULT_PAGE_SIZE,
  RECENT_CHANGES_FIRST_PAGE,
  RECENT_CHANGES_MAX_PAGE_SIZE,
  RECENT_CHANGES_MIN_PAGE_SIZE
} from '@/lib/changes/explorerrequest';

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 7;
const DEFAULT_SERVER_FILTERS: RecentChangesServerFilters = {
  operation: DEFAULT_RECENT_CHANGES_FILTERS.operation,
  changedBy: DEFAULT_RECENT_CHANGES_FILTERS.changedBy,
  tableName: DEFAULT_RECENT_CHANGES_FILTERS.tableName,
  quickSearch: DEFAULT_RECENT_CHANGES_FILTERS.quickSearch,
  changedFrom: DEFAULT_RECENT_CHANGES_FILTERS.changedFrom,
  changedTo: DEFAULT_RECENT_CHANGES_FILTERS.changedTo
};

function parseQuery(body: unknown) {
  return parseExplorerRequest(recentChangesQueryRequestSchema, body);
}

function expectRejected(body: unknown, issuePath: string) {
  const result = parseQuery(body);
  expect(result.ok, `the contract must reject ${JSON.stringify(body)}`).toBe(false);
  if (result.ok) return;
  expect(
    result.issues.map(issue => issue.path),
    `issues: ${JSON.stringify(result.issues)}`
  ).toContain(issuePath);
}

function parsedFilters(filters: Record<string, unknown>) {
  const result = parseQuery({ schema: SCHEMA, plotID: PLOT_ID, filters });
  expect(result.ok, `expected a valid request, got ${JSON.stringify(result)}`).toBe(true);
  return result.ok ? result.data.filters : null;
}

describe('recent changes request contract: defaults', () => {
  it('fills every filter and the paging from the defaults when the body has only schema and plotID', () => {
    const result = parseQuery({ schema: SCHEMA, plotID: PLOT_ID });
    expect(result).toEqual({
      ok: true,
      data: { schema: SCHEMA, plotID: PLOT_ID, filters: DEFAULT_SERVER_FILTERS, page: RECENT_CHANGES_FIRST_PAGE, pageSize: RECENT_CHANGES_DEFAULT_PAGE_SIZE }
    });
  });

  it('fills the omitted filter fields when only some are sent', () => {
    expect(parsedFilters({ operation: 'DELETE', changedFrom: '2026-11-01' })).toEqual({
      ...DEFAULT_SERVER_FILTERS,
      operation: 'DELETE',
      changedFrom: '2026-11-01'
    });
  });

  it('accepts presetId and discards it', () => {
    const filters = parsedFilters({ ...DEFAULT_RECENT_CHANGES_FILTERS, presetId: 'deletions' });
    expect(Object.keys(filters ?? {}).sort(), 'no server code reads presetId').toEqual(Object.keys(DEFAULT_SERVER_FILTERS).sort());
  });

  it('accepts plotID sent as a numeric string, as the list route always has', () => {
    const result = parseQuery({ schema: SCHEMA, plotID: String(PLOT_ID) });
    expect(result.ok && result.data.plotID).toBe(PLOT_ID);
  });
});

describe('recent changes request contract: paging keeps today’s clamping', () => {
  it.each([
    { sent: { page: -3, pageSize: 5 }, expected: { page: RECENT_CHANGES_FIRST_PAGE, pageSize: RECENT_CHANGES_MIN_PAGE_SIZE } },
    { sent: { page: 4, pageSize: 1000 }, expected: { page: 4, pageSize: RECENT_CHANGES_MAX_PAGE_SIZE } },
    { sent: { page: null, pageSize: null }, expected: { page: RECENT_CHANGES_FIRST_PAGE, pageSize: RECENT_CHANGES_DEFAULT_PAGE_SIZE } },
    { sent: { page: '2', pageSize: '50' }, expected: { page: 2, pageSize: 50 } }
  ])('page $sent.page / pageSize $sent.pageSize', ({ sent, expected }) => {
    const result = parseQuery({ schema: SCHEMA, plotID: PLOT_ID, ...sent });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect({ page: result.data.page, pageSize: result.data.pageSize }).toEqual(expected);
  });

  it('rejects a page that is not a number instead of sending NaN to SQL', () => {
    const result = parseQuery({ schema: SCHEMA, plotID: PLOT_ID, page: 'first' });
    expect(result.ok).toBe(false);
  });
});

describe('recent changes request contract: rejections', () => {
  it.each([
    { label: 'a fractional plotID', plotID: 1.5 },
    { label: 'a zero plotID', plotID: 0 },
    { label: 'a negative plotID', plotID: -2 },
    { label: 'a missing plotID', plotID: undefined },
    { label: 'a non-numeric plotID', plotID: 'plot-one' }
  ])('rejects $label', ({ plotID }) => {
    expectRejected({ schema: SCHEMA, plotID }, 'plotID');
  });

  it('rejects a schema that is not a site schema', () => {
    expectRejected({ schema: 'information_schema', plotID: PLOT_ID }, 'schema');
  });

  it('rejects an unknown operation', () => {
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { operation: 'TRUNCATE' } }, 'filters.operation');
  });

  it.each([
    { label: 'an object', value: { $ne: '' } },
    { label: 'an array', value: ['a', 'b'] },
    { label: 'a number', value: 5 }
  ])('rejects $label where a filter string belongs', ({ value }) => {
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedBy: value } }, 'filters.changedBy');
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { tableName: value } }, 'filters.tableName');
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { quickSearch: value } }, 'filters.quickSearch');
  });

  it('rejects strings past their bounds and accepts strings exactly at them', () => {
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedBy: 'u'.repeat(CHANGED_BY_MAX_LENGTH + 1) } }, 'filters.changedBy');
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { tableName: 't'.repeat(CHANGE_TABLE_NAME_MAX_LENGTH + 1) } }, 'filters.tableName');
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { quickSearch: 'q'.repeat(CHANGE_QUICK_SEARCH_MAX_LENGTH + 1) } }, 'filters.quickSearch');

    const atBounds = parsedFilters({
      changedBy: 'u'.repeat(CHANGED_BY_MAX_LENGTH),
      tableName: 't'.repeat(CHANGE_TABLE_NAME_MAX_LENGTH),
      quickSearch: 'q'.repeat(CHANGE_QUICK_SEARCH_MAX_LENGTH)
    });
    expect(atBounds?.quickSearch).toHaveLength(CHANGE_QUICK_SEARCH_MAX_LENGTH);
  });

  it('reports issue paths and codes only, never the rejected value', () => {
    const secret = 'do-not-log-this-value';
    const result = parseQuery({ schema: SCHEMA, plotID: PLOT_ID, filters: { operation: secret } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('recent changes request contract: date bounds', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-1-5', '20261105', 'yesterday', '2026-11-05T00:00:00Z'])('rejects %s as a date', value => {
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedFrom: value } }, 'filters.changedFrom');
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedTo: value } }, 'filters.changedTo');
  });

  it('accepts each bound alone, and a leap day', () => {
    expect(parsedFilters({ changedFrom: '2024-02-29' })).toMatchObject({ changedFrom: '2024-02-29', changedTo: '' });
    expect(parsedFilters({ changedTo: '2026-11-05' })).toMatchObject({ changedFrom: '', changedTo: '2026-11-05' });
  });

  it('accepts a one-day range and rejects from after to', () => {
    expect(parsedFilters({ changedFrom: '2026-11-05', changedTo: '2026-11-05' })).toMatchObject({ changedFrom: '2026-11-05', changedTo: '2026-11-05' });
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedFrom: '2026-11-06', changedTo: '2026-11-05' } }, 'filters.changedTo');
  });

  it('accepts the last year whose next day MySQL can add, and rejects the year after it', () => {
    const lastDay = `${LATEST_FILTER_DATE_YEAR}-12-31`;
    const firstRejectedDay = `${LATEST_FILTER_DATE_YEAR + 1}-01-01`;
    expect(parsedFilters({ changedTo: lastDay })).toMatchObject({ changedTo: lastDay });
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedTo: firstRejectedDay } }, 'filters.changedTo');
    expectRejected({ schema: SCHEMA, plotID: PLOT_ID, filters: { changedFrom: firstRejectedDay } }, 'filters.changedFrom');
  });

  it('isCalendarDate agrees with the calendar', () => {
    expect(isCalendarDate('2026-11-30')).toBe(true);
    expect(isCalendarDate('2026-11-31')).toBe(false);
    expect(isCalendarDate('2025-02-29')).toBe(false);
  });
});

describe('change export request contract', () => {
  function parseExport(body: unknown) {
    return parseExplorerRequest(changeExportRequestSchema, body);
  }

  it('shares the scope and filter defaults with the list route and carries no paging', () => {
    expect(parseExport({ schema: SCHEMA, plotID: PLOT_ID, page: 3, pageSize: 50 })).toEqual({
      ok: true,
      data: { schema: SCHEMA, plotID: PLOT_ID, filters: DEFAULT_SERVER_FILTERS }
    });
  });

  it('keeps the filters it is sent, dates included', () => {
    const result = parseExport({ schema: SCHEMA, plotID: PLOT_ID, filters: { tableName: 'trees', changedFrom: '2026-11-01', changedTo: '2026-11-05' } });
    expect(result.ok && result.data.filters).toEqual({ ...DEFAULT_SERVER_FILTERS, tableName: 'trees', changedFrom: '2026-11-01', changedTo: '2026-11-05' });
  });

  it.each([
    { label: 'a non-positive plotID', body: { schema: SCHEMA, plotID: 0 }, issuePath: 'plotID' },
    { label: 'a schema that is not a site schema', body: { schema: 'information_schema', plotID: PLOT_ID }, issuePath: 'schema' },
    {
      label: 'an object where a filter string belongs',
      body: { schema: SCHEMA, plotID: PLOT_ID, filters: { quickSearch: { $ne: '' } } },
      issuePath: 'filters.quickSearch'
    },
    { label: 'an impossible date', body: { schema: SCHEMA, plotID: PLOT_ID, filters: { changedTo: '2026-02-30' } }, issuePath: 'filters.changedTo' },
    {
      label: 'a date past the latest year MySQL can add a day to',
      body: { schema: SCHEMA, plotID: PLOT_ID, filters: { changedTo: `${LATEST_FILTER_DATE_YEAR + 1}-01-01` } },
      issuePath: 'filters.changedTo'
    },
    {
      label: 'from after to',
      body: { schema: SCHEMA, plotID: PLOT_ID, filters: { changedFrom: '2026-11-06', changedTo: '2026-11-05' } },
      issuePath: 'filters.changedTo'
    }
  ])('rejects $label exactly as the list route does', ({ body, issuePath }) => {
    const result = parseExport(body);
    expect(result.ok, `the export contract must reject ${JSON.stringify(body)}`).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(issue => issue.path)).toContain(issuePath);
    expectRejected(body, issuePath);
  });

  it('uses the shared export error code in its rejection body', () => {
    expect(INVALID_CHANGE_EXPORT_REQUEST_RESPONSE).toEqual({ error: 'Invalid export request', code: CHANGE_EXPORT_ERROR_CODES.invalidRequest });
  });
});
