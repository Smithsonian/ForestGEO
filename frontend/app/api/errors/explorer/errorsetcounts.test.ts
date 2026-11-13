import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import * as oracle from '../../../../tests/oracles/errors-explorer-legacy';
import {
  applyShowValue,
  buildErrorTypeKey,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERRORS_EXPLORER_SHOW_OPTIONS,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  INGESTION_ERROR_FIELD_MAP,
  type ErrorCensusTotals,
  type ErrorDetailRecord,
  type ErrorExplorerFilters,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import { seededRandom } from '../../../../tests/setup/local-db-setup';
import {
  allowedFlagCombinations,
  anyFlagCombinationAllowed,
  buildErrorTypeCatalog,
  buildRelatedMeasurementIDs,
  computeCensusTotals,
  computeErrorKeySets,
  computeErrorMessageCounts,
  computeErrorTypeFacets,
  ErrorTypeCatalogMismatchError,
  findMissingErrorTypeKeys,
  getOccurrenceFields,
  hasIncompleteSignature,
  hasErrorTypeOrderTie,
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
const FAILED_ROW_MODULUS = 7;
const ACTIVE_MEASUREMENTS = 4321;

const SCHEMA = 'forestgeo_testsite';
const PLOT_ID = 1;
const CENSUS_ID = 11;
const SECOND_PARAM_INDEX = 1;
const RAW_ERRORS_QUERY_MARKER = 'SELECT ms.CoreMeasurementID';
const DUPLICATE_GROUPS_QUERY_MARKER = 'GROUP_CONCAT(DISTINCT ms.CoreMeasurementID';
const SAME_BATCH_QUERY_MARKER = 'GROUP_CONCAT(DISTINCT cm.CoreMeasurementID';
const ACTIVE_COUNT_QUERY_MARKER = 'COUNT(*) AS n';

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

const TIE_MESSAGE = 'Tag already used in plot';
const DBH_SHRANK_MESSAGE = 'DBH shrank between censuses';

const DBH_SHRANK_TYPE: ErrorTypeDefinition = {
  key: 1,
  source: 'validation',
  code: '1',
  message: DBH_SHRANK_MESSAGE,
  criteria: 'measuredDBH',
  procedureName: 'ValidateDBHShrinkage'
};
const DBH_SHRANK_TYPE_DUPLICATE_IDENTITY: ErrorTypeDefinition = { ...DBH_SHRANK_TYPE, key: 8, procedureName: 'ValidateDBHShrinkageLegacy' };
const CODE_TIE_HIGHER_CODE_FIRST: ErrorTypeDefinition = {
  key: 2,
  source: 'validation',
  code: '4',
  message: SHARED_MESSAGE,
  criteria: 'speciesCode',
  procedureName: 'ValidateSpeciesB'
};
const CODE_TIE_LOWER_CODE_SECOND: ErrorTypeDefinition = {
  key: 3,
  source: 'validation',
  code: '3',
  message: SHARED_MESSAGE,
  criteria: 'speciesCode',
  procedureName: 'ValidateSpeciesA'
};
const SOURCE_TIE_VALIDATION: ErrorTypeDefinition = {
  key: 6,
  source: 'validation',
  code: '5',
  message: TIE_MESSAGE,
  criteria: '',
  procedureName: 'ValidateDuplicateTag'
};
const SOURCE_TIE_INGESTION: ErrorTypeDefinition = {
  key: 9,
  source: 'ingestion',
  code: 'DUPLICATE_TREE_TAG',
  message: TIE_MESSAGE,
  criteria: '',
  procedureName: ''
};

/**
 * Types that always travel together, so the pair's counts tie under every filter that keeps both:
 * - one identity through two ErrorIDs (dev's per-measurement dedupe),
 * - two codes with one source and message (the code tie-break; the lower code has the higher key, so insertion order is wrong),
 * - one message under both sources (the source tie-break; the validation type has the lower key, so insertion order is wrong).
 */
const PARITY_TYPE_UNITS: ErrorTypeDefinition[][] = [
  [DBH_SHRANK_TYPE, DBH_SHRANK_TYPE_DUPLICATE_IDENTITY],
  [CODE_TIE_HIGHER_CODE_FIRST, CODE_TIE_LOWER_CODE_SECOND],
  [SOURCE_TIE_VALIDATION, SOURCE_TIE_INGESTION],
  [{ key: 4, source: 'validation', code: '7', message: SEMICOLON_MESSAGE, criteria: 'quadratName', procedureName: 'ValidateSemicolon' }],
  [{ key: 5, source: 'validation', code: '8', message: 'Tag pair is wrong', criteria: 'treeTag;stemTag', procedureName: 'ValidateTagPair' }],
  [{ key: 7, source: 'ingestion', code: 'MISSING_FIELD_TREETAG', message: 'Tree tag is missing', criteria: '', procedureName: '' }],
  [NO_LOG_TYPE]
];

const PARITY_CATALOG_TYPES = PARITY_TYPE_UNITS.flat().filter(type => type.key !== NO_LOG_ERROR_TYPE_KEY);

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

function isFailedMeasurement(measurementID: number): boolean {
  return measurementID % FAILED_ROW_MODULUS === 0;
}

function toRawOccurrence(measurementID: number, type: ErrorTypeDefinition): oracle.RawErrorOccurrenceRow {
  return {
    CoreMeasurementID: measurementID,
    PlotID: PLOT_ID,
    CensusID: CENSUS_ID,
    CoreStemGUID: isFailedMeasurement(measurementID) ? null : measurementID,
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
  const remaining = [...PARITY_TYPE_UNITS];
  return Array.from({ length: count }, () => remaining.splice(Math.floor(random() * remaining.length), 1)[0]).flat();
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
      if (sql.includes(ACTIVE_COUNT_QUERY_MARKER)) return [{ n: ACTIVE_MEASUREMENTS }];
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
    IsFailedRow: row.baseRow.isFailedRow ? SQL_TRUE : SQL_FALSE,
    MeasurementCount: SINGLE_MEASUREMENT_WEIGHT
  }));
  const chunkSize = Math.ceil(signatureRows.length / SIGNATURE_CHUNK_COUNT);
  const chunks = Array.from({ length: SIGNATURE_CHUNK_COUNT }, (_, chunkIndex) => signatureRows.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize));
  return toWeightedErrorRows(mergeSignatureRows(chunks), catalog);
}

