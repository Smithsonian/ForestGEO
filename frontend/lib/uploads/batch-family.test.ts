import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateShortBatchID } from '@/config/utils';

import {
  ARCGIS_COMMIT_BATCH_ID_BODY_LENGTH,
  ARCGIS_COMMIT_BATCH_ID_PREFIX,
  assertCallerBatchIDAllowed,
  BatchFamilyScopeError,
  buildSubBatchID,
  buildSubBatchPattern,
  deriveArcgisCommitBatchID,
  discoverBatchFamily,
  FAMILY_SCAN_INDEX,
  escapeLikePattern,
  familyRootOf,
  getIngestionBatchSize,
  highestSubBatchOrdinal,
  InvalidArcgisImportSessionIDError,
  isArcgisCommitBatchShape,
  isSubBatchOf,
  MAX_ORIGINAL_BATCH_ID_LENGTH,
  MAX_SUB_BATCH_ORDINAL,
  OriginalBatchIDTooLongError,
  ReservedBatchIDError,
  selectNewestFamilyPerFile,
  STAGED_BATCH_ID_MAX_LENGTH,
  SUB_BATCH_SEPARATOR,
  SubBatchOrdinalOverflowError,
  subBatchIDForRowOrdinal
} from './batch-family';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const SCHEMA = 'forestgeo_harvard';
const FILE_ID = 'harvard2014b.TXT';
const BATCH_ID = 'ms3k5wnm-oc4mjrino5h';
const DEFAULT_BATCH_SIZE = 10_000;
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
    expect(String(sql)).toContain(`/*+ INDEX(tm ${FAMILY_SCAN_INDEX}) */`);
    expect(String(sql)).toContain('temporarymeasurements tm');
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

describe('subBatchIDForRowOrdinal', () => {
  afterEach(() => delete process.env.INGESTION_SUB_BATCH_ROWS);

  it.each([
    [0, 'b__sub001'],
    [DEFAULT_BATCH_SIZE - 1, 'b__sub001'],
    [DEFAULT_BATCH_SIZE, 'b__sub002'],
    [DEFAULT_BATCH_SIZE * MAX_SUB_BATCH_ORDINAL - 1, 'b__sub999']
  ])('maps ordinal %i to %s at the default batch size', (rowOrdinal, expected) => {
    expect(getIngestionBatchSize()).toBe(DEFAULT_BATCH_SIZE);
    expect(subBatchIDForRowOrdinal('b', rowOrdinal)).toBe(expected);
  });

  it('honours INGESTION_SUB_BATCH_ROWS so tests and staging agree with setup', () => {
    process.env.INGESTION_SUB_BATCH_ROWS = '4';
    expect([0, 3, 4, 7, 8].map(ordinal => subBatchIDForRowOrdinal('b', ordinal))).toEqual(['b__sub001', 'b__sub001', 'b__sub002', 'b__sub002', 'b__sub003']);
  });

  it('refuses to number past the three-digit suffix instead of truncating', () => {
    const firstOverflowingOrdinal = DEFAULT_BATCH_SIZE * MAX_SUB_BATCH_ORDINAL;
    expect(() => subBatchIDForRowOrdinal('b', firstOverflowingOrdinal)).toThrow(SubBatchOrdinalOverflowError);
  });

  it('refuses an original BatchID that would overflow varchar(36) once suffixed', () => {
    const longest = 'b'.repeat(MAX_ORIGINAL_BATCH_ID_LENGTH);
    expect(subBatchIDForRowOrdinal(longest, 0)).toHaveLength(STAGED_BATCH_ID_MAX_LENGTH);
    expect(() => subBatchIDForRowOrdinal(`${longest}b`, 0)).toThrow(OriginalBatchIDTooLongError);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])('rejects ordinal %s', badOrdinal => {
    expect(() => subBatchIDForRowOrdinal('b', badOrdinal)).toThrow(RangeError);
  });
});

describe('familyRootOf', () => {
  it.each([
    ['x__sub007', 'x'],
    ['x', 'x'],
    ['x__subabc', 'x__subabc'],
    ['x__sub0071', 'x__sub0071']
  ])('%s -> %s', (batchID, root) => expect(familyRootOf(batchID)).toBe(root));
});

