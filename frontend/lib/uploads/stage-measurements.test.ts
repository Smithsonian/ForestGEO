import { describe, expect, it } from 'vitest';
import { InvalidFirstRowOrdinalError, parseFirstRowOrdinal } from './stage-measurements';

const INVALID_FIRST_ROW_ORDINAL_CODE = 'INVALID_FIRST_ROW_ORDINAL';

describe('parseFirstRowOrdinal', () => {
  it.each([
    ['undefined', undefined, null],
    ['null', null, null],
    ['zero', 0, 0],
    ['a positive integer', 7, 7]
  ])('accepts %s', (_label, value, expected) => {
    const parsed = parseFirstRowOrdinal(value);
    console.log(`[parseFirstRowOrdinal] ${String(value)} -> ${String(parsed)}`);
    expect(parsed).toBe(expected);
  });

  it.each([
    ['a negative integer', -1],
    ['a fraction', 1.5],
    ['a numeric string', '3'],
    ['NaN', Number.NaN],
    ['2**53, past the safe-integer range', 2 ** 53],
    ['1e300', 1e300]
  ])('rejects %s with InvalidFirstRowOrdinalError', (_label, value) => {
    let thrown: unknown;
    try {
      parseFirstRowOrdinal(value);
    } catch (error) {
      thrown = error;
    }
    console.log(`[parseFirstRowOrdinal] ${typeof value} ${String(value)} threw:`, thrown instanceof Error ? thrown.message : thrown);
    expect(thrown).toBeInstanceOf(InvalidFirstRowOrdinalError);
    expect((thrown as InvalidFirstRowOrdinalError).code).toBe(INVALID_FIRST_ROW_ORDINAL_CODE);
    expect((thrown as Error).message).toContain(typeof value === 'string' ? JSON.stringify(value) : String(value));
  });
});