const FACET_FILTER_CASES: Array<{ name: string; filters: ErrorExplorerFilters }> = [
  ...ERRORS_EXPLORER_SHOW_OPTIONS.map(option => ({ name: `Show ${option.value}`, filters: applyShowValue(DEFAULT_ERROR_EXPLORER_FILTERS, option.value) })),
  { name: 'unknown source', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, source: 'unknown' as never } },
  { name: 'non-array contradictionTypes', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, contradictionTypes: 'duplicate_tag_stem' as never } },
  { name: 'contradictionTypes same_batch_conflict', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, contradictionTypes: ['same_batch_conflict'] } },
  { name: 'affectedFields treeTag', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, affectedFields: ['treeTag'] } },
  { name: 'exactMessages scopes errorTypes and leaves censusTotals alone', filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [SEMICOLON_MESSAGE] } }
];

function firstDifferingFacet(expected: Record<string, unknown>, actual: Record<string, unknown>): string | null {
  return Object.keys(expected).find(facet => !isDeepStrictEqual(expected[facet], actual[facet])) ?? null;
}

describe.each(RANDOM_SEEDS)('weighted facet and message math against the frozen oracle (seed %i)', seed => {
  const generated = generateErrorSet(seed);
  const executor = fakeExecutor(generated);
  const catalog = buildErrorTypeCatalog(toCatalogRows(PARITY_CATALOG_TYPES));

  async function weightedRowSets() {
    const grouped = await oracle.fetchGroupedErrorRows(executor, SCHEMA, PLOT_ID, [CENSUS_ID]);
    const perGroupedRow: WeightedErrorRow[] = Array.from(grouped.values()).map(row => ({
      errors: row.allErrors,
      contradictionTypes: row.baseRow.contradictionTypes,
      hasContradiction: row.baseRow.hasContradiction,
      isFailedRow: row.baseRow.isFailedRow,
      measurementCount: SINGLE_MEASUREMENT_WEIGHT
    }));
    const collapsed = collapseBySignature(grouped, generated, catalog);
    return { grouped, perGroupedRow, collapsed };
  }

  it('generates a fixture that exercises every contradiction flag and the no-log type', async () => {
    const { grouped, collapsed } = await weightedRowSets();
    const contradictionTotals = {
      duplicate: Array.from(grouped.values()).filter(row => row.baseRow.contradictionTypes.includes('duplicate_tag_stem')).length,
      sameBatch: Array.from(grouped.values()).filter(row => row.baseRow.contradictionTypes.includes('same_batch_conflict')).length,
      noLog: Array.from(grouped.values()).filter(row => row.allErrors.some(error => error.code === NO_LOG_TYPE.code)).length,
      failed: Array.from(grouped.values()).filter(row => row.baseRow.isFailedRow).length
    };
    console.log(`[seed ${seed}] measurements ${grouped.size}, weighted signature rows ${collapsed.length}, totals`, contradictionTotals);
    expect(grouped.size).toBe(MEASUREMENTS_PER_SEED);
    expect(contradictionTotals.duplicate).toBeGreaterThan(0);
    expect(contradictionTotals.sameBatch).toBeGreaterThan(0);
    expect(contradictionTotals.noLog).toBeGreaterThan(0);
    expect(contradictionTotals.failed, 'some measurements must be failed rows').toBeGreaterThan(0);
    expect(contradictionTotals.failed, 'and some must not be').toBeLessThan(grouped.size);
    expect(collapsed.length, 'collapsing must actually merge measurements').toBeLessThan(grouped.size);
    expect(collapsed.reduce((total, row) => total + row.measurementCount, 0)).toBe(grouped.size);
  });

  it('reaches a duplicate identity, a source tie and a code tie in the oracle facets of every seed', async () => {
    const duplicateIdentityKeys = [DBH_SHRANK_TYPE.key, DBH_SHRANK_TYPE_DUPLICATE_IDENTITY.key];
    const measurementsCarryingBothDuplicateKeys = Array.from(generated.typeKeysByMeasurement.values()).filter(keys =>
      duplicateIdentityKeys.every(key => keys.includes(key))
    ).length;
    const { errorTypes } = await oracle.buildErrorExplorerFacets(executor, {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      censusIDs: [CENSUS_ID],
      filters: DEFAULT_ERROR_EXPLORER_FILTERS
    });
    const adjacentTies = errorTypes.flatMap((errorType, index) => {
      const next = errorTypes[index + 1];
      return next !== undefined && next.count === errorType.count && next.message === errorType.message ? [[errorType, next] as const] : [];
    });
    const sourceTies = adjacentTies.filter(([first, second]) => first.source !== second.source);
    const codeTies = adjacentTies.filter(([first, second]) => first.source === second.source && first.code !== second.code);
    console.log(`[seed ${seed}] measurements carrying the duplicate identity twice ${measurementsCarryingBothDuplicateKeys}`, {
      sourceTies: sourceTies.map(pair => pair.map(type => `${type.source}/${type.code}`)),
      codeTies: codeTies.map(pair => pair.map(type => `${type.source}/${type.code}`))
    });
    expect(measurementsCarryingBothDuplicateKeys, 'a measurement must reach one identity through two ErrorIDs').toBeGreaterThan(0);
    expect(sourceTies.length, 'a message shared by both sources with equal counts').toBeGreaterThan(0);
    expect(codeTies.length, 'two codes of one source and message with equal counts').toBeGreaterThan(0);
  });

  it.each(FACET_FILTER_CASES)(
    'computeErrorTypeFacets and computeCensusTotals equal buildErrorExplorerFacets for $name, per grouped row and collapsed by signature',
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
        const actual = { errorTypes: computeErrorTypeFacets(rows, filters), censusTotals: computeCensusTotals(rows, ACTIVE_MEASUREMENTS) };
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

  it('keeps a message containing a semicolon as one whole error type message', async () => {
    const { collapsed } = await weightedRowSets();

    const errorTypes = computeErrorTypeFacets(collapsed, DEFAULT_ERROR_EXPLORER_FILTERS);

    const messageValues = errorTypes.map(errorType => errorType.message);
    console.log(`[seed ${seed}] error type messages`, messageValues);
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

describe('error type key sets for one error type identity', () => {
  const identityOf = (type: ErrorTypeDefinition): ErrorTypeIdentity => ({ source: type.source, code: type.code, message: type.message });
  const SHARED_IDENTITY_CODE = 'SHARED_IDENTITY_CODE';
  const SHARED_IDENTITY_MESSAGE = 'Two catalog rows say this';
  const sharedIdentityTypes: ErrorTypeDefinition[] = [
    { key: 8, source: 'ingestion', code: SHARED_IDENTITY_CODE, message: SHARED_IDENTITY_MESSAGE, criteria: '', procedureName: '' },
    { key: 9, source: 'ingestion', code: SHARED_IDENTITY_CODE, message: SHARED_IDENTITY_MESSAGE, criteria: '', procedureName: '' }
  ];

  it('keeps only the keys whose source, code and message equal the identity, and never matches all keys', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));
    const sharedMessageTypeA = CATALOG_TYPES[1];

    const keySets = computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS, identityOf(sharedMessageTypeA));

    console.log('[key sets] one identity', keySets);
    expect(sharedMessageTypeA.message, 'precondition: another code shares this message').toBe(CATALOG_TYPES[2].message);
    expect(keySets.allKeysMatch, 'an identity restricts the keys even under default filters').toBe(false);
    expect(keySets.matchingKeys).toEqual([sharedMessageTypeA.key]);
    expect(keySets.matchingValidationKeys).toEqual([sharedMessageTypeA.key]);
    expect(keySets.matchingIngestionKeys).toEqual([]);
  });

  it('finds the no-log type by its identity', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const keySets = computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS, {
      source: 'ingestion',
      code: FALLBACK_ERROR_CODE,
      message: FALLBACK_ERROR_MESSAGE
    });

    expect(keySets.matchingKeys).toEqual([NO_LOG_ERROR_TYPE_KEY]);
    expect(keySets.matchingIngestionKeys).toEqual([NO_LOG_ERROR_TYPE_KEY]);
  });

  it('keeps every catalog key that carries the identity when two ErrorIDs normalise to one', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows([...CATALOG_TYPES, ...sharedIdentityTypes]));

    const keySets = computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS, identityOf(sharedIdentityTypes[0]));

    expect(keySets.matchingKeys).toEqual([8, 9]);
    expect(keySets.matchingIngestionKeys).toEqual([8, 9]);
  });

  it('leaves no key when the page filters exclude the identity, so the response is empty', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));
    const validationIdentity = identityOf(CATALOG_TYPES[0]);

    const keySets = computeErrorKeySets(catalog, { ...DEFAULT_ERROR_EXPLORER_FILTERS, source: 'ingestion' }, validationIdentity);

    console.log('[key sets] identity outside the filtered source', keySets);
    expect(keySets.matchingKeys).toEqual([]);
    expect(isImpossibleKeyFilter(keySets)).toBe(true);
  });

  it('compares the message exactly, not by locale or case', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));
    const identity = identityOf(CATALOG_TYPES[0]);

    expect(computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS, { ...identity, message: identity.message.toUpperCase() }).matchingKeys).toEqual([]);
    expect(computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS, { ...identity, code: `${identity.code} ` }).matchingKeys).toEqual([]);
  });

  it('returns the same sets as before when no identity is given', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    expect(computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS, undefined)).toEqual(computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS));
    expect(computeErrorKeySets(catalog, DEFAULT_ERROR_EXPLORER_FILTERS).allKeysMatch).toBe(true);
  });
});

