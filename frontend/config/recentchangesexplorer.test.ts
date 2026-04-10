import { describe, expect, it } from 'vitest';
import { groupIntoBatches, ChangelogEntry, FeedItem, RECENT_CHANGES_PRESETS, DEFAULT_RECENT_CHANGES_FILTERS } from './recentchangesexplorer';

const BATCH_WINDOW_MS = 60_000;

function makeEntry(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    changeID: 1,
    tableName: 'coremeasurements',
    recordID: '100',
    operation: 'INSERT',
    oldRowState: null,
    newRowState: { TreeTag: '1042', StemTag: '1' },
    changeTimestamp: '2026-04-09T14:30:00.000Z',
    changedBy: 'mason@si.edu',
    ...overrides
  };
}

describe('groupIntoBatches', () => {
  it('returns empty array for empty input', () => {
    expect(groupIntoBatches([])).toEqual([]);
  });

  it('wraps a single UPDATE as a single item', () => {
    const entry = makeEntry({ operation: 'UPDATE', oldRowState: { MeasuredDBH: 12 }, newRowState: { MeasuredDBH: 14 } });
    const result = groupIntoBatches([entry]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
    expect((result[0] as Extract<FeedItem, { type: 'single' }>).entry).toEqual(entry);
  });

  it('wraps a single DELETE as a single item', () => {
    const entry = makeEntry({ operation: 'DELETE', oldRowState: { StemTag: '3' }, newRowState: null });
    const result = groupIntoBatches([entry]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
  });

  it('groups consecutive INSERTs with same table + user within 60s', () => {
    const entries = [
      makeEntry({ changeID: 1, changeTimestamp: '2026-04-09T14:30:00.000Z' }),
      makeEntry({ changeID: 2, changeTimestamp: '2026-04-09T14:30:10.000Z', recordID: '101' }),
      makeEntry({ changeID: 3, changeTimestamp: '2026-04-09T14:30:20.000Z', recordID: '102' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('batch');
    const batch = result[0] as Extract<FeedItem, { type: 'batch' }>;
    expect(batch.count).toBe(3);
    expect(batch.tableName).toBe('coremeasurements');
    expect(batch.changedBy).toBe('mason@si.edu');
    expect(batch.entries).toHaveLength(3);
  });

  it('splits INSERTs into separate batches when time gap exceeds 60s', () => {
    const entries = [
      makeEntry({ changeID: 1, changeTimestamp: '2026-04-09T14:30:00.000Z' }),
      makeEntry({ changeID: 2, changeTimestamp: '2026-04-09T14:32:00.000Z', recordID: '101' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(2);
    expect(result.every(item => item.type === 'single')).toBe(true);
  });

  it('does not group INSERTs from different tables', () => {
    const entries = [
      makeEntry({ changeID: 1, tableName: 'coremeasurements' }),
      makeEntry({ changeID: 2, tableName: 'species', recordID: '200', changeTimestamp: '2026-04-09T14:30:05.000Z' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(2);
    expect(result.every(item => item.type === 'single')).toBe(true);
  });

  it('does not group INSERTs from different users', () => {
    const entries = [
      makeEntry({ changeID: 1, changedBy: 'mason@si.edu' }),
      makeEntry({ changeID: 2, changedBy: 'jdoe@si.edu', recordID: '101', changeTimestamp: '2026-04-09T14:30:05.000Z' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(2);
  });

  it('handles mixed operations: groups INSERTs but keeps UPDATE/DELETE separate', () => {
    const entries = [
      makeEntry({ changeID: 1, operation: 'INSERT', changeTimestamp: '2026-04-09T14:30:00.000Z' }),
      makeEntry({ changeID: 2, operation: 'INSERT', changeTimestamp: '2026-04-09T14:30:05.000Z', recordID: '101' }),
      makeEntry({ changeID: 3, operation: 'UPDATE', changeTimestamp: '2026-04-09T14:30:10.000Z', recordID: '102', oldRowState: { MeasuredDBH: 10 }, newRowState: { MeasuredDBH: 12 } }),
      makeEntry({ changeID: 4, operation: 'INSERT', changeTimestamp: '2026-04-09T14:30:15.000Z', recordID: '103' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('batch');
    expect((result[0] as Extract<FeedItem, { type: 'batch' }>).count).toBe(2);
    expect(result[1].type).toBe('single');
    expect((result[1] as Extract<FeedItem, { type: 'single' }>).entry.operation).toBe('UPDATE');
    expect(result[2].type).toBe('single');
  });

  it('treats a single INSERT as a single item, not a batch of 1', () => {
    const entries = [makeEntry({ changeID: 1 })];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
  });
});

describe('RECENT_CHANGES_PRESETS', () => {
  it('has four presets with correct IDs', () => {
    const ids = RECENT_CHANGES_PRESETS.map(p => p.id);
    expect(ids).toEqual(['all_changes', 'measurement_updates', 'deletions', 'uploads']);
  });

  it('all_changes preset uses operation all', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'all_changes')!;
    expect(preset.filters.operation).toBe('all');
  });

  it('measurement_updates preset uses operation UPDATE', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'measurement_updates')!;
    expect(preset.filters.operation).toBe('UPDATE');
  });

  it('deletions preset uses operation DELETE', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'deletions')!;
    expect(preset.filters.operation).toBe('DELETE');
  });

  it('uploads preset uses operation INSERT', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'uploads')!;
    expect(preset.filters.operation).toBe('INSERT');
  });
});

describe('DEFAULT_RECENT_CHANGES_FILTERS', () => {
  it('defaults to all_changes preset', () => {
    expect(DEFAULT_RECENT_CHANGES_FILTERS.presetId).toBe('all_changes');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.operation).toBe('all');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.changedBy).toBe('');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.tableName).toBe('');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.quickSearch).toBe('');
  });
});
