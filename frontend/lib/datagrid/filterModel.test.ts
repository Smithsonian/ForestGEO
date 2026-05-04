import { describe, expect, it } from 'vitest';
import {
  areArraysEqual,
  areFilterItemsEqual,
  areFilterValuesEqual,
  areGridFilterModelsEqual,
  isActiveFilterItem,
  isNonEmptyFilterValue,
  sanitizeQuickFilterValues,
  toServerFilterItem,
  toServerFilterModel
} from './filterModel';

describe('isNonEmptyFilterValue', () => {
  it('rejects null, undefined, and whitespace-only strings', () => {
    expect(isNonEmptyFilterValue(null)).toBe(false);
    expect(isNonEmptyFilterValue(undefined)).toBe(false);
    expect(isNonEmptyFilterValue('   ')).toBe(false);
    expect(isNonEmptyFilterValue('')).toBe(false);
  });

  it('accepts non-empty primitives', () => {
    expect(isNonEmptyFilterValue('ACRU')).toBe(true);
    expect(isNonEmptyFilterValue(0)).toBe(true);
    expect(isNonEmptyFilterValue(false)).toBe(true);
  });

  it('treats arrays as non-empty when any element is non-empty', () => {
    expect(isNonEmptyFilterValue([])).toBe(false);
    expect(isNonEmptyFilterValue([null, ''])).toBe(false);
    expect(isNonEmptyFilterValue([null, 'x'])).toBe(true);
  });
});

describe('sanitizeQuickFilterValues', () => {
  it('drops empty values and trims strings', () => {
    expect(sanitizeQuickFilterValues(['  ACRU ', '', null as any, '   ', 'TREE1'])).toEqual(['ACRU', 'TREE1']);
  });

  it('returns [] for undefined input', () => {
    expect(sanitizeQuickFilterValues(undefined)).toEqual([]);
  });
});

describe('isActiveFilterItem', () => {
  it('rejects items missing field or operator', () => {
    expect(isActiveFilterItem({ id: 1, field: '', operator: 'contains', value: 'x' })).toBe(false);
    expect(isActiveFilterItem({ id: 1, field: 'spCode', operator: '', value: 'x' })).toBe(false);
  });

  it('accepts valueless operators (isEmpty/isNotEmpty)', () => {
    expect(isActiveFilterItem({ id: 1, field: 'description', operator: 'isEmpty' })).toBe(true);
    expect(isActiveFilterItem({ id: 1, field: 'description', operator: 'isNotEmpty' })).toBe(true);
  });

  it('rejects valued operators with empty values', () => {
    expect(isActiveFilterItem({ id: 1, field: 'spCode', operator: 'contains', value: '' })).toBe(false);
  });
});

describe('toServerFilterItem', () => {
  it('strips id and preserves operator + value', () => {
    expect(toServerFilterItem({ id: 7, field: 'spCode', operator: 'equals', value: 'ACRU' })).toEqual({
      field: 'spCode',
      operator: 'equals',
      value: 'ACRU'
    });
  });

  it('drops empty entries from array values', () => {
    expect(toServerFilterItem({ id: 7, field: 'spCode', operator: 'isAnyOf', value: ['ACRU', '', null] as any })).toEqual({
      field: 'spCode',
      operator: 'isAnyOf',
      value: ['ACRU']
    });
  });
});

describe('areArraysEqual / areFilterValuesEqual / areFilterItemsEqual', () => {
  it('compares arrays by reference-of-elements', () => {
    expect(areArraysEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(areArraysEqual(['a'], ['a', 'b'])).toBe(false);
    expect(areArraysEqual(undefined, [])).toBe(true);
  });

  it('treats null and undefined values as equal in filter items', () => {
    expect(areFilterValuesEqual(null, undefined)).toBe(true);
  });

  it('compares filter items by field, operator, and value', () => {
    const a = [{ field: 'spCode', operator: 'contains', value: 'AC' }];
    const b = [{ field: 'spCode', operator: 'contains', value: 'AC' }];
    expect(areFilterItemsEqual(a, b)).toBe(true);
    const c = [{ field: 'spCode', operator: 'equals', value: 'AC' }];
    expect(areFilterItemsEqual(a, c)).toBe(false);
  });
});

describe('toServerFilterModel', () => {
  it('drops inactive items and trims quick-filter values', () => {
    const out = toServerFilterModel({
      items: [
        { id: 1, field: 'spCode', operator: 'contains', value: 'AC' },
        { id: 2, field: 'spCode', operator: 'contains', value: '' }
      ],
      quickFilterValues: ['  hello ', '', 'world']
    });
    expect(out.items).toEqual([{ field: 'spCode', operator: 'contains', value: 'AC' }]);
    expect(out.quickFilterValues).toEqual(['hello', 'world']);
  });

  it('drops logicOperator when at most one item survives', () => {
    const out = toServerFilterModel({
      items: [{ id: 1, field: 'spCode', operator: 'contains', value: 'AC' }],
      quickFilterValues: [],
      logicOperator: 'and'
    });
    expect(out.logicOperator).toBeUndefined();
  });

  it('preserves logicOperator when more than one item survives', () => {
    const out = toServerFilterModel({
      items: [
        { id: 1, field: 'spCode', operator: 'contains', value: 'AC' },
        { id: 2, field: 'tag', operator: 'contains', value: '12' }
      ],
      quickFilterValues: [],
      logicOperator: 'or'
    });
    expect(out.logicOperator).toBe('or');
  });

  it('drops quickFilterLogicOperator when at most one quick-filter value survives', () => {
    const out = toServerFilterModel({
      items: [],
      quickFilterValues: ['hello'],
      quickFilterLogicOperator: 'and'
    });
    expect(out.quickFilterLogicOperator).toBeUndefined();
  });
});

describe('areGridFilterModelsEqual', () => {
  it('returns true for two empty models', () => {
    expect(areGridFilterModelsEqual({ items: [], quickFilterValues: [] }, { items: [], quickFilterValues: [] })).toBe(true);
  });

  it('returns false when items differ', () => {
    expect(
      areGridFilterModelsEqual(
        { items: [{ field: 'spCode', operator: 'contains', value: 'AC' }], quickFilterValues: [] },
        { items: [{ field: 'spCode', operator: 'contains', value: 'BD' }], quickFilterValues: [] }
      )
    ).toBe(false);
  });

  it('returns false when quickFilterExcludeHiddenColumns differs', () => {
    expect(
      areGridFilterModelsEqual(
        { items: [], quickFilterValues: [], quickFilterExcludeHiddenColumns: true },
        { items: [], quickFilterValues: [], quickFilterExcludeHiddenColumns: false }
      )
    ).toBe(false);
  });

  it('returns false when logicOperator differs', () => {
    expect(
      areGridFilterModelsEqual({ items: [], quickFilterValues: [], logicOperator: 'and' }, { items: [], quickFilterValues: [], logicOperator: 'or' })
    ).toBe(false);
  });
});
