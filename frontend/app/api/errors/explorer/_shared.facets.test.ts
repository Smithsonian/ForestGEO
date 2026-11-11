import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  type ErrorExplorerFilters,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import { buildErrorExplorerFacets, queryErrorExplorer, type RawErrorOccurrenceRow } from './_shared';
import {
  EXPLORER_TEST_CENSUS_ID,
  EXPLORER_TEST_PLOT_ID,
  EXPLORER_TEST_SCHEMA,
  EXPLORER_TEST_SECOND_CENSUS_ID,
  explorerConnection,
  rawOccurrence,
  type ExplorerConnectionFixture
} from '@/tests/fixtures/errorsexplorer/explorer-connection';

const SHARED_MESSAGE = 'Shared message';
const CODE_A: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_A', message: SHARED_MESSAGE };
const CODE_B: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_B', message: SHARED_MESSAGE };
const VALIDATION_14: ErrorTypeIdentity = { source: 'validation', code: '14', message: 'Attribute code does not exist in attributes table' };
const DUPLICATE: ErrorTypeIdentity = { source: 'ingestion', code: 'DUPLICATE_TAG_STEMTAG', message: 'Duplicate TreeTag/StemTag within upload batch' };
const FALLBACK: ErrorTypeIdentity = { source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE };
const ACTIVE_MEASUREMENTS = 88;
const LARGE_PAGE = 100;

function occurrence(id: number, identity: ErrorTypeIdentity, extra: Partial<RawErrorOccurrenceRow> = {}) {
  return rawOccurrence({ CoreMeasurementID: id, ErrorSource: identity.source, ErrorCode: identity.code, DisplayMessage: identity.message, ...extra });
}

const FIXTURE: ExplorerConnectionFixture = {
  activeMeasurements: ACTIVE_MEASUREMENTS,
  rawRowsByCensus: {
    [EXPLORER_TEST_CENSUS_ID]: [
      occurrence(101, CODE_A, { TreeTag: 'ALPHA' }),
      occurrence(102, CODE_B, { TreeTag: 'BETA' }),
      occurrence(103, VALIDATION_14, { TreeTag: 'GAMMA' }),
      occurrence(103, CODE_A, { TreeTag: 'GAMMA' }),
      occurrence(104, DUPLICATE, { TreeTag: 'DELTA', CoreStemGUID: null }),
      occurrence(105, FALLBACK, { TreeTag: 'EPSILON' })
    ],
    [EXPLORER_TEST_SECOND_CENSUS_ID]: [occurrence(201, VALIDATION_14, { CensusID: EXPLORER_TEST_SECOND_CENSUS_ID, TreeTag: 'ZETA' })]
  },
  duplicateGroupsByCensus: { [EXPLORER_TEST_CENSUS_ID]: [{ TreeTag: 'GAMMA', StemTag: '1', MeasurementIDs: '103,106' }] }
};
const CENSUS_IDS = [EXPLORER_TEST_CENSUS_ID, EXPLORER_TEST_SECOND_CENSUS_ID];

async function facetsFor(filters: Partial<ErrorExplorerFilters> = {}) {
  const { connection, executedQueries } = explorerConnection(FIXTURE);
  const facets = await buildErrorExplorerFacets(connection, {
    schema: EXPLORER_TEST_SCHEMA,
    plotID: EXPLORER_TEST_PLOT_ID,
    censusID: EXPLORER_TEST_CENSUS_ID,
    censusIDs: CENSUS_IDS,
    filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...filters }
  });
  console.log('[view-errors facets]', JSON.stringify({ filters, errorTypes: facets.errorTypes, censusTotals: facets.censusTotals }));
  return { facets, executedQueries };
}

function identityOf({ source, code, message }: ErrorTypeIdentity) {
  return { source, code, message };
}

