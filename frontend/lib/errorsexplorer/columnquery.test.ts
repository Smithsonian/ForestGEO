import { describe, expect, it } from 'vitest';
import { MAX_COLUMN_FILTER_VALUE_LENGTH, type ErrorExplorerColumnFilter, type ErrorExplorerSortItem } from '@/config/errorsexplorer';
import { compareRowsBySortItem, matchesColumnFilter, toServerColumnFilters, toServerSortModel, type ColumnValueRow } from './columnquery';

const BLANK_PRIOR_ROWS: ColumnValueRow[] = [
  { coreMeasurementID: 1, priorDBH: null },
  { coreMeasurementID: 2, priorDBH: undefined },
  { coreMeasurementID: 3, priorDBH: '20.000000' },
  { coreMeasurementID: 4, priorDBH: 35 }
];

function matchingIDs(rows: ColumnValueRow[], filter: ErrorExplorerColumnFilter): number[] {
  const ids = rows.filter(row => matchesColumnFilter(row, filter)).map(row => row.coreMeasurementID);
  console.log('[view-errors column filter]', JSON.stringify({ filter, ids }));
  return ids;
}

describe('number filters (P2-10)', () => {
  it('isEmpty returns exactly the rows with no prior value and isNotEmpty the others', () => {
    expect(matchingIDs(BLANK_PRIOR_ROWS, { field: 'priorDBH', operator: 'isEmpty' })).toEqual([1, 2]);
    expect(matchingIDs(BLANK_PRIOR_ROWS, { field: 'priorDBH', operator: 'isNotEmpty' })).toEqual([3, 4]);
  });

  it('!= 20 includes the blank rows, as MUI does', () => {
    expect(matchingIDs(BLANK_PRIOR_ROWS, { field: 'priorDBH', operator: '!=', value: 20 })).toEqual([1, 2, 4]);
  });

  it.each([
    ['=', 20, [3]],
    ['>', 0, [3, 4]],
    ['>=', 35, [4]],
    ['<', 35, [3]],
    ['<=', 20, [3]]
  ] as const)('%s %d never matches a blank cell', (operator, value, expected) => {
    expect(matchingIDs(BLANK_PRIOR_ROWS, { field: 'priorDBH', operator, value })).toEqual(expected);
  });

  it('compares Change on the rounded percent the cell shows', () => {
    const rows: ColumnValueRow[] = [
      { coreMeasurementID: 10, dbhChangePercent: 20.1 },
      { coreMeasurementID: 11, dbhChangePercent: 20 },
      { coreMeasurementID: 12, dbhChangePercent: null }
    ];
    expect(matchingIDs(rows, { field: 'dbhChangePercent', operator: '>', value: 20 })).toEqual([10]);
    expect(matchingIDs(rows, { field: 'dbhChangePercent', operator: 'isEmpty' })).toEqual([12]);
  });
});

describe('text filters', () => {
  const rows: ColumnValueRow[] = [
    { coreMeasurementID: 1, treeTag: ' Tree-10 ' },
    { coreMeasurementID: 2, treeTag: 'tree-2' },
    { coreMeasurementID: 3, treeTag: '' },
    { coreMeasurementID: 4, treeTag: '   ' },
    { coreMeasurementID: 5, treeTag: null }
  ];

  it.each([
    ['contains', 'TREE', [1, 2]],
    ['equals', 'tree-10', [1]],
    ['startsWith', ' tree-1', [1]],
    ['endsWith', '-2', [2]]
  ] as const)('%s %j is case-insensitive on trimmed values', (operator, value, expected) => {
    expect(matchingIDs(rows, { field: 'treeTag', operator, value })).toEqual(expected);
  });

  it('splits blank (null, empty, whitespace-only) from non-blank', () => {
    expect(matchingIDs(rows, { field: 'treeTag', operator: 'isEmpty' })).toEqual([3, 4, 5]);
    expect(matchingIDs(rows, { field: 'treeTag', operator: 'isNotEmpty' })).toEqual([1, 2]);
  });
});

