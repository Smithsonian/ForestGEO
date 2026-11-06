import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import * as oracle from '../../../../tests/oracles/errors-explorer-legacy';
import { DEFAULT_ERROR_EXPLORER_FILTERS, ERROR_EXPLORER_PRESETS, INGESTION_ERROR_FIELD_MAP, type ErrorExplorerFilters } from '@/config/errorsexplorer';
import { seededRandom } from '../../../../tests/setup/local-db-setup';
import {
  allowedFlagCombinations,
  anyFlagCombinationAllowed,
  buildErrorTypeCatalog,
  buildRelatedMeasurementIDs,
  computeErrorFacets,
  computeErrorKeySets,
  computeErrorMessageCounts,
  ErrorTypeCatalogMismatchError,
  findMissingErrorTypeKeys,
  getOccurrenceFields,
  hasIncompleteSignature,
  hasLocaleCompareTie,
  isImpossibleKeyFilter,
  mergeSignatureRows,
  parseWholeMemberIDs,
  toSliceBounds,
  toWeightedErrorRows,
  type ErrorTypeCatalog,
  type WeightedErrorRow
} from './errorsetcounts';
import { NO_LOG_ERROR_MESSAGE, NO_LOG_ERROR_TYPE_KEY, SQL_FALSE, SQL_TRUE, type ErrorSignatureRow, type ErrorTypeCatalogRow } from './errorsetsql';

const RANDOM_SEEDS = [544, 20261104, 4242];
const MEASUREMENTS_PER_SEED = 300;
const FIRST_MEASUREMENT_ID = 1001;
const MAX_OCCURRENCES_PER_MEASUREMENT = 3;
const DUPLICATE_GROUPS_PER_SEED = 24;
const SAME_BATCH_GROUPS_PER_SEED = 18;
const MIN_GROUP_MEMBERS = 2;
const MAX_EXTRA_GROUP_MEMBERS = 2;
const MEMBER_ID_OVERSHOOT = 20;
const SIGNATURE_CHUNK_COUNT = 2;
const SINGLE_MEASUREMENT_WEIGHT = 1;

const SCHEMA = 'forestgeo_testsite';
const PLOT_ID = 1;
const CENSUS_ID = 11;
const SECOND_PARAM_INDEX = 1;
const RAW_ERRORS_QUERY_MARKER = 'SELECT ms.CoreMeasurementID';
const DUPLICATE_GROUPS_QUERY_MARKER = 'GROUP_CONCAT(DISTINCT ms.CoreMeasurementID';
const SAME_BATCH_QUERY_MARKER = 'GROUP_CONCAT(DISTINCT cm.CoreMeasurementID';

const SEMICOLON_MESSAGE = 'First condition; second condition';
const SHARED_MESSAGE = 'Species mismatch';

interface ErrorTypeDefinition {
  key: number;
  source: 'validation' | 'ingestion';
  code: string;
  message: string;
  criteria: string;
  procedureName: string;
}

const NO_LOG_TYPE: ErrorTypeDefinition = {
  key: NO_LOG_ERROR_TYPE_KEY,
  source: 'ingestion',
  code: 'failed_no_log',
  message: NO_LOG_ERROR_MESSAGE,
  criteria: '',
  procedureName: ''
};

const ERROR_TYPE_TABLE: ErrorTypeDefinition[] = [
  { key: 1, source: 'validation', code: '1', message: 'DBH shrank between censuses', criteria: 'measuredDBH', procedureName: 'ValidateDBHShrinkage' },
  { key: 2, source: 'validation', code: '3', message: SHARED_MESSAGE, criteria: 'speciesCode', procedureName: 'ValidateSpeciesA' },
  { key: 3, source: 'validation', code: '4', message: SHARED_MESSAGE, criteria: 'treeTag', procedureName: 'ValidateSpeciesB' },
  { key: 4, source: 'validation', code: '7', message: SEMICOLON_MESSAGE, criteria: 'quadratName', procedureName: 'ValidateSemicolon' },
  { key: 5, source: 'validation', code: '8', message: 'Tag pair is wrong', criteria: 'treeTag;stemTag', procedureName: 'ValidateTagPair' },
  { key: 6, source: 'validation', code: '5', message: 'Duplicate tag in plot', criteria: '', procedureName: 'ValidateDuplicateTag' },
  { key: 7, source: 'ingestion', code: 'MISSING_FIELD_TREETAG', message: 'Tree tag is missing', criteria: '', procedureName: '' },
  NO_LOG_TYPE
];

