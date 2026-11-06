import { describe, expect, it } from 'vitest';

import { getGridNumericOperators, getGridStringOperators } from '@mui/x-data-grid';
import {
  applyShowValue,
  buildErrorsExplorerMessageHref,
  buildErrorTypeKey,
  canClearValidationErrors,
  computeDbhChangePercent,
  DBH_CHANGE_VALIDATION_CODES,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_EXPLORER_COLUMN_FIELDS,
  ERROR_EXPLORER_NUMBER_FIELDS,
  ERROR_EXPLORER_NUMBER_OPERATORS,
  ERROR_EXPLORER_TEXT_FIELDS,
  ERROR_EXPLORER_TEXT_OPERATORS,
  ERROR_SOURCE,
  errorTypeHintFor,
  ERRORS_EXPLORER_MESSAGE_PARAM,
  ERRORS_EXPLORER_VIEW_ALL,
  ERRORS_EXPLORER_VIEW_ALL_HREF,
  ERRORS_EXPLORER_VIEW_PARAM,
  ERRORS_PAGE_PATH,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  formatContradictionCaption,
  formatDbhChange,
  formatErrorTypeLabel,
  formatViewErrorsFactsLine,
  INGESTION_ERROR_FIELD_MAP,
  isErrorExplorerNumberField,
  isMarkedInvalidWithoutLoggedError,
  MARKED_INVALID_NO_ERROR_LOGGED_LABEL,
  MAX_ERROR_EXPLORER_FILTER_STRING_LENGTH,
  resolveErrorsExplorerDeepLinkFilters,
  resolveShowValue
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

  it('filters to exactly one message and leaves every other filter at its default', () => {
    const filters = resolveErrorsExplorerDeepLinkFilters(new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: AWKWARD_MESSAGE }));
    expect(filters).toEqual({ ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [AWKWARD_MESSAGE] });
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

describe('error-type identity', () => {
  it('keys two codes that share a message apart', () => {
    const shared = 'Same text';
    const a = buildErrorTypeKey({ source: 'ingestion', code: 'A', message: shared });
    const b = buildErrorTypeKey({ source: 'ingestion', code: 'B', message: shared });
    const c = buildErrorTypeKey({ source: 'validation', code: 'A', message: shared });
    console.log('[view-errors identity keys]', JSON.stringify([a, b, c]));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('cannot be confused by separators inside a message', () => {
    expect(buildErrorTypeKey({ source: 'ingestion', code: 'A|B', message: 'C' })).not.toBe(
      buildErrorTypeKey({ source: 'ingestion', code: 'A', message: 'B|C' })
    );
  });
});

describe('sortable and filterable allow-list', () => {
  it('lists each column once and classifies it', () => {
    expect(new Set(ERROR_EXPLORER_COLUMN_FIELDS).size).toBe(ERROR_EXPLORER_COLUMN_FIELDS.length);
    ERROR_EXPLORER_TEXT_FIELDS.forEach(field => expect(isErrorExplorerNumberField(field), field).toBe(false));
    ERROR_EXPLORER_NUMBER_FIELDS.forEach(field => expect(isErrorExplorerNumberField(field), field).toBe(true));
  });

  it("offers only operators MUI's own lists contain", () => {
    const muiString = getGridStringOperators().map(operator => operator.value);
    const muiNumber = getGridNumericOperators().map(operator => operator.value);
    console.log('[view-errors operators]', JSON.stringify({ muiString, muiNumber }));
    ERROR_EXPLORER_TEXT_OPERATORS.forEach(operator => expect(muiString, operator).toContain(operator));
    ERROR_EXPLORER_NUMBER_OPERATORS.forEach(operator => expect(muiNumber, operator).toContain(operator));
  });
});

describe('Show control mapping', () => {
  it.each([
    ['all', { source: 'all', contradictionOnly: false }],
    ['validation', { source: 'validation', contradictionOnly: false }],
    ['ingestion', { source: 'ingestion', contradictionOnly: false }],
    ['contradictions', { source: 'all', contradictionOnly: true }]
  ] as const)('%s ↔ %j', (value, expected) => {
    const filters = applyShowValue(DEFAULT_ERROR_EXPLORER_FILTERS, value);
    expect({ source: filters.source, contradictionOnly: filters.contradictionOnly }).toEqual(expected);
    expect(resolveShowValue(filters)).toBe(value);
  });
});

describe('text helpers', () => {
  it('writes the facts line and the contradiction caption with census totals', () => {
    expect(formatViewErrorsFactsLine(21, 1088, 4)).toBe('21 of 1,088 active measurements have an unresolved error · 4 error types');
    expect(formatContradictionCaption(2, 1)).toBe('2 duplicate tag/stem · 1 same-batch species');
  });

  it.each([
    { affected: 21, active: 1088, errorTypes: 1, expected: '21 of 1,088 active measurements have an unresolved error · 1 error type' },
    { affected: 21, active: 1088, errorTypes: 2, expected: '21 of 1,088 active measurements have an unresolved error · 2 error types' },
    { affected: 0, active: 1088, errorTypes: 0, expected: '0 of 1,088 active measurements have an unresolved error · 0 error types' },
    { affected: 1, active: 1088, errorTypes: 1, expected: '1 of 1,088 active measurements has an unresolved error · 1 error type' },
    { affected: 1, active: 1, errorTypes: 1, expected: '1 of 1 active measurement has an unresolved error · 1 error type' },
    { affected: 0, active: 1, errorTypes: 0, expected: '0 of 1 active measurement have an unresolved error · 0 error types' }
  ])('agrees the facts line with its counts: $affected of $active active, $errorTypes types', ({ affected, active, errorTypes, expected }) => {
    expect(formatViewErrorsFactsLine(affected, active, errorTypes)).toBe(expected);
  });

  it('has a hint only for the four codes on the board', () => {
    expect(errorTypeHintFor({ source: 'validation', code: '14' })).not.toBeNull();
    expect(errorTypeHintFor({ source: 'ingestion', code: 'COORDINATE_DRIFT' })).not.toBeNull();
    expect(errorTypeHintFor({ source: 'ingestion', code: 'INVALID_SPECIES' })).not.toBeNull();
    expect(errorTypeHintFor({ source: 'validation', code: '21' })).not.toBeNull();
    expect(errorTypeHintFor({ source: 'validation', code: '15' })).toBeNull();
  });

  it('maps DUPLICATE_TAG_STEMTAG to the tree and stem tag columns (P2-6)', () => {
    expect(INGESTION_ERROR_FIELD_MAP.DUPLICATE_TAG_STEMTAG).toEqual(['treeTag', 'stemTag']);
  });
});

describe('deep-link bound', () => {
  it('accepts a message at the bound and ignores one past it', () => {
    const atBound = 'm'.repeat(MAX_ERROR_EXPLORER_FILTER_STRING_LENGTH);
    const pastBound = `${atBound}m`;
    expect(resolveErrorsExplorerDeepLinkFilters(new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: atBound }))?.exactMessages).toEqual([atBound]);
    expect(resolveErrorsExplorerDeepLinkFilters(new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: pastBound }))).toBeNull();
  });
});
