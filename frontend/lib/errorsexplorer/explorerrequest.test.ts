import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  MAX_COLUMN_FILTER_VALUE_LENGTH,
  MAX_ERROR_EXPLORER_CENSUS_IDS,
  MAX_ERROR_EXPLORER_FILTER_STRING_LENGTH,
  MAX_ERROR_EXPLORER_FILTER_STRINGS
} from '@/config/errorsexplorer';
import {
  errorExplorerFacetsRequestSchema,
  errorExplorerQueryRequestSchema,
  parseErrorExplorerDetailsParams,
  parseExplorerRequest,
  parseStoredErrorExplorerFilters,
  serializeStoredErrorExplorerFilters
} from './explorerrequest';

const VALID_SCHEMA = 'forestgeo_testing';
const VALID_QUERY = { schema: VALID_SCHEMA, plotID: 1, censusID: 5, censusIDs: [5], page: 0, pageSize: 25 };

function parseQuery(overrides: Record<string, unknown>) {
  return parseExplorerRequest(errorExplorerQueryRequestSchema, { ...VALID_QUERY, ...overrides });
}

describe('errors explorer query request', () => {
  it('fills defaults for a minimal valid request', () => {
    const result = parseQuery({});
    console.log('[view-errors request]', JSON.stringify(result));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sortModel).toEqual([]);
    expect(result.data.columnFilters).toEqual([]);
    expect(result.data.filters).toEqual({
      source: DEFAULT_ERROR_EXPLORER_FILTERS.source,
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    });
  });

  it('accepts an identity, one sort item and one filter item of each kind', () => {
    for (const columnFilters of [
      [{ field: 'treeTag', operator: 'contains', value: 'T1' }],
      [{ field: 'priorDBH', operator: 'isEmpty' }],
      [{ field: 'dbhChangePercent', operator: '>', value: 20 }],
      [{ field: 'measuredDBH', operator: '!=', value: 20 }]
    ]) {
      const result = parseQuery({
        errorType: { source: 'validation', code: '14', message: 'Attribute code does not exist in attributes table' },
        sortModel: [{ field: 'measuredDBH', sort: 'desc' }],
        columnFilters
      });
      expect(result.ok, JSON.stringify({ columnFilters, result })).toBe(true);
    }
  });

  it.each([
    ['a non-numeric page', { page: 'x' }],
    ['a negative page', { page: -1 }],
    ['page size 7', { pageSize: 7 }],
    ['page size 101', { pageSize: 101 }],
    ['26 census IDs', { censusIDs: Array.from({ length: MAX_ERROR_EXPLORER_CENSUS_IDS + 1 }, (_, index) => index + 1) }],
    ['101 messages', { filters: { exactMessages: Array.from({ length: MAX_ERROR_EXPLORER_FILTER_STRINGS + 1 }, (_, index) => `m${index}`) } }],
    ['a 1,001-character message', { filters: { exactMessages: ['m'.repeat(MAX_ERROR_EXPLORER_FILTER_STRING_LENGTH + 1)] } }],
    ['an unknown source', { filters: { source: 'bogus' } }],
    ['a sort field off the allow-list', { sortModel: [{ field: 'attributes', sort: 'asc' }] }],
    [
      'two sort items',
      {
        sortModel: [
          { field: 'treeTag', sort: 'asc' },
          { field: 'stemTag', sort: 'asc' }
        ]
      }
    ],
    [
      'two filter items',
      {
        columnFilters: [
          { field: 'treeTag', operator: 'contains', value: 'a' },
          { field: 'stemTag', operator: 'contains', value: 'b' }
        ]
      }
    ],
    ['a number operator on a text field', { columnFilters: [{ field: 'treeTag', operator: '>', value: 'a' }] }],
    ['a text operator on a number field', { columnFilters: [{ field: 'measuredDBH', operator: 'contains', value: '1' }] }],
    ['a text value of 201 characters', { columnFilters: [{ field: 'treeTag', operator: 'contains', value: 'a'.repeat(MAX_COLUMN_FILTER_VALUE_LENGTH + 1) }] }],
    ['a blank text value', { columnFilters: [{ field: 'treeTag', operator: 'contains', value: '   ' }] }],
    ['a string value for a number operator', { columnFilters: [{ field: 'measuredDBH', operator: '>', value: '20' }] }],
    ['a value on isEmpty', { columnFilters: [{ field: 'priorDBH', operator: 'isEmpty', value: 1 }] }],
    ['a missing value on contains', { columnFilters: [{ field: 'treeTag', operator: 'contains' }] }],
    ['an errorType with an unknown source', { errorType: { source: 'bogus', code: '14', message: 'x' } }],
    ['an unknown top-level key', { surprise: true }]
  ])('rejects %s', (_label, overrides) => {
    const result = parseQuery(overrides);
    console.log('[view-errors request rejected]', _label, JSON.stringify(result.ok ? 'PARSED' : result.issues));
    expect(result.ok).toBe(false);
  });

  it('reports issue paths and codes only, never the rejected values', () => {
    const secret = 'secret-value-that-must-not-be-logged';
    const result = parseQuery({ filters: { source: secret } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain(secret);
    expect(result.issues[0]).toEqual({ path: 'filters.source', code: expect.any(String) });
  });
});

describe('errors explorer facets request', () => {
  it('takes the shared part only', () => {
    expect(parseExplorerRequest(errorExplorerFacetsRequestSchema, { schema: VALID_SCHEMA, plotID: 1, censusID: 5 }).ok).toBe(true);
    expect(parseExplorerRequest(errorExplorerFacetsRequestSchema, { schema: VALID_SCHEMA, plotID: 1, censusID: 5, page: 0 }).ok).toBe(false);
  });
});

describe('stored filters (P1-1)', () => {
  it('restores the four keys the new UI can show and drops the rest', () => {
    const stored = JSON.stringify({
      source: 'validation',
      quickSearch: 'T1',
      exactMessages: ['m'],
      page: 'x',
      affectedFields: ['f'],
      contradictionTypes: ['same_batch_conflict'],
      presetId: 'p'
    });
    const restored = parseStoredErrorExplorerFilters(stored);
    console.log('[view-errors restore]', JSON.stringify(restored));
    expect(restored).toEqual({ ...DEFAULT_ERROR_EXPLORER_FILTERS, presetId: undefined, source: 'validation', quickSearch: 'T1', exactMessages: ['m'] });
  });

  it.each([
    ['an unknown source', JSON.stringify({ source: 'bogus' })],
    ['a 500-item array', JSON.stringify({ exactMessages: Array.from({ length: 500 }, (_, index) => `m${index}`) })],
    ['a non-array exactMessages', JSON.stringify({ exactMessages: 'm' })],
    ['broken JSON', '{"source":'],
    ['a JSON array', '[]'],
    ['nothing stored', null]
  ])('restores the defaults for %s', (_label, stored) => {
    expect(parseStoredErrorExplorerFilters(stored)).toEqual({ ...DEFAULT_ERROR_EXPLORER_FILTERS, presetId: undefined });
  });

  it('restores validation + contradictions only as Show → Contradictions', () => {
    const restored = parseStoredErrorExplorerFilters(JSON.stringify({ source: 'validation', contradictionOnly: true }));
    expect({ source: restored.source, contradictionOnly: restored.contradictionOnly }).toEqual({ source: 'all', contradictionOnly: true });
  });

  it('saves only the four keys', () => {
    const saved = JSON.parse(
      serializeStoredErrorExplorerFilters({
        ...DEFAULT_ERROR_EXPLORER_FILTERS,
        affectedFields: ['f'],
        contradictionTypes: ['duplicate_tag_stem'],
        quickSearch: 'q'
      })
    );
    expect(Object.keys(saved).sort()).toEqual(['contradictionOnly', 'exactMessages', 'quickSearch', 'source']);
  });
});

describe('details params', () => {
  it('accepts strict positive integers only', () => {
    expect(parseErrorExplorerDetailsParams({ measurementID: '12', plotID: '1', censusID: '5' })).toEqual({
      ok: true,
      measurementID: 12,
      plotID: 1,
      censusID: 5
    });
    for (const measurementID of ['12.5', '0', '-1', 'abc', '', undefined, '1e3', ' 12']) {
      expect(parseErrorExplorerDetailsParams({ measurementID, plotID: '1', censusID: '5' }).ok, String(measurementID)).toBe(false);
    }
    expect(parseErrorExplorerDetailsParams({ measurementID: '12', plotID: null, censusID: '5' }).ok).toBe(false);
  });
});