const CATALOG_TYPES = ERROR_TYPE_TABLE.filter(type => type.key !== NO_LOG_ERROR_TYPE_KEY);

function toCatalogRows(types: readonly ErrorTypeDefinition[]): ErrorTypeCatalogRow[] {
  return types.map(type => ({
    ErrorID: type.key,
    ErrorSource: type.source,
    ErrorCode: type.code,
    DisplayMessage: type.message,
    ValidationCriteria: type.criteria,
    ProcedureName: type.procedureName
  }));
}

function toRawOccurrence(measurementID: number, type: ErrorTypeDefinition): oracle.RawErrorOccurrenceRow {
  return {
    CoreMeasurementID: measurementID,
    PlotID: PLOT_ID,
    CensusID: CENSUS_ID,
    CoreStemGUID: measurementID,
    TreeTag: `T${measurementID}`,
    StemTag: '1',
    ErrorSource: type.source,
    ErrorCode: type.code,
    DisplayMessage: type.message,
    ValidationCriteria: type.criteria,
    ProcedureName: type.procedureName
  };
}

interface GeneratedErrorSet {
  rawRows: oracle.RawErrorOccurrenceRow[];
  typeKeysByMeasurement: Map<number, number[]>;
  duplicateGroups: Array<{ TreeTag: string; StemTag: string; MeasurementIDs: string }>;
  sameBatchGroups: Array<{ UploadFileID: string; UploadBatchID: string; TreeTag: string; MeasurementIDs: string }>;
}

function pickDistinctTypes(random: () => number, count: number): ErrorTypeDefinition[] {
  const remaining = [...ERROR_TYPE_TABLE];
  return Array.from({ length: count }, () => remaining.splice(Math.floor(random() * remaining.length), 1)[0]);
}

function pickMemberIDs(random: () => number): number[] {
  const memberCount = MIN_GROUP_MEMBERS + Math.floor(random() * (MAX_EXTRA_GROUP_MEMBERS + 1));
  const idRange = MEASUREMENTS_PER_SEED + MEMBER_ID_OVERSHOOT;
  const members = new Set<number>();
  while (members.size < memberCount) members.add(FIRST_MEASUREMENT_ID + Math.floor(random() * idRange));
  return Array.from(members).sort((a, b) => a - b);
}

function generateErrorSet(seed: number): GeneratedErrorSet {
  const random = seededRandom(seed);
  const rawRows: oracle.RawErrorOccurrenceRow[] = [];
  const typeKeysByMeasurement = new Map<number, number[]>();
  for (let index = 0; index < MEASUREMENTS_PER_SEED; index++) {
    const measurementID = FIRST_MEASUREMENT_ID + index;
    const occurrenceCount = 1 + Math.floor(random() * MAX_OCCURRENCES_PER_MEASUREMENT);
    const types = pickDistinctTypes(random, occurrenceCount);
    types.forEach(type => rawRows.push(toRawOccurrence(measurementID, type)));
    typeKeysByMeasurement.set(
      measurementID,
      types.map(type => type.key).sort((a, b) => a - b)
    );
  }
  const duplicateGroups = Array.from({ length: DUPLICATE_GROUPS_PER_SEED }, (_, groupIndex) => ({
    TreeTag: `D${groupIndex}`,
    StemTag: '1',
    MeasurementIDs: pickMemberIDs(random).join(',')
  }));
  const sameBatchGroups = Array.from({ length: SAME_BATCH_GROUPS_PER_SEED }, (_, groupIndex) => ({
    UploadFileID: `file-${groupIndex}`,
    UploadBatchID: `batch-${groupIndex}`,
    TreeTag: `S${groupIndex}`,
    MeasurementIDs: pickMemberIDs(random).join(',')
  }));
  return { rawRows, typeKeysByMeasurement, duplicateGroups, sameBatchGroups };
}