describe('signature rows', () => {
  interface SignatureOptions {
    keys: string;
    count: number | string;
    complete?: boolean;
    duplicate?: boolean;
    sameBatch?: boolean;
    failed?: boolean;
  }
  const signature = ({ keys, count, complete = true, duplicate = false, sameBatch = false, failed = false }: SignatureOptions): ErrorSignatureRow => ({
    ErrorTypeKeys: keys,
    SignatureComplete: complete ? SQL_TRUE : SQL_FALSE,
    HasDuplicate: duplicate ? SQL_TRUE : SQL_FALSE,
    HasSameBatch: sameBatch ? SQL_TRUE : SQL_FALSE,
    IsFailedRow: failed ? SQL_TRUE : SQL_FALSE,
    MeasurementCount: count
  });

  it('sums the counts of chunks that share keys, completeness and flags', () => {
    const merged = mergeSignatureRows([
      [signature({ keys: '1,2', sameBatch: true, count: 4 }), signature({ keys: '3', count: '7' })],
      [signature({ keys: '1,2', sameBatch: true, count: '6' })]
    ]);

    console.log('[signatures] merged', merged);
    expect(merged).toHaveLength(2);
    const mergedRow = merged.find(row => row.ErrorTypeKeys === '1,2');
    expect(mergedRow?.MeasurementCount).toBe(10);
    expect(mergedRow?.HasSameBatch, 'a merged row keeps its same-batch flag').toBe(SQL_TRUE);
    expect(mergedRow?.HasDuplicate, 'a merged row keeps its duplicate flag').toBe(SQL_FALSE);
    expect(mergedRow?.SignatureComplete, 'a merged row keeps its completeness').toBe(SQL_TRUE);
    expect(merged.find(row => row.ErrorTypeKeys === '3')?.MeasurementCount, 'a row that merges with nothing still gets a numeric count').toBe(7);
  });

  it('keeps a failed row and a live row with the same signature apart, and sums failed rows across chunks', () => {
    const merged = mergeSignatureRows([
      [signature({ keys: '4', count: 2 }), signature({ keys: '4', failed: true, count: 3 })],
      [signature({ keys: '4', failed: true, count: '5' }), signature({ keys: '4', count: '11' })]
    ]);

    console.log('[signatures] failed vs live', merged);
    expect(merged.map(row => [Number(row.IsFailedRow), Number(row.MeasurementCount)])).toEqual([
      [SQL_FALSE, 13],
      [SQL_TRUE, 8]
    ]);
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
    expect(weighted[0].isFailedRow).toBe(false);
    expect(weighted[0].errors.map(error => error.code)).toEqual(['failed_no_log', '3']);
  });

  it('decodes the failed-row flag onto the weighted row', () => {
    const catalog = buildErrorTypeCatalog(toCatalogRows(CATALOG_TYPES));

    const weighted = toWeightedErrorRows([signature({ keys: '1', failed: true, count: 4 }), signature({ keys: '1', count: 6 })], catalog);

    expect(weighted.map(row => [row.isFailedRow, row.measurementCount])).toEqual([
      [true, 4],
      [false, 6]
    ]);
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

describe('error type facets and census totals from weighted rows', () => {
  const SHARED_FACET_MESSAGE = 'Shared message';
  const CODE_A: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_A', message: SHARED_FACET_MESSAGE };
  const CODE_B: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_B', message: SHARED_FACET_MESSAGE };
  const VALIDATION_14: ErrorTypeIdentity = { source: 'validation', code: '14', message: 'Attribute code does not exist in attributes table' };
  const DUPLICATE: ErrorTypeIdentity = { source: 'ingestion', code: 'DUPLICATE_TAG_STEMTAG', message: 'Duplicate TreeTag/StemTag within upload batch' };
  const FALLBACK: ErrorTypeIdentity = { source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE };
  const ACTIVE_COUNT = 88;
  const KEY_VALIDATION_14 = 1;
  const KEY_CODE_A = 2;
  const KEY_CODE_B = 3;
  const KEY_DUPLICATE = 4;
  const CATALOG_ROWS: ErrorTypeCatalogRow[] = [
    {
      ErrorID: KEY_VALIDATION_14,
      ErrorSource: 'validation',
      ErrorCode: '14',
      DisplayMessage: VALIDATION_14.message,
      ValidationCriteria: 'attributes',
      ProcedureName: 'ValidateAttributes'
    },
    { ErrorID: KEY_CODE_A, ErrorSource: 'ingestion', ErrorCode: 'CODE_A', DisplayMessage: SHARED_FACET_MESSAGE, ValidationCriteria: '', ProcedureName: '' },
    { ErrorID: KEY_CODE_B, ErrorSource: 'ingestion', ErrorCode: 'CODE_B', DisplayMessage: SHARED_FACET_MESSAGE, ValidationCriteria: '', ProcedureName: '' },
    {
      ErrorID: KEY_DUPLICATE,
      ErrorSource: 'ingestion',
      ErrorCode: 'DUPLICATE_TAG_STEMTAG',
      DisplayMessage: DUPLICATE.message,
      ValidationCriteria: '',
      ProcedureName: ''
    }
  ];
  const catalog = buildErrorTypeCatalog(CATALOG_ROWS);

  function weightedFromSignatures(
    signatureRows: ReadonlyArray<{ keys: number[]; duplicate?: boolean; failed?: boolean; sameBatch?: boolean; count?: number }>
  ): WeightedErrorRow[] {
    return toWeightedErrorRows(
      signatureRows.map(
        ({ keys, duplicate = false, failed = false, sameBatch = false, count = SINGLE_MEASUREMENT_WEIGHT }): ErrorSignatureRow => ({
          ErrorTypeKeys: keys.join(','),
          SignatureComplete: SQL_TRUE,
          HasDuplicate: duplicate ? SQL_TRUE : SQL_FALSE,
          HasSameBatch: sameBatch ? SQL_TRUE : SQL_FALSE,
          IsFailedRow: failed ? SQL_TRUE : SQL_FALSE,
          MeasurementCount: count
        })
      ),
      catalog
    );
  }

  // Six measurements across two censuses: 101 CODE_A, 102 CODE_B, 103 validation 14 + CODE_A in a duplicate group, 104 failed DUPLICATE_TAG_STEMTAG,
  // 105 the linked no-log type (not failed), 201 validation 14.
  const SIX_MEASUREMENTS = weightedFromSignatures([
    { keys: [KEY_CODE_A] },
    { keys: [KEY_CODE_B] },
    { keys: [KEY_VALIDATION_14, KEY_CODE_A], duplicate: true },
    { keys: [KEY_DUPLICATE], failed: true },
    { keys: [NO_LOG_ERROR_TYPE_KEY] },
    { keys: [KEY_VALIDATION_14] }
  ]);

  const countsByCode = (errorTypes: ReturnType<typeof computeErrorTypeFacets>) => errorTypes.map(errorType => [errorType.code, errorType.count]);

  it('lists two identities for one message shared by two codes, ordered by count then message, source, code', () => {
    const errorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, DEFAULT_ERROR_EXPLORER_FILTERS);

    console.log('[error types] default', errorTypes);
    expect(countsByCode(errorTypes)).toEqual([
      ['14', 2],
      ['CODE_A', 2],
      ['DUPLICATE_TAG_STEMTAG', 1],
      [FALLBACK_ERROR_CODE, 1],
      ['CODE_B', 1]
    ]);
  });

  it('marks the identity whose rows carry a contradiction', () => {
    const errorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, DEFAULT_ERROR_EXPLORER_FILTERS);

    expect(errorTypes.find(errorType => errorType.code === '14')?.hasContradiction, 'measurement 103 carries 14 and a duplicate group').toBe(true);
    expect(errorTypes.find(errorType => errorType.code === 'CODE_B')?.hasContradiction).toBe(false);
  });

  it("gives DUPLICATE_TAG_STEMTAG's entry the tree and stem tag fields (P2-6)", () => {
    const errorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, DEFAULT_ERROR_EXPLORER_FILTERS);

    expect(errorTypes.find(errorType => errorType.code === 'DUPLICATE_TAG_STEMTAG')?.fields).toEqual(['treeTag', 'stemTag']);
  });

  it("lists only a mixed-source row's validation identity under Show → Validation", () => {
    const errorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, applyShowValue(DEFAULT_ERROR_EXPLORER_FILTERS, 'validation'));

    console.log('[error types] Show validation', errorTypes);
    expect(errorTypes.map(({ source, code, message }) => ({ source, code, message }))).toEqual([VALIDATION_14]);
    expect(errorTypes[0].count, 'rows 103 and 201; row 101 carries only an ingestion identity').toBe(2);
  });

  it('lists both identities sharing an exact message, and nothing else', () => {
    const errorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [SHARED_FACET_MESSAGE] });

    expect(errorTypes.map(errorType => errorType.code)).toEqual(['CODE_A', 'CODE_B']);
  });

  it('skips a row that the contradiction filter refuses', () => {
    const errorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, applyShowValue(DEFAULT_ERROR_EXPLORER_FILTERS, 'contradictions'));

    expect(countsByCode(errorTypes), 'only measurement 103 is contradicted').toEqual([
      ['14', 1],
      ['CODE_A', 1]
    ]);
  });

  it('adds a measurement weight to an identity once per row and sums the weights of rows', () => {
    const rows = weightedFromSignatures([{ keys: [KEY_CODE_A], count: 40 }, { keys: [KEY_CODE_A, KEY_CODE_B], count: 2 }, { keys: [KEY_CODE_B] }]);

    const errorTypes = computeErrorTypeFacets(rows, DEFAULT_ERROR_EXPLORER_FILTERS);

    expect(countsByCode(errorTypes)).toEqual([
      ['CODE_A', 42],
      ['CODE_B', 3]
    ]);
  });

  it("adds a row's weight once to an identity it carries through two catalog entries", () => {
    const IDENTITY_WEIGHT = 9;
    const record: ErrorDetailRecord = { ...CODE_A, fields: ['treeTag'], procedureName: null, comparison: null };
    const sameIdentityOtherEntry: ErrorDetailRecord = { ...record, fields: ['treeTag', 'stemTag'] };
    const rows: WeightedErrorRow[] = [
      { errors: [record, sameIdentityOtherEntry], contradictionTypes: [], hasContradiction: false, isFailedRow: false, measurementCount: IDENTITY_WEIGHT },
      { errors: [record], contradictionTypes: [], hasContradiction: false, isFailedRow: false, measurementCount: SINGLE_MEASUREMENT_WEIGHT }
    ];

    const errorTypes = computeErrorTypeFacets(rows, DEFAULT_ERROR_EXPLORER_FILTERS);
    const totals = computeCensusTotals(rows, ACTIVE_COUNT);

    console.log('[error types] shared identity', errorTypes, totals);
    expect(errorTypes).toHaveLength(1);
    expect(errorTypes[0].count, 'weight 9 once, plus the weight-one row; twice the weight would be 19').toBe(IDENTITY_WEIGHT + SINGLE_MEASUREMENT_WEIGHT);
    expect(errorTypes[0].fields, 'fields are the union in first-seen order').toEqual(['treeTag', 'stemTag']);
    expect(totals.errorTypeCount, 'one identity however many catalog entries carry it').toBe(1);
  });

  it('counts the whole error set and ignores every filter', () => {
    const narrowedErrorTypes = computeErrorTypeFacets(SIX_MEASUREMENTS, {
      ...DEFAULT_ERROR_EXPLORER_FILTERS,
      source: 'validation',
      exactMessages: [VALIDATION_14.message]
    });

    const totals = computeCensusTotals(SIX_MEASUREMENTS, ACTIVE_COUNT);

    const expectedTotals: ErrorCensusTotals = {
      affectedMeasurements: 6,
      activeMeasurements: ACTIVE_COUNT,
      errorTypeCount: 5,
      validation: 2,
      ingestion: 5,
      failedMeasurements: 1,
      contradictions: 1,
      duplicateTagStem: 1,
      sameBatchConflict: 0
    };
    console.log('[census totals]', totals);
    expect(narrowedErrorTypes[0].count, 'the narrowed list sees only the two measurements carrying validation 14').toBe(2);
    expect(totals).toEqual(expectedTotals);
  });

  it('counts a linked failed_no_log row under ingestion but not as failed (D-d)', () => {
    const noLogOnly = weightedFromSignatures([{ keys: [NO_LOG_ERROR_TYPE_KEY] }]);

    const totals = computeCensusTotals(noLogOnly, ACTIVE_COUNT);

    expect(totals.ingestion).toBe(1);
    expect(totals.failedMeasurements, 'only a row with no stem is failed').toBe(0);
    expect(computeCensusTotals(weightedFromSignatures([{ keys: [NO_LOG_ERROR_TYPE_KEY], failed: true }]), ACTIVE_COUNT).failedMeasurements).toBe(1);
  });

  it('sums every weight into the totals', () => {
    const rows = weightedFromSignatures([
      { keys: [KEY_CODE_A], count: 30 },
      { keys: [KEY_VALIDATION_14, KEY_CODE_A], sameBatch: true, count: 5 },
      { keys: [KEY_DUPLICATE], duplicate: true, sameBatch: true, failed: true, count: 2 }
    ]);

    const totals = computeCensusTotals(rows, ACTIVE_COUNT);

    expect(totals).toEqual({
      affectedMeasurements: 37,
      activeMeasurements: ACTIVE_COUNT,
      errorTypeCount: 3,
      validation: 5,
      ingestion: 37,
      failedMeasurements: 2,
      contradictions: 7,
      duplicateTagStem: 2,
      sameBatchConflict: 7
    });
  });

  it('returns an empty list and all-zero totals for no rows', () => {
    expect(computeErrorTypeFacets([], DEFAULT_ERROR_EXPLORER_FILTERS)).toEqual([]);
    expect(computeCensusTotals([], ACTIVE_COUNT)).toEqual({
      affectedMeasurements: 0,
      activeMeasurements: ACTIVE_COUNT,
      errorTypeCount: 0,
      validation: 0,
      ingestion: 0,
      failedMeasurements: 0,
      contradictions: 0,
      duplicateTagStem: 0,
      sameBatchConflict: 0
    });
  });

  it('keeps error type identities distinct by their serialised source, code and message', () => {
    expect(buildErrorTypeKey(CODE_A)).not.toBe(buildErrorTypeKey(CODE_B));
  });
});

