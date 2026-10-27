import { describe, expect, it } from 'vitest';

import {
  buildErrorsExplorerMessageHref,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERRORS_EXPLORER_MESSAGE_PARAM,
  ERRORS_EXPLORER_VIEW_ALL,
  ERRORS_EXPLORER_VIEW_ALL_HREF,
  ERRORS_EXPLORER_VIEW_PARAM,
  ERRORS_PAGE_PATH,
  INGESTION_ERROR_FIELD_MAP,
  resolveErrorsExplorerDeepLinkFilters
} from './errorsexplorer';

describe('INGESTION_ERROR_FIELD_MAP', () => {
  it('maps UNCLASSIFIED_REJECT to no fields, same as the other fieldless system codes', () => {
    expect(INGESTION_ERROR_FIELD_MAP.UNCLASSIFIED_REJECT).toEqual([]);
    expect(INGESTION_ERROR_FIELD_MAP.INTERRUPTED_UPLOAD).toEqual([]);
  });

  it('routes INVALID_COORDINATE to both local and plot coordinate fields, since a storage-range reject can come from either pair', () => {
    expect(INGESTION_ERROR_FIELD_MAP.INVALID_COORDINATE).toEqual(['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY']);
  });

  // The point of classifying these shapes at all is that the explorer can
  // highlight the offending cell. A code with no entry here is no more useful
  // to a researcher than the UNCLASSIFIED_REJECT it replaced.
  it('points every parser-reject code at the cell the researcher has to fix', () => {
    expect(INGESTION_ERROR_FIELD_MAP.NON_NUMERIC_DBH).toEqual(['measuredDBH']);
    expect(INGESTION_ERROR_FIELD_MAP.NON_NUMERIC_HOM).toEqual(['measuredHOM']);
    expect(INGESTION_ERROR_FIELD_MAP.NON_NUMERIC_COORDINATE).toEqual(['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY']);
    expect(INGESTION_ERROR_FIELD_MAP.INVALID_DATE).toEqual(['measurementDate']);
    expect(INGESTION_ERROR_FIELD_MAP.MALFORMED_ROW).toEqual(['treeTag', 'stemTag']);
  });

  it('keeps the retired MISSING_FIELD_COORDINATES entry so pre-split rows still highlight their coordinates', () => {
    expect(INGESTION_ERROR_FIELD_MAP.MISSING_FIELD_COORDINATES).toEqual(['stemLocalX', 'stemLocalY']);
    expect(INGESTION_ERROR_FIELD_MAP.MISSING_FIELD_LOCALX).toEqual(['stemLocalX']);
    expect(INGESTION_ERROR_FIELD_MAP.MISSING_FIELD_LOCALY).toEqual(['stemLocalY']);
  });
});

describe('View Errors deep-link contract (#547)', () => {
  const URL_BASE = 'http://localhost';
  const AWKWARD_MESSAGE = 'DBH & HOM / 50% growth + shrink check';

  it('encodes a message so it round-trips exactly', () => {
    const href = buildErrorsExplorerMessageHref(AWKWARD_MESSAGE);
    const parsed = new URL(href, URL_BASE);
    console.log(`[#547 deep link] ${href}`);
    expect(parsed.pathname).toBe(ERRORS_PAGE_PATH);
    expect(parsed.searchParams.get(ERRORS_EXPLORER_MESSAGE_PARAM)).toBe(AWKWARD_MESSAGE);
    expect(href.includes('&'), 'a raw & would split the parameter').toBe(false);
  });

  it('links "view all" to the explicit reset parameter', () => {
    expect(ERRORS_EXPLORER_VIEW_ALL_HREF).toBe(`${ERRORS_PAGE_PATH}?${ERRORS_EXPLORER_VIEW_PARAM}=${ERRORS_EXPLORER_VIEW_ALL}`);
  });

  it('filters to exactly one message, clearing the preset like a manual message pick', () => {
    const filters = resolveErrorsExplorerDeepLinkFilters(new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: AWKWARD_MESSAGE }));
    expect(filters).toEqual({ ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [AWKWARD_MESSAGE], presetId: undefined });
  });

  it('prefers message when both parameters are present', () => {
    const filters = resolveErrorsExplorerDeepLinkFilters(
      new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: AWKWARD_MESSAGE, [ERRORS_EXPLORER_VIEW_PARAM]: ERRORS_EXPLORER_VIEW_ALL })
    );
    expect(filters?.exactMessages).toEqual([AWKWARD_MESSAGE]);
  });

  it('resets to a fresh copy of the defaults for view=all', () => {
    const filters = resolveErrorsExplorerDeepLinkFilters(new URLSearchParams({ [ERRORS_EXPLORER_VIEW_PARAM]: ERRORS_EXPLORER_VIEW_ALL }));
    expect(filters).toEqual(DEFAULT_ERROR_EXPLORER_FILTERS);
    expect(filters, 'callers must not be able to mutate the shared defaults').not.toBe(DEFAULT_ERROR_EXPLORER_FILTERS);
  });

  it.each([
    ['no parameters', new URLSearchParams()],
    ['no search params at all (outside the app router)', null],
    ['a whitespace-only message', new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: '   ' })],
    ['an unknown view', new URLSearchParams({ [ERRORS_EXPLORER_VIEW_PARAM]: 'some' })]
  ])('treats %s as a plain visit', (_label, searchParams) => {
    expect(resolveErrorsExplorerDeepLinkFilters(searchParams)).toBeNull();
  });
});