function fakeExecutor(generated: GeneratedErrorSet) {
  return {
    executeQuery: async (sql: string, params: number[]) => {
      expect(params[SECOND_PARAM_INDEX], 'the oracle must query the generated census').toBe(CENSUS_ID);
      if (sql.includes(DUPLICATE_GROUPS_QUERY_MARKER)) return generated.duplicateGroups;
      if (sql.includes(SAME_BATCH_QUERY_MARKER)) return generated.sameBatchGroups;
      if (sql.includes(RAW_ERRORS_QUERY_MARKER)) return generated.rawRows;
      throw new Error(`Unexpected query in test: ${sql.slice(0, 80)}`);
    }
  } as never;
}

function collapseBySignature(grouped: Map<number, oracle.GroupedErrorRow>, generated: GeneratedErrorSet, catalog: ErrorTypeCatalog): WeightedErrorRow[] {
  const signatureRows: ErrorSignatureRow[] = Array.from(grouped.entries()).map(([measurementID, row]) => ({
    ErrorTypeKeys: (generated.typeKeysByMeasurement.get(measurementID) ?? []).join(','),
    SignatureComplete: SQL_TRUE,
    HasDuplicate: row.baseRow.contradictionTypes.includes('duplicate_tag_stem') ? SQL_TRUE : SQL_FALSE,
    HasSameBatch: row.baseRow.contradictionTypes.includes('same_batch_conflict') ? SQL_TRUE : SQL_FALSE,
    MeasurementCount: SINGLE_MEASUREMENT_WEIGHT
  }));
  const chunkSize = Math.ceil(signatureRows.length / SIGNATURE_CHUNK_COUNT);
  const chunks = Array.from({ length: SIGNATURE_CHUNK_COUNT }, (_, chunkIndex) => signatureRows.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize));
  return toWeightedErrorRows(mergeSignatureRows(chunks), catalog);
}

const FACET_FILTER_CASES: Array<{ name: string; filters: ErrorExplorerFilters }> = [
  ...ERROR_EXPLORER_PRESETS.map(preset => ({ name: `preset ${preset.id}`, filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...preset.filters } })),
  { name: 'source ingestion', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, source: 'ingestion' } },
  { name: 'unknown source', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, source: 'unknown' as never } },
  { name: 'non-array contradictionTypes', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, contradictionTypes: 'duplicate_tag_stem' as never } },
  { name: 'exactMessages does not scope facets', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [SEMICOLON_MESSAGE] } }
];

function firstDifferingFacet(expected: Record<string, unknown>, actual: Record<string, unknown>): string | null {
  return Object.keys(expected).find(facet => !isDeepStrictEqual(expected[facet], actual[facet])) ?? null;
}

