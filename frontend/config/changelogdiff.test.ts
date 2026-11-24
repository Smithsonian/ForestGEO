import { describe, expect, it } from 'vitest';
import { computeDiff, DiffEntry, EXCLUDED_FIELDS, recordedFieldNames } from './changelogdiff';

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

  it('excludes record ids and still reports a real plot or census change (#592 D8)', () => {
    const oldState = { id: 1, changeID: 100, ChangeID: 100, plotID: 5, PlotID: 5, censusID: 2, CensusID: 2, MeasuredDBH: 12.5 };
    const newState = { id: 2, changeID: 101, ChangeID: 101, plotID: 5, PlotID: 6, censusID: 3, CensusID: 2, MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result, 'id and ChangeID stay hidden; an unchanged plotID or CensusID is no difference').toEqual([
      { field: 'censusID', oldValue: 2, newValue: 3 },
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 },
      { field: 'PlotID', oldValue: 5, newValue: 6 }
    ]);
  });

  it.each(['PlotID', 'plotID', 'CensusID', 'censusID'])('reports a real change to %s (#592 D8)', field => {
    const result = computeDiff({ [field]: 5, MeasuredDBH: 12.5 }, { [field]: 6, MeasuredDBH: 12.5 });

    expect(result, `a changed ${field} must appear as a difference`).toEqual([{ field, oldValue: 5, newValue: 6 }]);
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

describe('EXCLUDED_FIELDS', () => {
  it('hides record ids and row timestamps, and nothing else', () => {
    expect([...EXCLUDED_FIELDS].sort()).toEqual(['ChangeID', 'CreatedAt', 'UpdatedAt', 'changeID', 'createdAt', 'id', 'updatedAt']);
  });
});

describe('recordedFieldNames', () => {
  it('lists the fields that hold a value, alphabetically, without excluded or empty ones', () => {
    const image = { TreeTag: 'T1', SpeciesID: 4, CensusID: 2, Note: null, Missing: undefined, id: 9, UpdatedAt: '2026-01-01', IsActive: 0, Comment: '' };
    expect(recordedFieldNames(image), 'zero and the empty string are values; null and undefined are not').toEqual([
      'CensusID',
      'Comment',
      'IsActive',
      'SpeciesID',
      'TreeTag'
    ]);
  });

  it('returns nothing for an image holding only excluded or empty fields', () => {
    expect(recordedFieldNames({ id: 1, CreatedAt: 'x', Note: null })).toEqual([]);
  });
});