describe('facets errorTypes (P2-1)', () => {
  it('lists two identities for one message shared by two codes, ordered by count then message, source, code', async () => {
    const { facets } = await facetsFor();
    expect(facets.errorTypes.map(type => [type.code, type.count])).toEqual([
      ['14', 2],
      ['CODE_A', 2],
      ['DUPLICATE_TAG_STEMTAG', 1],
      [FALLBACK_ERROR_CODE, 1],
      ['CODE_B', 1]
    ]);
  });

  it('marks the identity whose rows carry a contradiction', async () => {
    const { facets } = await facetsFor();
    expect(facets.errorTypes.find(type => type.code === '14')?.hasContradiction).toBe(true);
    expect(facets.errorTypes.find(type => type.code === 'CODE_B')?.hasContradiction).toBe(false);
  });

  it("gives DUPLICATE_TAG_STEMTAG's entry the tree and stem tag fields (P2-6)", async () => {
    const { facets } = await facetsFor();
    expect(facets.errorTypes.find(type => type.code === 'DUPLICATE_TAG_STEMTAG')?.fields).toEqual(['treeTag', 'stemTag']);
  });

  it("lists only a mixed-source row's validation identity under Show → Validation", async () => {
    const { facets } = await facetsFor({ source: 'validation' });
    expect(facets.errorTypes.map(identityOf)).toEqual([identityOf(VALIDATION_14)]);
  });

  it('lists both identities sharing a linked message, and nothing else', async () => {
    const { facets } = await facetsFor({ exactMessages: [SHARED_MESSAGE] });
    expect(facets.errorTypes.map(type => type.code)).toEqual(['CODE_A', 'CODE_B']);
  });

  it.each([
    ['the defaults', {}],
    ['Show → Validation', { source: 'validation' as const }],
    ['Show → Contradictions', { contradictionOnly: true }],
    ['a search', { quickSearch: 'gamma' }]
  ])('equals the query totalRows for each identity under %s', async (_label, filters) => {
    const { facets } = await facetsFor(filters);
    for (const type of facets.errorTypes) {
      const { connection } = explorerConnection(FIXTURE);
      const response = await queryErrorExplorer(connection, {
        schema: EXPLORER_TEST_SCHEMA,
        plotID: EXPLORER_TEST_PLOT_ID,
        censusID: EXPLORER_TEST_CENSUS_ID,
        censusIDs: CENSUS_IDS,
        page: 0,
        pageSize: LARGE_PAGE,
        filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...filters },
        errorType: identityOf(type)
      });
      expect(response.totalRows, JSON.stringify({ filters, type })).toBe(type.count);
    }
  });
});

describe('facets censusTotals', () => {
  it('counts the whole error set and ignores every filter', async () => {
    const defaults = (await facetsFor()).facets.censusTotals;
    const narrowed = (await facetsFor({ source: 'validation', quickSearch: 'zeta', exactMessages: [VALIDATION_14.message] })).facets.censusTotals;
    expect(narrowed).toEqual(defaults);
    expect(defaults).toEqual({
      affectedMeasurements: 6,
      activeMeasurements: ACTIVE_MEASUREMENTS,
      errorTypeCount: 5,
      validation: 2,
      ingestion: 5,
      failedMeasurements: 1,
      contradictions: 1,
      duplicateTagStem: 1,
      sameBatchConflict: 0
    });
  });

  it('counts a linked failed_no_log row under ingestion but not as failed (D-d)', async () => {
    const { facets } = await facetsFor();
    expect(facets.censusTotals.failedMeasurements, 'only row 104 has CoreStemGUID NULL').toBe(1);
  });

  it('runs the shared active count over every census ID', async () => {
    const { executedQueries } = await facetsFor();
    const countQuery = executedQueries.find(entry => entry.sql.includes('SELECT COUNT(*) AS n'));
    expect(countQuery?.params).toEqual([EXPLORER_TEST_PLOT_ID, ...CENSUS_IDS]);
  });
});