describe.each(RANDOM_SEEDS)('weighted facet and message math against the frozen oracle (seed %i)', seed => {
  const generated = generateErrorSet(seed);
  const executor = fakeExecutor(generated);
  const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

  async function weightedRowSets() {
    const grouped = await oracle.fetchGroupedErrorRows(executor, SCHEMA, PLOT_ID, [CENSUS_ID]);
    const perGroupedRow: WeightedErrorRow[] = Array.from(grouped.values()).map(row => ({
      errors: row.allErrors,
      contradictionTypes: row.baseRow.contradictionTypes,
      hasContradiction: row.baseRow.hasContradiction,
      measurementCount: 1
    }));
    const collapsed = collapseBySignature(grouped, generated, catalog);
    return { grouped, perGroupedRow, collapsed };
  }

  it('generates a fixture that exercises every contradiction flag and the no-log type', async () => {
    const { grouped, collapsed } = await weightedRowSets();
    const contradictionTotals = {
      duplicate: Array.from(grouped.values()).filter(row => row.baseRow.contradictionTypes.includes('duplicate_tag_stem')).length,
      sameBatch: Array.from(grouped.values()).filter(row => row.baseRow.contradictionTypes.includes('same_batch_conflict')).length,
      noLog: Array.from(grouped.values()).filter(row => row.allErrors.some(error => error.code === NO_LOG_TYPE.code)).length
    };
    console.log(`[seed ${seed}] measurements ${grouped.size}, weighted signature rows ${collapsed.length}, totals`, contradictionTotals);
    expect(grouped.size).toBe(MEASUREMENTS_PER_SEED);
    expect(contradictionTotals.duplicate).toBeGreaterThan(0);
    expect(contradictionTotals.sameBatch).toBeGreaterThan(0);
    expect(contradictionTotals.noLog).toBeGreaterThan(0);
    expect(collapsed.length, 'collapsing must actually merge measurements').toBeLessThan(grouped.size);
    expect(collapsed.reduce((total, row) => total + row.measurementCount, 0)).toBe(grouped.size);
  });

  it.each(FACET_FILTER_CASES)(
    'computeErrorFacets equals buildErrorExplorerFacets for $name, per grouped row and collapsed by signature',
    async ({ filters }) => {
      const expected = await oracle.buildErrorExplorerFacets(executor, {
        schema: SCHEMA,
        plotID: PLOT_ID,
        censusID: CENSUS_ID,
        censusIDs: [CENSUS_ID],
        filters
      });
      const { perGroupedRow, collapsed } = await weightedRowSets();

      for (const [label, rows] of [
        ['weight 1 per grouped row', perGroupedRow],
        ['collapsed by signature', collapsed]
      ] as const) {
        const actual = computeErrorFacets(rows, filters);
        const differing = firstDifferingFacet(expected as never, actual as never);
        if (differing) {
          console.log(`[seed ${seed}] ${label}: first differing facet "${differing}"`, {
            expected: expected[differing as keyof typeof expected],
            actual: actual[differing as keyof typeof actual]
          });
        }
        expect(actual, `${label}: first differing facet ${differing}`).toEqual(expected);
      }
    }
  );

  it('keeps a message containing a semicolon as one whole facet value', async () => {
    const { collapsed } = await weightedRowSets();

    const facets = computeErrorFacets(collapsed, DEFAULT_ERROR_EXPLORER_FILTERS);

    const messageValues = facets.messages.map(option => option.value);
    console.log(`[seed ${seed}] message facet values`, messageValues);
    expect(messageValues).toContain(SEMICOLON_MESSAGE);
    expect(messageValues).not.toContain('First condition');
    expect(messageValues).not.toContain('second condition');
  });

  it('computeErrorMessageCounts equals buildErrorMessageCounts, per grouped row and collapsed by signature', async () => {
    const expected = await oracle.buildErrorMessageCounts(executor, { schema: SCHEMA, plotID: PLOT_ID, censusIDs: [CENSUS_ID] });
    const { perGroupedRow, collapsed } = await weightedRowSets();

    expect(computeErrorMessageCounts(perGroupedRow), 'weight 1 per grouped row').toEqual(expected);
    expect(computeErrorMessageCounts(collapsed), 'collapsed by signature').toEqual(expected);
  });
});

