import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_EXPLORER_FILTERS, type ErrorExplorerFilters, type ErrorExplorerQueryRequest, type ErrorTypeIdentity } from '@/config/errorsexplorer';
import { buildErrorExportRows, fetchGroupedErrorRows, queryErrorExplorer, groupErrorRowsForTest, type RawErrorOccurrenceRow } from './_shared';
import {
  EXPLORER_TEST_CENSUS_ID,
  EXPLORER_TEST_PLOT_ID,
  EXPLORER_TEST_SCHEMA,
  explorerConnection,
  rawOccurrence,
  type ExplorerConnectionFixture
} from '@/tests/fixtures/errorsexplorer/explorer-connection';

const SHARED_MESSAGE = 'Shared message';
const CODE_A: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_A', message: SHARED_MESSAGE };
const CODE_B: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_B', message: SHARED_MESSAGE };
const VALIDATION_14: ErrorTypeIdentity = { source: 'validation', code: '14', message: 'Attribute code does not exist in attributes table' };
const GROWTH: ErrorTypeIdentity = { source: 'validation', code: '1', message: 'DBH growth exceeds maximum rate of 65 mm' };
const GROUP_SIZE = 25;
const PAGE_SIZE = 10;

function occurrence(id: number, identity: ErrorTypeIdentity, extra: Partial<RawErrorOccurrenceRow> = {}) {
  return rawOccurrence({ CoreMeasurementID: id, ErrorSource: identity.source, ErrorCode: identity.code, DisplayMessage: identity.message, ...extra });
}

function request(overrides: Partial<ErrorExplorerQueryRequest> = {}, filters: Partial<ErrorExplorerFilters> = {}): ErrorExplorerQueryRequest {
  return {
    schema: EXPLORER_TEST_SCHEMA,
    plotID: EXPLORER_TEST_PLOT_ID,
    censusID: EXPLORER_TEST_CENSUS_ID,
    censusIDs: [EXPLORER_TEST_CENSUS_ID],
    page: 0,
    pageSize: PAGE_SIZE,
    filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...filters },
    ...overrides
  };
}

async function query(fixture: ExplorerConnectionFixture, overrides: Partial<ErrorExplorerQueryRequest> = {}, filters: Partial<ErrorExplorerFilters> = {}) {
  const { connection } = explorerConnection(fixture);
  const response = await queryErrorExplorer(connection, request(overrides, filters));
  console.log(
    '[view-errors query]',
    JSON.stringify({ overrides, filters, totalRows: response.totalRows, ids: response.rows.map(row => row.coreMeasurementID) })
  );
  return response;
}

describe('queryErrorExplorer — error-type identity (P2-1)', () => {
  const fixture: ExplorerConnectionFixture = {
    rawRowsByCensus: {
      [EXPLORER_TEST_CENSUS_ID]: [occurrence(101, CODE_A), occurrence(102, CODE_B), occurrence(103, CODE_A), occurrence(103, CODE_B)]
    }
  };

  it('returns only the rows of the requested code when two codes share a message', async () => {
    expect((await query(fixture, { errorType: CODE_A })).rows.map(row => row.coreMeasurementID)).toEqual([103, 101]);
    expect((await query(fixture, { errorType: CODE_B })).rows.map(row => row.coreMeasurementID)).toEqual([103, 102]);
  });

  it('counts every occurrence in totalErrorCount and only the identity in errorCount', async () => {
    const row103 = (await query(fixture, { errorType: CODE_A })).rows.find(row => row.coreMeasurementID === 103);
    expect(row103?.totalErrorCount, 'two codes sharing a message are two errors').toBe(2);
    expect(row103?.errorCount).toBe(1);
    expect(row103?.errorCodes).toEqual(['CODE_A']);
  });
});