describe('selectNewestFamilyPerFile', () => {
  it('collapses sub-batches into their family and picks the newest family per file', () => {
    const rows = [
      { FileID: 'a.csv', BatchID: 'old', maxRowID: '10' },
      { FileID: 'a.csv', BatchID: 'new__sub001', maxRowID: '20' },
      { FileID: 'a.csv', BatchID: 'new__sub002', maxRowID: '30' },
      { FileID: 'b.csv', BatchID: 'solo', maxRowID: '5' }
    ];
    const selection = selectNewestFamilyPerFile(rows);
    console.log('[selectNewestFamilyPerFile]', JSON.stringify(selection));
    expect(selection).toEqual([
      { fileID: 'a.csv', batchID: 'new', familyCount: 2 },
      { fileID: 'b.csv', batchID: 'solo', familyCount: 1 }
    ]);
  });

  it('compares row IDs beyond 2^53 as integers, not floats', () => {
    const rows = [
      { FileID: 'a.csv', BatchID: 'lower', maxRowID: '9007199254740993' },
      { FileID: 'a.csv', BatchID: 'higher', maxRowID: '9007199254740994' }
    ];
    expect(selectNewestFamilyPerFile(rows)[0].batchID).toBe('higher');
  });
});

const RANDOM_SAMPLE_SIZE = 1_000;
const ALL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const ALL_F_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const BASE36_RADIX = 36;
const HEX_RADIX = 16;
const UUID_HEX_DIGITS = 32;

function decodeDerivedBody(batchID: string): string {
  const body = batchID.slice(ARCGIS_COMMIT_BATCH_ID_PREFIX.length);
  return [...body]
    .reduce((value, digit) => value * BigInt(BASE36_RADIX) + BigInt(parseInt(digit, BASE36_RADIX)), BigInt(0))
    .toString(HEX_RADIX)
    .padStart(UUID_HEX_DIGITS, '0');
}

describe('deriveArcgisCommitBatchID (#561 N1)', () => {
  it('fits the original-batch limit exactly: arc + 25 base-36 digits = MAX_ORIGINAL_BATCH_ID_LENGTH', () => {
    const derived = deriveArcgisCommitBatchID(crypto.randomUUID());
    console.log(`[derive] ${derived} length=${derived.length} limit=${MAX_ORIGINAL_BATCH_ID_LENGTH}`);
    expect(derived).toHaveLength(ARCGIS_COMMIT_BATCH_ID_PREFIX.length + ARCGIS_COMMIT_BATCH_ID_BODY_LENGTH);
    expect(derived).toHaveLength(MAX_ORIGINAL_BATCH_ID_LENGTH);
    expect(derived).toMatch(/^arc[0-9a-z]{25}$/);
    expect(derived).not.toContain('-');
    expect(derived).not.toContain(SUB_BATCH_SEPARATOR);
  });

  it('is deterministic for one id and injective: the body decodes back to the UUID hex (catches: a hash or a truncating encoding)', () => {
    const samples = [ALL_ZERO_UUID, ALL_F_UUID, ...Array.from({ length: RANDOM_SAMPLE_SIZE }, () => crypto.randomUUID())];
    const derivedIDs = new Set<string>();
    for (const uuid of samples) {
      const derived = deriveArcgisCommitBatchID(uuid);
      expect(deriveArcgisCommitBatchID(uuid)).toBe(derived);
      expect(decodeDerivedBody(derived), `round trip of ${uuid} via ${derived}`).toBe(uuid.replace(/-/g, '').toLowerCase());
      derivedIDs.add(derived);
    }
    console.log(
      `[derive] ${samples.length} UUIDs -> ${derivedIDs.size} distinct batch ids; zero=${deriveArcgisCommitBatchID(ALL_ZERO_UUID)} f=${deriveArcgisCommitBatchID(ALL_F_UUID)}`
    );
    expect(derivedIDs.size).toBe(samples.length);
  });

  it.each(['import-session-1', '', 'not-a-uuid-at-all-0000000000000000', `${ALL_F_UUID}0`])('throws InvalidArcgisImportSessionIDError for %j', value => {
    expect(() => deriveArcgisCommitBatchID(value)).toThrow(InvalidArcgisImportSessionIDError);
  });

  it('leaves room for every nameable sub-batch: the last one still fits temporarymeasurements.BatchID', () => {
    const derived = deriveArcgisCommitBatchID(ALL_F_UUID);
    const lastSubBatch = subBatchIDForRowOrdinal(derived, getIngestionBatchSize() * MAX_SUB_BATCH_ORDINAL - 1);
    console.log(`[derive] last sub-batch ${lastSubBatch} (${lastSubBatch.length} <= ${STAGED_BATCH_ID_MAX_LENGTH})`);
    expect(lastSubBatch.length).toBeLessThanOrEqual(STAGED_BATCH_ID_MAX_LENGTH);
  });
});

