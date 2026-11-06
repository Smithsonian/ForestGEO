import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ERROR_EXPLORER_FILTERS, type ErrorExplorerRow, type ErrorTypeFacet } from '@/config/errorsexplorer';
import { mergeEditedRow, useErrorsExplorerRows } from './useerrorsexplorerrows';

const READ_SCOPE = { schema: 'forestgeo_testing', plotID: 1, censusID: 5, censusIDs: [5, 6] };
const FACET: ErrorTypeFacet = {
  source: 'validation',
  code: '14',
  message: 'Attribute code does not exist in attributes table',
  fields: ['attributes'],
  count: 3,
  hasContradiction: false
};
const ROW = { id: 101, coreMeasurementID: 101, censusID: 6, measuredDBH: 10, attributes: 'A', rawCodes: 'A' } as unknown as ErrorExplorerRow;

describe('useErrorsExplorerRows', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ rows: [ROW], totalRows: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the page read scope, the identity only, and the grid models', async () => {
    const query = {
      filters: DEFAULT_ERROR_EXPLORER_FILTERS,
      errorType: FACET,
      page: 2,
      pageSize: 10,
      sortModel: [{ field: 'measuredDBH' as const, sort: 'desc' as const }],
      columnFilters: []
    };
    const { result } = renderHook(() => useErrorsExplorerRows({ readScope: READ_SCOPE, readScopeKey: 'scope', query, enabled: true, gated: false }));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    console.log('[view-errors rows body]', JSON.stringify(body));
    expect(body).toEqual({
      ...READ_SCOPE,
      page: 2,
      pageSize: 10,
      filters: { source: 'all', exactMessages: [], affectedFields: [], contradictionOnly: false, contradictionTypes: [], quickSearch: '' },
      errorType: { source: FACET.source, code: FACET.code, message: FACET.message },
      sortModel: [{ field: 'measuredDBH', sort: 'desc' }],
      columnFilters: []
    });
  });

  it('merges an edited row into the loaded page', async () => {
    const query = { filters: DEFAULT_ERROR_EXPLORER_FILTERS, page: 0, pageSize: 25, sortModel: [], columnFilters: [] };
    const { result } = renderHook(() => useErrorsExplorerRows({ readScope: READ_SCOPE, readScopeKey: 'scope', query, enabled: true, gated: false }));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.patchRow({ ...ROW, measuredDBH: 12, rawCodes: undefined } as ErrorExplorerRow));
    expect(result.current.rows[0]).toMatchObject({ measuredDBH: 12, rawCodes: 'A' });
  });

  it('surfaces the server error text and fetches nothing when disabled', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unable to load errors', code: 'ERRORS_EXPLORER_QUERY_FAILED' }), { status: 500 }));
    const query = { filters: DEFAULT_ERROR_EXPLORER_FILTERS, page: 0, pageSize: 25, sortModel: [], columnFilters: [] };
    const { result } = renderHook(() => useErrorsExplorerRows({ readScope: READ_SCOPE, readScopeKey: 'scope', query, enabled: true, gated: false }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('Unable to load errors');
    fetchMock.mockClear();
    renderHook(() => useErrorsExplorerRows({ readScope: READ_SCOPE, readScopeKey: 'scope', query, enabled: false, gated: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mergeEditedRow', () => {
  const PRIOR_DBH = 10;
  const SHOWN_DBH = 12;
  const EDITED_DBH = 15;
  const CHANGE_FOR_SHOWN_DBH = 20;
  const CHANGE_FOR_EDITED_DBH = 50;
  const OTHER_GROUPS_MESSAGE = 'Different species';

  it("recomputes Change from the edited DBH and the row's own prior DBH", () => {
    const shown = { ...ROW, measuredDBH: SHOWN_DBH, priorDBH: PRIOR_DBH, dbhChangePercent: CHANGE_FOR_SHOWN_DBH } as unknown as ErrorExplorerRow;
    const merged = mergeEditedRow(shown, { ...shown, measuredDBH: EDITED_DBH });
    console.log('[view-errors merge change]', JSON.stringify({ measuredDBH: merged.measuredDBH, priorDBH: merged.priorDBH, change: merged.dbhChangePercent }));
    expect(merged).toMatchObject({ measuredDBH: EDITED_DBH, priorDBH: PRIOR_DBH, dbhChangePercent: CHANGE_FOR_EDITED_DBH });
  });

  it("keeps the other group's error-type values when the edited copy comes from a different group", () => {
    const shown = {
      ...ROW,
      measuredDBH: SHOWN_DBH,
      priorDBH: PRIOR_DBH,
      dbhChangePercent: CHANGE_FOR_SHOWN_DBH,
      errorMessages: ['DBH growth exceeds maximum rate of 65 mm']
    } as unknown as ErrorExplorerRow;
    const editedElsewhere = {
      ...shown,
      treeTag: 'T-NEW',
      priorDBH: null,
      dbhChangePercent: null,
      errorMessages: [OTHER_GROUPS_MESSAGE]
    } as unknown as ErrorExplorerRow;
    const merged = mergeEditedRow(shown, editedElsewhere);
    expect(merged).toMatchObject({ treeTag: 'T-NEW', priorDBH: PRIOR_DBH, dbhChangePercent: CHANGE_FOR_SHOWN_DBH, errorMessages: shown.errorMessages });
  });
});