describe('buildErrorExportRows — one error type', () => {
  const fixture: ExplorerConnectionFixture = {
    rawRowsByCensus: { [EXPLORER_TEST_CENSUS_ID]: [occurrence(101, CODE_A), occurrence(102, CODE_B), occurrence(103, CODE_A), occurrence(103, CODE_B)] }
  };

  it('exports only the occurrences of the requested identity', async () => {
    const { connection } = explorerConnection(fixture);
    const grouped = await fetchGroupedErrorRows(connection, EXPLORER_TEST_SCHEMA, EXPLORER_TEST_PLOT_ID, [EXPLORER_TEST_CENSUS_ID]);
    const everything = buildErrorExportRows(grouped, DEFAULT_ERROR_EXPLORER_FILTERS);
    const onlyCodeA = buildErrorExportRows(grouped, DEFAULT_ERROR_EXPLORER_FILTERS, CODE_A);
    console.log(
      '[view-errors export]',
      JSON.stringify({
        everything: everything.map(row => [row.CoreMeasurementID, row.ErrorCode]),
        onlyCodeA: onlyCodeA.map(row => [row.CoreMeasurementID, row.ErrorCode])
      })
    );

    expect(everything).toHaveLength(4);
    expect(onlyCodeA.map(row => row.ErrorCode)).toEqual([CODE_A.code, CODE_A.code]);
    expect(onlyCodeA.map(row => row.CoreMeasurementID).sort()).toEqual([101, 103]);
  });
});

describe('queryErrorExplorer — mixed sources under Show → Validation', () => {
  const fixture: ExplorerConnectionFixture = {
    rawRowsByCensus: { [EXPLORER_TEST_CENSUS_ID]: [occurrence(201, VALIDATION_14), occurrence(201, CODE_A)] }
  };

  it('lists the row in its validation identity and not in its ingestion identity', async () => {
    expect((await query(fixture, { errorType: VALIDATION_14 }, { source: 'validation' })).totalRows).toBe(1);
    expect((await query(fixture, { errorType: CODE_A }, { source: 'validation' })).totalRows).toBe(0);
  });
});

describe('queryErrorExplorer — sort and page across the whole group', () => {
  const rows = Array.from({ length: GROUP_SIZE }, (_, index) => occurrence(300 + index, VALIDATION_14, { MeasuredDBH: index + 1 }));
  const blank = occurrence(400, VALIDATION_14, { MeasuredDBH: null });
  const tieA = occurrence(401, VALIDATION_14, { MeasuredDBH: 25 });
  const fixture: ExplorerConnectionFixture = { rawRowsByCensus: { [EXPLORER_TEST_CENSUS_ID]: [...rows, blank, tieA] } };

  it('starts page 1 of a DBH-descending sort with the 11th largest DBH overall', async () => {
    const response = await query(fixture, { errorType: VALIDATION_14, page: 1, sortModel: [{ field: 'measuredDBH', sort: 'desc' }] });
    expect(response.totalRows).toBe(GROUP_SIZE + 2);
    expect(Number(response.rows[0].measuredDBH)).toBe(16);
  });

  it('puts blanks last in both directions and breaks ties by ID ascending', async () => {
    const descending = await query(fixture, { errorType: VALIDATION_14, pageSize: 100, sortModel: [{ field: 'measuredDBH', sort: 'desc' }] });
    const ascending = await query(fixture, { errorType: VALIDATION_14, pageSize: 100, sortModel: [{ field: 'measuredDBH', sort: 'asc' }] });
    expect(
      descending.rows.slice(0, 2).map(row => row.coreMeasurementID),
      'DBH 25 tie'
    ).toEqual([324, 401]);
    expect(descending.rows.at(-1)?.coreMeasurementID).toBe(400);
    expect(ascending.rows.at(-1)?.coreMeasurementID).toBe(400);
  });
});

describe("queryErrorExplorer — default order is today's sortRows (P2-12)", () => {
  const fixture: ExplorerConnectionFixture = {
    rawRowsByCensus: {
      [EXPLORER_TEST_CENSUS_ID]: [
        occurrence(501, VALIDATION_14, { MeasurementDate: '2024-01-01' }),
        occurrence(502, VALIDATION_14, { MeasurementDate: '2024-02-01' }),
        occurrence(502, CODE_A, { MeasurementDate: '2024-02-01' }),
        occurrence(502, CODE_B, { MeasurementDate: '2024-02-01' })
      ]
    }
  };

  it('orders a three-occurrence row before a one-occurrence row although both show errorCount 1 in the group', async () => {
    const response = await query(fixture, { errorType: VALIDATION_14 });
    expect(response.rows.map(row => [row.coreMeasurementID, row.errorCount, row.totalErrorCount])).toEqual([
      [502, 1, 3],
      [501, 1, 1]
    ]);
    const grouped = Array.from(groupErrorRowsForTest(fixture.rawRowsByCensus[EXPLORER_TEST_CENSUS_ID], new Map()).values());
    const todaysOrder = [...grouped].sort((a, b) => b.allErrors.length - a.allErrors.length).map(row => row.baseRow.coreMeasurementID);
    expect(response.rows.map(row => row.coreMeasurementID)).toEqual(todaysOrder);
  });
});