describe('toSliceBounds', () => {
  const SLICE_PAGES = [0, 1, 2, 3, NaN, 1.5, 0.999, Infinity, 1e15, 1e300];
  const SLICE_PAGE_SIZES = [10, 25, 100, NaN, 10.5];
  const SLICE_LENGTHS = [0, 5, 37, 1000];

  it.each(SLICE_LENGTHS)('selects what Array.prototype.slice selects (length %i)', length => {
    const values = Array.from({ length }, (_, index) => index);
    for (const page of SLICE_PAGES) {
      for (const pageSize of SLICE_PAGE_SIZES) {
        const start = page * pageSize;
        const bounds = toSliceBounds(page, pageSize);
        expect(values.slice(bounds.offset, bounds.offset + bounds.limit), `page ${page}, pageSize ${pageSize}, bounds ${JSON.stringify(bounds)}`).toEqual(
          values.slice(start, start + pageSize)
        );
      }
    }
  });

  it('never returns a negative or non-finite offset or limit', () => {
    for (const page of SLICE_PAGES) {
      for (const pageSize of SLICE_PAGE_SIZES) {
        const bounds = toSliceBounds(page, pageSize);
        expect(Number.isSafeInteger(bounds.offset) && bounds.offset >= 0, `offset for page ${page}, pageSize ${pageSize}`).toBe(true);
        expect(Number.isSafeInteger(bounds.limit) && bounds.limit >= 0, `limit for page ${page}, pageSize ${pageSize}`).toBe(true);
      }
    }
  });
});

describe('parseWholeMemberIDs', () => {
  it.each([
    ['1001,1002,1003', true, [1001, 1002, 1003]],
    ['1001,1002,100', false, [1001, 1002]],
    ['1001,1002,', false, [1001, 1002]],
    ['1001,1002', false, [1001]],
    ['', true, []],
    [null, true, []]
  ])('parseWholeMemberIDs(%j, complete=%s)', (list, complete, expected) => {
    expect(parseWholeMemberIDs(list, complete)).toEqual(expected);
  });

  it('never returns 0 or an ID that is not a whole listed ID, whatever byte the list is cut at', () => {
    const fullList = '1001,1002,1003,2000';
    const fullIDs = fullList.split(',').map(Number);
    for (let cutLength = 0; cutLength < fullList.length; cutLength++) {
      const cutList = fullList.slice(0, cutLength);
      const parsed = parseWholeMemberIDs(cutList, false);
      expect(parsed, `list cut to "${cutList}"`).not.toContain(0);
      parsed.forEach(id => expect(fullIDs, `list cut to "${cutList}" produced ${id}`).toContain(id));
    }
  });

  it('drops the requested measurement from its related IDs', () => {
    expect(buildRelatedMeasurementIDs('1001,1002,1003', true, 1002)).toEqual([1001, 1003]);
    expect(buildRelatedMeasurementIDs('1001,1002,100', false, 1001)).toEqual([1002]);
  });
});

describe('contradiction flag combinations', () => {
  const ALL_TRUE = { none: true, sameBatchOnly: true, duplicateOnly: true, both: true };

  it.each([
    [false, [], ALL_TRUE],
    [true, [], { none: false, sameBatchOnly: true, duplicateOnly: true, both: true }],
    [false, ['duplicate_tag_stem'], { none: false, sameBatchOnly: false, duplicateOnly: true, both: true }],
    [true, ['same_batch_conflict'], { none: false, sameBatchOnly: true, duplicateOnly: false, both: true }],
    [false, ['duplicate_tag_stem', 'same_batch_conflict'], { none: false, sameBatchOnly: true, duplicateOnly: true, both: true }],
    [false, 'duplicate_tag_stem', { none: false, sameBatchOnly: false, duplicateOnly: true, both: true }]
  ])('contradictionOnly %s with contradictionTypes %j', (contradictionOnly, contradictionTypes, expected) => {
    const flags = allowedFlagCombinations({ contradictionOnly, contradictionTypes: contradictionTypes as never });

    console.log('[flags]', { contradictionOnly, contradictionTypes, flags });
    expect(flags).toEqual(expected);
  });

  it('reports whether any combination survives', () => {
    expect(anyFlagCombinationAllowed({ none: false, sameBatchOnly: false, duplicateOnly: false, both: false })).toBe(false);
    expect(anyFlagCombinationAllowed({ none: false, sameBatchOnly: false, duplicateOnly: true, both: false })).toBe(true);
    expect(anyFlagCombinationAllowed(allowedFlagCombinations(DEFAULT_ERROR_EXPLORER_FILTERS))).toBe(true);
  });
});

