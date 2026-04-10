import { describe, expect, it } from 'vitest';
import { computeDiff, DiffEntry } from './changelogdiff';

describe('computeDiff', () => {
  it('returns empty array when both states are null', () => {
    expect(computeDiff(null, null)).toEqual([]);
  });

  it('returns empty array when both states are identical', () => {
    const state = { MeasuredDBH: 12.5, MeasuredHOM: 1.3, TreeTag: '1042' };
    expect(computeDiff(state, { ...state })).toEqual([]);
  });

  it('returns changed fields only', () => {
    const oldState = { MeasuredDBH: 12.5, MeasuredHOM: 1.3, TreeTag: '1042' };
    const newState = { MeasuredDBH: 14.2, MeasuredHOM: 1.3, TreeTag: '1042' };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([{ field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 }]);
  });

  it('returns multiple changed fields sorted alphabetically', () => {
    const oldState = { MeasuredDBH: 12.5, MeasuredHOM: 1.3, SpeciesCode: 'OECOSP' };
    const newState = { MeasuredDBH: 14.2, MeasuredHOM: 1.5, SpeciesCode: 'OECOSP' };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 },
      { field: 'MeasuredHOM', oldValue: 1.3, newValue: 1.5 }
    ]);
  });

  it('excludes internal metadata fields', () => {
    const oldState = { id: 1, changeID: 100, plotID: 5, censusID: 2, MeasuredDBH: 12.5 };
    const newState = { id: 2, changeID: 101, plotID: 5, censusID: 3, MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([{ field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 }]);
  });

  it('detects field added in new state', () => {
    const oldState = { TreeTag: '1042' };
    const newState = { TreeTag: '1042', MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([{ field: 'MeasuredDBH', oldValue: undefined, newValue: 14.2 }]);
  });

  it('detects field removed in new state', () => {
    const oldState = { TreeTag: '1042', MeasuredDBH: 12.5 };
    const newState = { TreeTag: '1042' };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([{ field: 'MeasuredDBH', oldValue: 12.5, newValue: undefined }]);
  });

  it('uses deep comparison for nested objects', () => {
    const oldState = { UserDefinedFields: { custom1: 'a', custom2: 'b' } };
    const newState = { UserDefinedFields: { custom1: 'a', custom2: 'c' } };
    const result = computeDiff(oldState, newState);

    expect(result).toHaveLength(1);
    expect(result[0].field).toBe('UserDefinedFields');
  });

  it('treats null and undefined as different from a value', () => {
    const oldState = { MeasuredDBH: null };
    const newState = { MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([{ field: 'MeasuredDBH', oldValue: null, newValue: 14.2 }]);
  });

  it('excludes timestamp fields like CreatedAt, UpdatedAt', () => {
    const oldState = { CreatedAt: '2026-01-01', UpdatedAt: '2026-01-01', MeasuredDBH: 12.5 };
    const newState = { CreatedAt: '2026-01-01', UpdatedAt: '2026-04-09', MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([{ field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 }]);
  });
});
