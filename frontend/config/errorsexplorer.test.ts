import { describe, expect, it } from 'vitest';

import {
  buildErrorsExplorerMessageHref,
  canClearValidationErrors,
  computeDbhChangePercent,
  DBH_CHANGE_VALIDATION_CODES,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_SOURCE,
  ERRORS_EXPLORER_MESSAGE_PARAM,
  ERRORS_EXPLORER_VIEW_ALL,
  ERRORS_EXPLORER_VIEW_ALL_HREF,
  ERRORS_EXPLORER_VIEW_PARAM,
  ERRORS_PAGE_PATH,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  formatDbhChange,
  formatErrorTypeLabel,
  INGESTION_ERROR_FIELD_MAP,
  isMarkedInvalidWithoutLoggedError,
  MARKED_INVALID_NO_ERROR_LOGGED_LABEL,
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

const SEMICOLON_JOINED_MESSAGES: ReadonlyArray<[string, string]> = [
  ['Flagged;Different species', 'Different species'],
  ['Flagged;Flagged;Different quadrats', 'Different quadrats'],
  ['Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census', 'Duplicate tree and stem tag in census'],
  ['Invalid DBH;Invalid HOM;DEAD-state attribute(s)', 'Measured, but coded dead'],
  ['Missing DBH;Missing HOM;LIVE-state attribute(s)', 'Not measured, but coded alive']
];

describe('formatErrorTypeLabel (D-f)', () => {
  it.each(SEMICOLON_JOINED_MESSAGES)('labels the stored message %j as %j', (stored, label) => {
    console.log('[view-errors labels]', JSON.stringify({ stored, label: formatErrorTypeLabel(stored) }));
    expect(formatErrorTypeLabel(stored)).toBe(label);
  });

  it('labels the fallback message "Marked invalid, no error logged" (D-h)', () => {
    expect(formatErrorTypeLabel(FALLBACK_ERROR_MESSAGE)).toBe(MARKED_INVALID_NO_ERROR_LOGGED_LABEL);
    expect(MARKED_INVALID_NO_ERROR_LOGGED_LABEL).toBe('Marked invalid, no error logged');
  });

  it('returns an unmapped message unchanged, including names that live on Object.prototype', () => {
    for (const message of ['Species Code is invalid (not defined in species table)', 'constructor', '__proto__', 'toString']) {
      expect(formatErrorTypeLabel(message), message).toBe(message);
    }
  });

  it('keeps the fallback constants free of quote characters, because _shared.ts inlines them into SQL', () => {
    expect(FALLBACK_ERROR_CODE).not.toMatch(/['"\\]/);
    expect(FALLBACK_ERROR_MESSAGE).not.toMatch(/['"\\]/);
  });
});

describe('isMarkedInvalidWithoutLoggedError (D-h)', () => {
  it('is true for exactly one ingestion occurrence with the fallback code', () => {
    expect(isMarkedInvalidWithoutLoggedError([{ source: ERROR_SOURCE.ingestion, code: FALLBACK_ERROR_CODE }])).toBe(true);
  });

  it.each([
    ['no occurrences', []],
    ['a real ingestion code', [{ source: ERROR_SOURCE.ingestion, code: 'INVALID_SPECIES' }]],
    ['the fallback code under validation', [{ source: ERROR_SOURCE.validation, code: FALLBACK_ERROR_CODE }]],
    [
      'the fallback plus another occurrence',
      [
        { source: ERROR_SOURCE.ingestion, code: FALLBACK_ERROR_CODE },
        { source: ERROR_SOURCE.validation, code: '14' }
      ]
    ]
  ] as const)('is false for %s', (_label, errors) => {
    expect(isMarkedInvalidWithoutLoggedError(errors)).toBe(false);
  });
});

describe('canClearValidationErrors (shared panel rule)', () => {
  it.each([
    [{ isLinkedToStem: true, hasUnresolvedValidationError: true, markedInvalidWithoutLoggedError: false }, true],
    [{ isLinkedToStem: true, hasUnresolvedValidationError: false, markedInvalidWithoutLoggedError: true }, true],
    [{ isLinkedToStem: true, hasUnresolvedValidationError: false, markedInvalidWithoutLoggedError: false }, false],
    [{ isLinkedToStem: false, hasUnresolvedValidationError: true, markedInvalidWithoutLoggedError: false }, false],
    [{ isLinkedToStem: false, hasUnresolvedValidationError: false, markedInvalidWithoutLoggedError: true }, false]
  ])('%j → %s', (eligibility, expected) => {
    expect(canClearValidationErrors(eligibility)).toBe(expected);
  });
});

describe('computeDbhChangePercent', () => {
  it.each([
    [100, 123.4, 23.4],
    ['100.000000', '96.000000', -4],
    [100, 120.04, 20],
    [100, 120.06, 20.1],
    [null, 120, null],
    [100, undefined, null],
    [0, 12, null],
    ['', 12, null],
    ['not a number', 12, null]
  ])('prior %j, now %j → %j', (prior, now, expected) => {
    const actual = computeDbhChangePercent(prior, now);
    console.log('[view-errors dbh change]', JSON.stringify({ prior, now, actual }));
    expect(actual).toBe(expected);
  });
});

describe('formatDbhChange', () => {
  it.each([
    [23.4, '+23.4%'],
    [-4, '−4.0%'],
    [0, '0.0%'],
    [null, ''],
    [undefined, '']
  ])('%j → %j', (percent, expected) => {
    expect(formatDbhChange(percent)).toBe(expected);
  });
});

describe('DBH-change codes', () => {
  it('keeps the DBH-change codes in config, where the client can read them', () => {
    expect(Array.from(DBH_CHANGE_VALIDATION_CODES).sort()).toEqual(['1', '2']);
  });
});