describe('error type catalog', () => {
  it('throws ErrorTypeCatalogMismatchError on a stored ErrorID that equals the reserved no-log key', () => {
    const rows = toCatalogRows([{ ...CATALOG_TYPES[0], key: NO_LOG_ERROR_TYPE_KEY }]);

    expect(() => buildErrorTypeCatalog(rows)).toThrow(ErrorTypeCatalogMismatchError);
    expect(() => buildErrorTypeCatalog(rows)).toThrow(/reserved for the no-log type/);
  });

  it('adds the synthetic no-log record at key 0', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    expect(catalog.recordsByKey.get(NO_LOG_ERROR_TYPE_KEY)).toEqual({
      source: 'ingestion',
      code: 'failed_no_log',
      message: NO_LOG_ERROR_MESSAGE,
      fields: INGESTION_ERROR_FIELD_MAP['failed_no_log'] ?? [],
      procedureName: '',
      comparison: null
    });
    expect(catalog.recordsByKey.size).toBe(CATALOG_TYPES.length + 1);
  });

  it('derives occurrence fields from criteria, then the validation fallback map, then the ingestion map', () => {
    expect(getOccurrenceFields('validation', '8', 'treeTag; stemTag;treeTag')).toEqual(['treeTag', 'stemTag']);
    expect(getOccurrenceFields('validation', '5', '')).toEqual(['treeTag', 'stemTag']);
    expect(getOccurrenceFields('validation', '21', null)).toEqual(['treeTag', 'speciesCode']);
    expect(getOccurrenceFields('validation', '99', '')).toEqual([]);
    expect(getOccurrenceFields('ingestion', 'MISSING_FIELD_TREETAG', 'ignored')).toEqual(['treeTag']);
    expect(getOccurrenceFields('ingestion', 'UNMAPPED_CODE')).toEqual([]);
  });

  it('records the catalog row procedure name and coerces a string ErrorID', () => {
    const catalog = buildErrorTypeCatalog([{ ...toCatalogRows(CATALOG_TYPES)[0], ErrorID: '1' as never }]);

    expect(catalog.recordsByKey.get(1)?.procedureName).toBe(CATALOG_TYPES[0].procedureName);
  });
});