describe('isArcgisCommitBatchShape (#561 N1)', () => {
  it('never matches a batch the CSV generators produce, nor a UUID (catches: a reserved shape a CSV upload can hit)', () => {
    const csvBatches = Array.from({ length: RANDOM_SAMPLE_SIZE }, () => generateShortBatchID());
    const matches = csvBatches.filter(isArcgisCommitBatchShape);
    console.log(`[shape] sample CSV batch ${csvBatches[0]}; ${matches.length} of ${csvBatches.length} matched`);
    expect(matches).toEqual([]);
    expect(isArcgisCommitBatchShape(crypto.randomUUID())).toBe(false);
  });

  it('matches every derived id and nothing that only resembles one', () => {
    const derived = deriveArcgisCommitBatchID(crypto.randomUUID());
    expect(isArcgisCommitBatchShape(derived)).toBe(true);
    expect(isArcgisCommitBatchShape(`${derived}x`)).toBe(false);
    expect(isArcgisCommitBatchShape(derived.slice(0, -1))).toBe(false);
    expect(isArcgisCommitBatchShape(`${derived}${SUB_BATCH_SEPARATOR}001`)).toBe(false);
  });

  it('ReservedBatchIDError carries a code and names the batch', () => {
    const derived = deriveArcgisCommitBatchID(crypto.randomUUID());
    const error = new ReservedBatchIDError(derived, 'has the shape reserved for ArcGIS commit batches');
    expect(error.code).toBe('RESERVED_BATCH_ID');
    expect(error.message).toContain(derived);
  });
});

describe('assertCallerBatchIDAllowed (#561 H2: the batch columns compare case- and accent-insensitively)', () => {
  const derived = deriveArcgisCommitBatchID('6f1c2d3e-4a5b-4c6d-8e7f-901234567890');
  const FULL_WIDTH_OFFSET = 0xfee0;
  const toFullWidth = (value: string) => [...value].map(character => String.fromCharCode(character.charCodeAt(0) + FULL_WIDTH_OFFSET)).join('');
  const collationAliases: Array<[string, string]> = [
    ['the derived id itself', derived],
    ['all uppercase', derived.toUpperCase()],
    ['mixed-case prefix', `Arc${derived.slice(3)}`],
    ['uppercase body letter', `${derived.slice(0, 5)}${derived.charAt(5).toUpperCase()}${derived.slice(6)}`],
    ['accented prefix', `àrc${derived.slice(3)}`],
    ['full-width prefix', `${toFullWidth('arc')}${derived.slice(3)}`],
    ['full-width body', `arc${toFullWidth(derived.slice(3))}`]
  ];

  it.each(collationAliases)('refuses %s (catches: a shape check a collation alias slips past)', (_label, batchID) => {
    let thrown: unknown;
    try {
      assertCallerBatchIDAllowed(batchID);
    } catch (error) {
      thrown = error;
    }
    console.log(`[H2] ${JSON.stringify(batchID)} -> ${thrown instanceof Error ? thrown.message : 'accepted'}`);
    expect(thrown).toBeInstanceOf(ReservedBatchIDError);
  });

  it.each([
    ['an underscore', 'cross_batch_original'],
    ['a space', 'batch 1'],
    ['an uppercase letter', 'Batch-1']
  ])('refuses a batch with %s', (_label, batchID) => {
    expect(() => assertCallerBatchIDAllowed(batchID)).toThrow(ReservedBatchIDError);
  });

  it('accepts every batch the server generators emit, and lowercase-hyphen test batches', () => {
    const generated = Array.from({ length: RANDOM_SAMPLE_SIZE }, () => generateShortBatchID());
    const refused = generated.filter(batchID => {
      try {
        assertCallerBatchIDAllowed(batchID);
        return false;
      } catch (error) {
        if (error instanceof ReservedBatchIDError) return true;
        throw error;
      }
    });
    console.log(`[H2] refused ${refused.length} of ${generated.length} generated batches; sample ${generated[0]}`);
    expect(refused).toEqual([]);
    expect(() => assertCallerBatchIDAllowed('incoming-batch-0001')).not.toThrow();
  });
});