describe('hasErrorTypeOrderTie', () => {
  const NFC_E_ACUTE = '\u00e9';
  const NFD_E_ACUTE = 'e\u0301';
  const facet = (overrides: Partial<ErrorTypeIdentity> & { count?: number }) => ({
    source: 'ingestion' as const,
    code: 'CODE',
    message: 'Message',
    fields: [],
    count: 3,
    hasContradiction: false,
    ...overrides
  });

  it('is true when two distinct identities tie on count, message, source and code under localeCompare', () => {
    expect(NFC_E_ACUTE.localeCompare(NFD_E_ACUTE), 'precondition: this runtime treats the two forms as equal').toBe(0);

    expect(hasErrorTypeOrderTie([facet({ message: NFC_E_ACUTE }), facet({ message: NFD_E_ACUTE })])).toBe(true);
  });

  it('is true for a tie in the code or the source alone, when the other fields and the count tie', () => {
    expect(hasErrorTypeOrderTie([facet({ code: NFC_E_ACUTE }), facet({ code: NFD_E_ACUTE })])).toBe(true);
  });

  it('is false when the tied messages differ by count, by code, or by source', () => {
    expect(hasErrorTypeOrderTie([facet({ message: NFC_E_ACUTE, count: 4 }), facet({ message: NFD_E_ACUTE, count: 3 })])).toBe(false);
    expect(hasErrorTypeOrderTie([facet({ message: NFC_E_ACUTE, code: 'A' }), facet({ message: NFD_E_ACUTE, code: 'B' })])).toBe(false);
    expect(hasErrorTypeOrderTie([facet({ message: NFC_E_ACUTE, source: 'ingestion' }), facet({ message: NFD_E_ACUTE, source: 'validation' })])).toBe(false);
  });

  it('is false for distinct messages with equal counts, identical identities, and short lists', () => {
    expect(hasErrorTypeOrderTie([facet({ message: 'a' }), facet({ message: 'b' })])).toBe(false);
    expect(hasErrorTypeOrderTie([facet({}), facet({})])).toBe(false);
    expect(hasErrorTypeOrderTie([facet({})])).toBe(false);
    expect(hasErrorTypeOrderTie([])).toBe(false);
  });

  it('finds a tie that is not at the start of the list', () => {
    expect(
      hasErrorTypeOrderTie([
        facet({ count: 9 }),
        facet({ count: 5, message: 'm' }),
        facet({ message: NFC_E_ACUTE, count: 2 }),
        facet({ message: NFD_E_ACUTE, count: 2 })
      ])
    ).toBe(true);
  });
});