describe('error type key sets', () => {
  const PREFIX_MESSAGE = 'Species';
  const SUPERSTRING_MESSAGE = 'Species mismatch from previous census';
  const prefixCatalogTypes: ErrorTypeDefinition[] = [
    { key: 1, source: 'validation', code: '3', message: PREFIX_MESSAGE, criteria: 'speciesCode', procedureName: '' },
    { key: 2, source: 'validation', code: '4', message: SUPERSTRING_MESSAGE, criteria: 'speciesCode', procedureName: '' },
    { key: 3, source: 'validation', code: '5', message: SHARED_MESSAGE, criteria: 'treeTag', procedureName: '' }
  ];

  it('default filters keep every key, including the no-log key, and allKeysMatch', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const keySets = computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS);

    console.log('[key sets] default', keySets);
    expect(keySets.allKeysMatch).toBe(true);
    expect(keySets.matchingKeys).toEqual([NO_LOG_ERROR_TYPE_KEY, ...CATALOG_TYPES.map(type => type.key)]);
    expect(keySets.matchingIngestionKeys).toEqual([NO_LOG_ERROR_TYPE_KEY, 7]);
    expect(keySets.matchingValidationKeys).toEqual([1, 2, 3, 4, 5, 6]);
    expect(isImpossibleKeyFilter(keySets)).toBe(false);
  });

  it('an exact message that matches nothing leaves no key and is an impossible filter', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const keySets = computeErrorKeySets(catalog, { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: ['x'] });

    expect(keySets.allKeysMatch).toBe(false);
    expect(keySets.matchingKeys).toEqual([]);
    expect(isImpossibleKeyFilter(keySets)).toBe(true);
  });

  it('an exact message selects both types sharing it, and a source filter splits validation from ingestion', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const bySharedMessage = computeErrorKeySets(catalog, { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [SHARED_MESSAGE] });
    const byIngestion = computeErrorKeySets(catalog, { ...DEFAULT_ERROR_EXPLORER_FILTERS, source: 'ingestion' });

    expect(bySharedMessage.matchingKeys).toEqual([2, 3]);
    expect(bySharedMessage.allKeysMatch).toBe(false);
    expect(byIngestion.matchingKeys).toEqual([NO_LOG_ERROR_TYPE_KEY, 7]);
    expect(byIngestion.matchingValidationKeys).toEqual([]);
  });

  it('affected fields keep only types with one of those fields', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const keySets = computeErrorKeySets(catalog, { ...DEFAULT_ERROR_EXPLORER_FILTERS, affectedFields: ['stemTag'] });

    expect(keySets.allKeysMatch).toBe(false);
    expect(keySets.matchingKeys, 'type 5 lists stemTag in its criteria; type 6 falls back to ["treeTag","stemTag"] for code 5').toEqual([5, 6]);
  });

  it('a non-array exactMessages keeps String.prototype.includes direction: the filter must contain the message', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(prefixCatalogTypes));

    const keySets = computeErrorKeySets(catalog, { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: SHARED_MESSAGE as never });

    console.log('[key sets] string exactMessages matched', keySets.matchingKeys);
    expect(keySets.matchingKeys, 'message "Species" is a substring of the filter, so it matches').toContain(1);
    expect(keySets.matchingKeys, 'message "Species mismatch from previous census" contains the filter, so it does not match').not.toContain(2);
    expect(keySets.matchingKeys, 'the filter contains itself').toContain(3);
  });
});

