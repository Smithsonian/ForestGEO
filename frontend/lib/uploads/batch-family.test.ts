import { describe, expect, it, vi } from 'vitest';

import {
  BatchFamilyScopeError,
  buildSubBatchID,
  buildSubBatchPattern,
  discoverBatchFamily,
  escapeLikePattern,
  highestSubBatchOrdinal,
  isSubBatchOf,
  SUB_BATCH_SEPARATOR
} from './batch-family';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const SCHEMA = 'forestgeo_harvard';
const FILE_ID = 'harvard2014b.TXT';
const BATCH_ID = 'ms3k5wnm-oc4mjrino5h';
const PLOT_ID = 12;
const CENSUS_ID = 1;

function familyRow(overrides: Partial<Record<string, unknown>> & { BatchID: string; rowCount: number }) {
  return {
    PlotID: PLOT_ID,
    CensusID: CENSUS_ID,
    plotCount: 1,
    censusCount: 1,
    ...overrides
  };
}

describe('LIKE escaping', () => {
  it('escapes every MySQL LIKE metacharacter', () => {
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('escapes the underscores inside the __sub separator itself', () => {
    // Unescaped, `__sub` would match any two characters followed by "sub".
    expect(buildSubBatchPattern('batch1')).toBe('batch1\\_\\_sub%');
  });

  it('neutralises a wildcard-bearing batch ID so it cannot match a foreign batch', () => {
    const pattern = buildSubBatchPattern('batch%');

    expect(pattern).toBe('batch\\%\\_\\_sub%');
    // The literal '%' must not survive as a wildcard anywhere but the trailing one.
    expect(pattern.indexOf('%')).toBe(pattern.indexOf('\\%') + 1);
    expect(pattern.endsWith('sub%')).toBe(true);
  });

  it('round-trips the IDs the splitter actually writes', () => {
    const subBatchID = buildSubBatchID(BATCH_ID, 1);

    expect(subBatchID).toBe(`${BATCH_ID}${SUB_BATCH_SEPARATOR}001`);
    expect(isSubBatchOf(subBatchID, BATCH_ID)).toBe(true);
    expect(isSubBatchOf(`${BATCH_ID}-other`, BATCH_ID)).toBe(false);
  });
});

describe('highestSubBatchOrdinal', () => {
  it('returns 0 when no sub-batches exist', () => {
    expect(highestSubBatchOrdinal([], BATCH_ID)).toBe(0);
  });

  it('finds the highest ordinal so a resumed split does not collide', () => {
    expect(highestSubBatchOrdinal([buildSubBatchID(BATCH_ID, 1), buildSubBatchID(BATCH_ID, 12), buildSubBatchID(BATCH_ID, 3)], BATCH_ID)).toBe(12);
  });

  it('ignores IDs belonging to a different batch', () => {
    expect(highestSubBatchOrdinal([buildSubBatchID('other-batch', 9)], BATCH_ID)).toBe(0);
  });
});

describe('discoverBatchFamily', () => {
  it('matches the original ID and its sub-batch family with an explicit ESCAPE clause', async () => {
    const runQuery = vi.fn().mockResolvedValue([familyRow({ BatchID: BATCH_ID, rowCount: 5 })]);

    await discoverBatchFamily(runQuery, SCHEMA, FILE_ID, BATCH_ID);

    const [sql, params] = runQuery.mock.calls[0];
    expect(String(sql)).toContain('BatchID = ? OR BatchID LIKE ?');
    expect(String(sql)).toContain("ESCAPE '\\\\'");
    expect(params).toEqual([FILE_ID, BATCH_ID, `${escapeLikePattern(BATCH_ID)}\\_\\_sub%`]);
  });

  it('returns null only when the family is genuinely empty', async () => {
    const runQuery = vi.fn().mockResolvedValue([]);

    expect(await discoverBatchFamily(runQuery, SCHEMA, FILE_ID, BATCH_ID)).toBeNull();
  });

  it('recovers orphaned sub-batches when the original ID has no rows left', async () => {
    // The incident shape: splitting renamed every row, then the attempt died.
    const runQuery = vi
      .fn()
      .mockResolvedValue([
        familyRow({ BatchID: buildSubBatchID(BATCH_ID, 1), rowCount: 10_000 }),
        familyRow({ BatchID: buildSubBatchID(BATCH_ID, 2), rowCount: 96_227 })
      ]);

    const family = await discoverBatchFamily(runQuery, SCHEMA, FILE_ID, BATCH_ID);

    expect(family).not.toBeNull();
    expect(family!.plotID).toBe(PLOT_ID);
    expect(family!.censusID).toBe(CENSUS_ID);
    // Truthful sum across the family — not a -1 sentinel, not the first group's count.
    expect(family!.totalRows).toBe(106_227);
    expect(family!.originalRowCount).toBe(0);
    expect(family!.orphanedSubBatchIDs).toEqual([buildSubBatchID(BATCH_ID, 1), buildSubBatchID(BATCH_ID, 2)]);
  });

  it('separates original rows from orphaned sub-batches in a mixed family', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValue([familyRow({ BatchID: BATCH_ID, rowCount: 7 }), familyRow({ BatchID: buildSubBatchID(BATCH_ID, 1), rowCount: 3 })]);

    const family = await discoverBatchFamily(runQuery, SCHEMA, FILE_ID, BATCH_ID);

    expect(family!.originalRowCount).toBe(7);
    expect(family!.orphanedSubBatchIDs).toEqual([buildSubBatchID(BATCH_ID, 1)]);
    expect(family!.totalRows).toBe(10);
  });

  it('refuses a family whose members disagree on census', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValue([
        familyRow({ BatchID: buildSubBatchID(BATCH_ID, 1), rowCount: 2, CensusID: 1 }),
        familyRow({ BatchID: buildSubBatchID(BATCH_ID, 2), rowCount: 2, CensusID: 99 })
      ]);

    await expect(discoverBatchFamily(runQuery, SCHEMA, FILE_ID, BATCH_ID)).rejects.toThrow(BatchFamilyScopeError);
  });

  it('refuses a single sub-batch that internally spans multiple plots', async () => {
    const runQuery = vi.fn().mockResolvedValue([familyRow({ BatchID: BATCH_ID, rowCount: 4, plotCount: 2 })]);

    await expect(discoverBatchFamily(runQuery, SCHEMA, FILE_ID, BATCH_ID)).rejects.toThrow(BatchFamilyScopeError);
  });
});