describe('queryErrorExplorer — column filters before pagination', () => {
  const fixture: ExplorerConnectionFixture = {
    rawRowsByCensus: {
      [EXPLORER_TEST_CENSUS_ID]: [
        occurrence(601, VALIDATION_14, { TreeTag: 'ALPHA-1', SpeciesCode: 'ACERRU' }),
        occurrence(602, VALIDATION_14, { TreeTag: 'alpha-2', SpeciesCode: 'QUERCO' }),
        occurrence(603, VALIDATION_14, { TreeTag: 'BETA-3', SpeciesCode: 'ACERRU' })
      ]
    }
  };

  it('reflects the filter in totalRows and ANDs it with Search', async () => {
    const filtered = await query(fixture, { errorType: VALIDATION_14, columnFilters: [{ field: 'treeTag', operator: 'startsWith', value: 'alpha' }] });
    expect(filtered.totalRows).toBe(2);
    const searched = await query(
      fixture,
      { errorType: VALIDATION_14, columnFilters: [{ field: 'treeTag', operator: 'startsWith', value: 'alpha' }] },
      { quickSearch: 'ACERRU' }
    );
    expect(searched.rows.map(row => row.coreMeasurementID)).toEqual([601]);
  });
});

describe('queryErrorExplorer — prior DBH and Change (P2-10)', () => {
  const fixture: ExplorerConnectionFixture = {
    rawRowsByCensus: {
      [EXPLORER_TEST_CENSUS_ID]: [
        occurrence(701, GROWTH, { MeasuredDBH: 120.06, PriorDBH: '100.000000', PriorCensusID: 4 }),
        occurrence(702, GROWTH, { MeasuredDBH: 120.04, PriorDBH: 100, PriorCensusID: 4 }),
        occurrence(703, GROWTH, { MeasuredDBH: 50, PriorDBH: null }),
        occurrence(704, GROWTH, { MeasuredDBH: 50, PriorDBH: 0, PriorCensusID: 4 })
      ]
    }
  };

  it('computes the rounded percent and leaves it blank without a usable prior', async () => {
    const response = await query(fixture, { errorType: GROWTH, pageSize: 100 });
    const byID = Object.fromEntries(response.rows.map(row => [row.coreMeasurementID, row.dbhChangePercent]));
    expect(byID).toEqual({ 701: 20.1, 702: 20, 703: null, 704: null });
  });

  it.each([
    [{ field: 'priorDBH', operator: 'isEmpty' }, [703]],
    [{ field: 'priorDBH', operator: 'isNotEmpty' }, [701, 702, 704]],
    [{ field: 'priorDBH', operator: '!=', value: 100 }, [703, 704]],
    [{ field: 'priorDBH', operator: '>', value: 0 }, [701, 702]],
    [{ field: 'dbhChangePercent', operator: '>', value: 20 }, [701]]
  ] as const)('%j → %j', async (filter, expected) => {
    const response = await query(fixture, { errorType: GROWTH, pageSize: 100, columnFilters: [filter] });
    expect(response.rows.map(row => row.coreMeasurementID).sort()).toEqual([...expected].sort());
  });
});

describe('queryErrorExplorer — DUPLICATE_TAG_STEMTAG fields (P2-6)', () => {
  it('highlights the tree and stem tag columns', async () => {
    const duplicate: ErrorTypeIdentity = { source: 'ingestion', code: 'DUPLICATE_TAG_STEMTAG', message: 'Duplicate TreeTag/StemTag within upload batch' };
    const response = await query({ rawRowsByCensus: { [EXPLORER_TEST_CENSUS_ID]: [occurrence(801, duplicate)] } }, { errorType: duplicate });
    expect(response.rows[0].errorFields).toEqual(['treeTag', 'stemTag']);
  });
});