describe('signature rows', () => {
  interface SignatureOptions {
    keys: string;
    count: number | string;
    complete?: boolean;
    duplicate?: boolean;
    sameBatch?: boolean;
  }
  const signature = ({ keys, count, complete = true, duplicate = false, sameBatch = false }: SignatureOptions): ErrorSignatureRow => ({
    ErrorTypeKeys: keys,
    SignatureComplete: complete ? SQL_TRUE : SQL_FALSE,
    HasDuplicate: duplicate ? SQL_TRUE : SQL_FALSE,
    HasSameBatch: sameBatch ? SQL_TRUE : SQL_FALSE,
    MeasurementCount: count
  });

  it('sums the counts of chunks that share keys, completeness and flags', () => {
    const merged = mergeSignatureRows([
      [signature({ keys: '1,2', sameBatch: true, count: 4 }), signature({ keys: '3', count: '7' })],
      [signature({ keys: '1,2', sameBatch: true, count: '6' })]
    ]);

    console.log('[signatures] merged', merged);
    expect(merged).toHaveLength(2);
    expect(merged.find(row => row.ErrorTypeKeys === '1,2')?.MeasurementCount).toBe(10);
    expect(merged.find(row => row.ErrorTypeKeys === '3')?.MeasurementCount, 'a row that merges with nothing still gets a numeric count').toBe(7);
  });

  it('keeps a complete and an incomplete signature with the same text apart, and different flags apart', () => {
    const merged = mergeSignatureRows([
      [signature({ keys: '1,234', count: 2 })],
      [signature({ keys: '1,234', complete: false, count: 3 })],
      [signature({ keys: '1,234', duplicate: true, count: 5 }), signature({ keys: '1,234', sameBatch: true, count: 11 })]
    ]);

    expect(merged.map(row => [Number(row.SignatureComplete), Number(row.HasDuplicate), Number(row.HasSameBatch), Number(row.MeasurementCount)])).toEqual([
      [SQL_TRUE, SQL_FALSE, SQL_FALSE, 2],
      [SQL_FALSE, SQL_FALSE, SQL_FALSE, 3],
      [SQL_TRUE, SQL_TRUE, SQL_FALSE, 5],
      [SQL_TRUE, SQL_FALSE, SQL_TRUE, 11]
    ]);
    expect(hasIncompleteSignature(merged)).toBe(true);
    expect(hasIncompleteSignature(merged.filter(row => Number(row.SignatureComplete) === SQL_TRUE))).toBe(false);
  });

  it('does not mutate the rows it was given', () => {
    const first = signature({ keys: '1', count: 1 });
    const second = signature({ keys: '1', count: 2 });

    mergeSignatureRows([[first], [second]]);

    expect(first.MeasurementCount).toBe(1);
    expect(second.MeasurementCount).toBe(2);
  });

  it('turns signature rows into weighted rows with decoded contradiction flags', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const weighted = toWeightedErrorRows([signature({ keys: '0,2', duplicate: true, sameBatch: true, count: '9' })], catalog);

    expect(weighted).toHaveLength(1);
    expect(weighted[0].measurementCount).toBe(9);
    expect(weighted[0].contradictionTypes).toEqual(['duplicate_tag_stem', 'same_batch_conflict']);
    expect(weighted[0].hasContradiction).toBe(true);
    expect(weighted[0].errors.map(error => error.code)).toEqual(['failed_no_log', '3']);
  });

  it('throws ErrorTypeCatalogMismatchError naming the keys the catalog does not list', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));
    const rows = [signature({ keys: '1,99', count: 1 }), signature({ keys: '98,1', count: 1 })];

    expect(findMissingErrorTypeKeys(rows, catalog)).toEqual([99, 98]);
    expect(() => toWeightedErrorRows(rows, catalog)).toThrow(ErrorTypeCatalogMismatchError);
    expect(() => toWeightedErrorRows(rows, catalog)).toThrow(/99, 98/);
  });
});

describe('hasLocaleCompareTie', () => {
  const NFC_E_ACUTE = '\u00e9';
  const NFD_E_ACUTE = 'e\u0301';

  it('is true for NFC and NFD forms of one letter with equal counts', () => {
    expect(NFC_E_ACUTE.localeCompare(NFD_E_ACUTE), 'precondition: this runtime treats the two forms as equal').toBe(0);
    expect(
      hasLocaleCompareTie([
        { value: NFC_E_ACUTE, count: 3 },
        { value: NFD_E_ACUTE, count: 3 }
      ])
    ).toBe(true);
  });

  it('is false when the equal-comparing values have different counts', () => {
    expect(
      hasLocaleCompareTie([
        { value: NFC_E_ACUTE, count: 4 },
        { value: NFD_E_ACUTE, count: 3 }
      ])
    ).toBe(false);
  });

  it('is false for distinct values with equal counts, identical values, and short lists', () => {
    expect(
      hasLocaleCompareTie([
        { value: 'a', count: 2 },
        { value: 'b', count: 2 }
      ])
    ).toBe(false);
    expect(
      hasLocaleCompareTie([
        { value: 'a', count: 2 },
        { value: 'a', count: 2 }
      ])
    ).toBe(false);
    expect(hasLocaleCompareTie([{ value: 'a', count: 2 }])).toBe(false);
    expect(hasLocaleCompareTie([])).toBe(false);
  });

  it('finds a tie that is not at the start of the list', () => {
    expect(
      hasLocaleCompareTie([
        { value: 'z', count: 9 },
        { value: 'm', count: 5 },
        { value: NFC_E_ACUTE, count: 2 },
        { value: NFD_E_ACUTE, count: 2 }
      ])
    ).toBe(true);
  });
});