describe('sorting', () => {
  const rows: ColumnValueRow[] = [
    { coreMeasurementID: 4, measuredDBH: '12.000000', treeTag: '10' },
    { coreMeasurementID: 1, measuredDBH: null, treeTag: '2' },
    { coreMeasurementID: 3, measuredDBH: '12.000000', treeTag: '1' },
    { coreMeasurementID: 2, measuredDBH: '9.500000', treeTag: null }
  ];

  function sortedIDs(item: ErrorExplorerSortItem): number[] {
    const ids = [...rows].sort((a, b) => compareRowsBySortItem(a, b, item)).map(row => row.coreMeasurementID);
    console.log('[view-errors sort]', JSON.stringify({ item, ids }));
    return ids;
  }

  it('sorts numbers numerically with blanks last and ties by ID ascending, in both directions', () => {
    expect(sortedIDs({ field: 'measuredDBH', sort: 'asc' })).toEqual([2, 3, 4, 1]);
    expect(sortedIDs({ field: 'measuredDBH', sort: 'desc' })).toEqual([3, 4, 2, 1]);
  });

  it('sorts tags as text, so unpadded tags go 1, 10, 2', () => {
    expect(sortedIDs({ field: 'treeTag', sort: 'asc' })).toEqual([3, 4, 1, 2]);
  });
});

describe('grid model normalization', () => {
  it('does not send a text filter longer than the bound the server rejects', () => {
    const atBound = 'a'.repeat(MAX_COLUMN_FILTER_VALUE_LENGTH);
    const overBound = 'a'.repeat(MAX_COLUMN_FILTER_VALUE_LENGTH + 1);
    expect(toServerColumnFilters([{ field: 'treeTag', operator: 'contains', value: atBound }]), 'a value at the bound is sent').toEqual([
      { field: 'treeTag', operator: 'contains', value: atBound }
    ]);
    expect(toServerColumnFilters([{ field: 'treeTag', operator: 'contains', value: overBound }]), 'a value over the bound would be a 400').toEqual([]);
  });

  it('sends a filter only when its operator takes no value or a value was entered', () => {
    expect(toServerColumnFilters([{ field: 'treeTag', operator: 'contains', value: undefined }])).toEqual([]);
    expect(toServerColumnFilters([{ field: 'treeTag', operator: 'contains', value: '  ' }])).toEqual([]);
    expect(toServerColumnFilters([{ field: 'treeTag', operator: 'contains', value: 'T1' }])).toEqual([{ field: 'treeTag', operator: 'contains', value: 'T1' }]);
    expect(toServerColumnFilters([{ field: 'priorDBH', operator: 'isEmpty', value: undefined }])).toEqual([{ field: 'priorDBH', operator: 'isEmpty' }]);
    expect(toServerColumnFilters([{ field: 'dbhChangePercent', operator: '>', value: 20 }])).toEqual([{ field: 'dbhChangePercent', operator: '>', value: 20 }]);
    expect(toServerColumnFilters([{ field: 'dbhChangePercent', operator: '>', value: Number.NaN }])).toEqual([]);
  });

  it('drops fields and operators the server would reject', () => {
    expect(toServerColumnFilters([{ field: 'attributes', operator: 'contains', value: 'A' }])).toEqual([]);
    expect(toServerColumnFilters([{ field: 'treeTag', operator: 'doesNotContain', value: 'A' }])).toEqual([]);
    expect(toServerSortModel([{ field: 'errors', sort: 'asc' }])).toEqual([]);
    expect(toServerSortModel([{ field: 'treeTag', sort: null }])).toEqual([]);
    expect(toServerSortModel([{ field: 'treeTag', sort: 'desc' }])).toEqual([{ field: 'treeTag', sort: 'desc' }]);
  });
});
