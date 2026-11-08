import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// Import after mocks
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { UNSUPPORTED_LOGIC_OPERATOR_MESSAGE } from '@/components/processors/processormacros';
import ailogger from '@/ailogger';

// -------------------- hoisted spies (safe for vi.mock factories) --------------------
const { mapDataSpy, singlePostSpy, filterStubSpy, searchStubSpy } = vi.hoisted(() => ({
  mapDataSpy: vi.fn((rows: any[]) => rows),
  singlePostSpy: vi.fn(async () => new Response(JSON.stringify({ delegated: true }), { status: 201 })),
  filterStubSpy: vi.fn(() => 'FILTER_STUB'),
  searchStubSpy: vi.fn(() => 'SEARCH_STUB')
}));

// -------------------- mocks (must be before importing the route) --------------------
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params: any[]) => `FORMATTED_SQL:${sql}::PARAMS:${JSON.stringify(params)}`;
  return { format };
});

vi.mock('@/config/datamapper', () => ({
  default: { getMapper: vi.fn(() => ({ mapData: mapDataSpy })) }
}));

vi.mock('@/components/processors/processormacros', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/processors/processormacros')>()),
  buildFilterModelStub: filterStubSpy,
  buildSearchStub: searchStubSpy
}));

vi.mock('@/config/macros/coreapifunctions', () => ({
  POST: singlePostSpy,
  PATCH: vi.fn(),
  DELETE: vi.fn()
}));

// Mock schema validation to accept test schemas. safeFormatQuery mirrors the real
// implementation's ?? -> escaped-identifier substitution so finishedQuery
// assertions reflect the backtick-wrapped schema the route now emits.
vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: vi.fn((schema: string) => {
    return [
      'myschema',
      'testschema',
      'schema_a',
      'schema_b',
      'schema_c',
      'schema_d',
      'vd_sort',
      'vd_status',
      'vd_search',
      'vd_view',
      'vd_staging',
      'vd_rank',
      'vd_export',
      'vd_stemstatus'
    ].includes(schema);
  }),
  safeFormatQuery: vi.fn((schema: string, query: string) => query.replace(/\?\?/g, `\`${schema}\``))
}));

// Mock logger
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// withRouteAuthz calls auth(); a 'global' session clears the per-site gate so
// these handler-behavior tests exercise the wrapped POST end-to-end.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  // Try to reuse your test setup's singleton if present
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}) as any);
  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance?.()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance?.()) ||
    actual?.default ||
    actual;

  // Either use the real test instance or stub a safe default
  const instance = (candidate && typeof candidate.executeQuery === 'function' && typeof candidate.closeConnection === 'function' && candidate) || {
    executeQuery: vi.fn(async () => []),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// -------------------- helpers --------------------
function makeRequest(body: unknown) {
  return new Request('http://localhost/api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
}

function makeProps(dataType: string, slugs?: string[]) {
  return { params: Promise.resolve({ dataType, slugs }) } as any;
}

// A minimal filter model used in most tests
const baseFilterModel = {
  items: [{ field: 'any', operator: 'contains', value: 'x' }],
  quickFilterValues: ['abc'],
  visible: [],
  tss: []
};

describe('POST /api/fixeddatafilter/[dataType]/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to SINGLEPOST if body.newRow is truthy', async () => {
    const req = makeRequest({ newRow: { some: 'data' } });
    const props = makeProps('species', ['myschema', '0', '25', '101', '9']);

    const res = await POST(req, props);
    expect(singlePostSpy).toHaveBeenCalledTimes(1);
    // Same args forwarded
    const [forwardReq, forwardProps] = singlePostSpy.mock.calls[0] as any[];
    expect(forwardReq).toBe(req);
    expect(forwardProps).toBe(props);
    expect(forwardReq.bodyUsed).toBe(false);
    await expect(forwardReq.clone().json()).resolves.toEqual({ newRow: { some: 'data' } });

    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toEqual({ delegated: true });
  });

  it('returns 400 if slugs missing or fewer than 3', async () => {
    // slugs undefined => no schema at slugs[0], so withRouteAuthz rejects at the
    // guard (INVALID_SCHEMA) before the handler's own slug-count check runs.
    const res1 = await POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', undefined as any));
    expect(res1.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body1 = await res1.json();
    expect(body1.code).toBe('INVALID_SCHEMA');

    // A valid schema at slugs[0] passes the guard, so the handler's slug-count
    // check is what returns the 400 here.
    const res2 = await POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', ['myschema', '0']));
    expect(res2.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/slugs not received/i);
  });

  it('returns 400 if core slugs schema/page/pageSize invalid', async () => {
    // Undefined schema slug is rejected by the guard (INVALID_SCHEMA) first.
    const res1 = await POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', [undefined as any, '0', '25', '1', '2']));
    expect(res1.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body1 = await res1.json();
    expect(body1.code).toBe('INVALID_SCHEMA');

    const res2 = await POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', ['myschema', undefined as any, '25', '1', '2']));
    expect(res2.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/core slugs/i);

    const res3 = await POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', ['myschema', '0', 'undefined', '1', '2']));
    expect(res3.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body3 = await res3.json();
    expect(body3.error).toMatch(/core slugs/i);
  });

  it('sitespecificvalidations: builds WHERE with search+filter, paginates, maps rows, and closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) column introspection via INFORMATION_SCHEMA
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'ColA' }, { COLUMN_NAME: 'ColB' }]);
    // 2) paginated results (consumed by Promise.all)
    exec.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    // 3) count query (consumed by Promise.all)
    exec.mockResolvedValueOnce([{ totalRows: 2 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const PAGE = 1;
    const PAGE_SIZE = 50;
    const res = await POST(req, makeProps('sitespecificvalidations', ['myschema', String(PAGE), String(PAGE_SIZE), '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([{ id: 1 }, { id: 2 }]);
    expect(body.totalCount).toBe(2);

    // finishedQuery shows our prepared query + params
    expect(String(body.finishedQuery)).toMatch(/FORMATTED_SQL:/);
    expect(String(body.finishedQuery)).toMatch(/FROM `myschema`\.sitespecificvalidations/);
    // LIMIT params: page*pageSize=50, pageSize=50
    const expectedOffset = PAGE * PAGE_SIZE;
    expect(String(body.finishedQuery)).toMatch(new RegExp(`::PARAMS:\\[${expectedOffset},${PAGE_SIZE}\\]$`));

    // The route does not use transactions -- it executes queries directly and closes the connection
    expect(close).toHaveBeenCalledTimes(1);

    // filter/search builders used
    expect(searchStubSpy).toHaveBeenCalled();
    expect(filterStubSpy).toHaveBeenCalled();
    expect(mapDataSpy).toHaveBeenCalled();
  });

  it('measurementssummaryview: respects visible + tss filters and closes connection', async () => {
    // Use a unique schema to avoid column cache collisions with other tests
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) column introspection via INFORMATION_SCHEMA
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'MeasurementDate' }]);
    // 2) paginated results (consumed by Promise.all)
    exec.mockResolvedValueOnce([{ CoreMeasurementID: 10 }]);
    // 3) count query (consumed by Promise.all)
    exec.mockResolvedValueOnce([{ totalRows: 1 }]);

    const filterModel = {
      items: [{ field: 'foo', operator: 'contains', value: 'bar' }],
      quickFilterValues: ['needle'],
      visible: ['valid', 'pending'],
      tss: ['multi stem', 'old tree']
    };

    const req = makeRequest({ filterModel });
    const res = await POST(req, makeProps('measurementssummaryview', ['schema_a', '0', '25', '101', '7']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([{ CoreMeasurementID: 10 }]);
    expect(body.totalCount).toBe(1);

    // The paginated query is the second executeQuery call (first of the Promise.all pair)
    const [, paginatedSQL] = exec.mock.calls;
    const sqlStr = String(paginatedSQL);
    // Verify visible filter conditions were embedded via buildMeasurementVisibleClauseSql
    expect(sqlStr).toMatch(/measurement_error_log mel/);
    expect(sqlStr).toMatch(/IsValidated = TRUE AND NOT EXISTS/);
    expect(sqlStr).toMatch(/IsValidated IS NULL AND NOT EXISTS/);
    // Verify TSS filter conditions
    expect(sqlStr).toMatch(/JSON_CONTAINS\(UserDefinedFields, JSON_QUOTE\('multi stem'\), '\$\.treestemstate'\)/);
    expect(sqlStr).toMatch(/JSON_CONTAINS\(UserDefinedFields, JSON_QUOTE\('old tree'\), '\$\.treestemstate'\)/);

    // The route does not use transactions
    expect(close).toHaveBeenCalledTimes(1);
    expect(mapDataSpy).toHaveBeenCalled();
  });

  it('measurementssummaryview: returns no rows when visible filters are all disabled', async () => {
    // Use a different schema from the previous measurementssummaryview test to avoid column cache hits
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    vi.spyOn(cm, 'closeConnection');

    // 1) column introspection via INFORMATION_SCHEMA (cache miss due to unique schema)
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'MeasurementDate' }]);
    // 2) paginated results (consumed by Promise.all)
    exec.mockResolvedValueOnce([]);
    // 3) count query (consumed by Promise.all)
    exec.mockResolvedValueOnce([{ totalRows: 0 }]);

    const req = makeRequest({
      filterModel: {
        items: [{ field: 'any', operator: 'contains', value: 'x' }],
        quickFilterValues: ['abc'],
        visible: [],
        tss: ['multi stem']
      }
    });

    const res = await POST(req, makeProps('measurementssummaryview', ['schema_b', '0', '25', '101', '7']));
    expect(res.status).toBe(HTTPResponses.OK);

    // The paginated query is the second executeQuery call
    const [, paginatedSQL] = exec.mock.calls;
    const sqlStr = String(paginatedSQL);
    // Empty visible array triggers the "always false" clause from buildMeasurementVisibleClauseSql
    expect(sqlStr).toMatch(/AND 1 = 0/);
  });

  it('coremeasurements: when multiple census IDs, returns deprecated filtered subset and closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) column introspection via INFORMATION_SCHEMA
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'MeasurementDate' }]);
    // 2) censusQuery -> multiple census IDs (triggers deprecated-row logic)
    exec.mockResolvedValueOnce([{ CensusID: 100 }, { CensusID: 90 }, { CensusID: 80 }]);
    // 3) paginated results (mix of current & past census rows, with overlapping keys)
    exec.mockResolvedValueOnce([
      // Current census (100)
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemGUID: 111, CensusID: 100 },
      // Past census rows (should be deprecated if same key combo)
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemGUID: 111, CensusID: 90 }, // same key -> deprecated
      { PlotID: 7, QuadratID: 2, TreeID: 12, StemGUID: 112, CensusID: 80 } // different key -> filtered out
    ]);
    // 4) count query
    exec.mockResolvedValueOnce([{ totalRows: 3 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('coremeasurements', ['schema_c', '0', '25', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemGUID: 111, CensusID: 100 },
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemGUID: 111, CensusID: 90 },
      { PlotID: 7, QuadratID: 2, TreeID: 12, StemGUID: 112, CensusID: 80 }
    ]);
    // Only deprecated rows whose key combo appears in the full output set
    // pastCensusIDs = [90, 80], so both past-census rows are candidates;
    // both have key combos present in output, so both appear in deprecated
    expect(body.deprecated).toEqual([
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemGUID: 111, CensusID: 90 },
      { PlotID: 7, QuadratID: 2, TreeID: 12, StemGUID: 112, CensusID: 80 }
    ]);
    expect(body.totalCount).toBe(3);

    // The route does not use transactions
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('failedmeasurements: uses hardcoded columns and builds subquery with buildFailedMeasurementsSelectQuery', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    // failedmeasurements skips column introspection (hardcoded column list in route).
    // Only two executeQuery calls happen via Promise.all: paginated results + count.
    exec.mockResolvedValueOnce([{ FailedMeasurementID: 1, Description: 'Detailed reason' }]);
    exec.mockResolvedValueOnce([{ totalRows: 1 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('failedmeasurements', ['myschema', '0', '25', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([{ FailedMeasurementID: 1, Description: 'Detailed reason' }]);
    // The query should include the subquery from buildFailedMeasurementsSelectQuery
    // which aliases cm.Description AS Description
    expect(String(body.finishedQuery)).toContain('cm.Description AS Description');

    // The route does not use transactions
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('viewfulltable: uses deterministic CoreMeasurementID ordering for filtered paginated chunks', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');

    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'CoreMeasurementID' }]);
    exec.mockResolvedValueOnce([{ CoreMeasurementID: 10 }]);
    exec.mockResolvedValueOnce([{ totalRows: 1 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('viewfulltable', ['myschema', '0', '25', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();

    expect(String(body.finishedQuery)).toMatch(/ORDER BY CoreMeasurementID ASC\s+LIMIT/i);
    expect(String(body.finishedQuery)).toMatch(/::PARAMS:\[7,3,0,25\]/);
  });

  it('personnel: finishedQuery binds census before plot for CensusActive', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');

    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'FirstName' }, { COLUMN_NAME: 'LastName' }]);
    exec.mockResolvedValueOnce([{ PersonnelID: 1, CensusActive: 1 }]);
    exec.mockResolvedValueOnce([{ totalRows: 1 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('personnel', ['myschema', '2', '50', '77', '9']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(String(body.finishedQuery)).toMatch(/FROM `myschema`\.personnel p/i);
    expect(String(body.finishedQuery)).toMatch(/::PARAMS:\[9,77,100,50\]/);
  });

  it('returns 500 if a DB error occurs during query execution; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) column introspection succeeds
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'ColX' }]);
    // 2) Promise.all queries -- first one throws
    exec.mockRejectedValueOnce(new Error('kapow'));

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('species', ['schema_d', '0', '25', '1', '2']));

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.error).toMatch(/kapow/i);

    // The route does not use transactions -- errors are caught and connection is closed in finally
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('POST fixeddatafilter — measurementssummary (View Data)', () => {
  const ALL_VISIBLE = ['errors', 'valid', 'pending'];
  const ALL_TSS = ['old tree', 'multi stem', 'new recruit'];
  const SEARCH_AND_FILTER_MODEL = {
    items: [{ field: 'treeTag', operator: 'equals', value: 'T01' }],
    quickFilterValues: ['abc'],
    visible: ALL_VISIBLE,
    tss: ALL_TSS
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function post(
    dataType: string,
    schemaName: string,
    body: Record<string, unknown>,
    rows: Record<string, unknown>[] = [{ CoreMeasurementID: 10, MeasurementStatusRank: 0, HasContradiction: 1 }]
  ) {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    exec.mockReset();
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'TreeTag' }]);
    exec.mockResolvedValueOnce(rows);
    exec.mockResolvedValueOnce([{ totalRows: rows.length }]);
    const res = await POST(makeRequest(body), makeProps(dataType, [schemaName, '0', '25', '101', '7']));
    const json = await res.json();
    const paginatedSQL = String(exec.mock.calls[1]?.[0] ?? '');
    console.log(`[fixeddatafilter ${dataType}]`, JSON.stringify({ status: res.status, calls: exec.mock.calls.length, json: json.error ?? json.output }));
    return { res, json, exec, paginatedSQL };
  }

  it.each([
    [
      'an unknown sort field',
      'vd_sort',
      { filterModel: SEARCH_AND_FILTER_MODEL, sortModel: [{ field: 'coreMeasurementID', sort: 'asc' }] },
      'Unsupported sort field'
    ],
    ['a bad sort direction', 'vd_sort', { filterModel: SEARCH_AND_FILTER_MODEL, sortModel: [{ field: 'treeTag', sort: 'up' }] }, 'Unsupported sort field'],
    [
      'an untranslated stemState filter item',
      'vd_sort',
      { filterModel: { ...SEARCH_AND_FILTER_MODEL, items: [{ field: 'stemState', operator: 'is', value: 'old tree' }] } },
      'Unsupported filter field'
    ],
    ['an unknown stem status', 'vd_stemstatus', { filterModel: { ...SEARCH_AND_FILTER_MODEL, stemStatus: ['zombie'] } }, 'Unsupported stem status'],
    ['visible sent as a string', 'vd_sort', { filterModel: { ...SEARCH_AND_FILTER_MODEL, visible: 'errors' } }, 'Unsupported visibility filter'],
    ['an unknown visible entry', 'vd_sort', { filterModel: { ...SEARCH_AND_FILTER_MODEL, visible: ['errors', 'bogus'] } }, 'Unsupported visibility filter'],
    ['tss sent as a string', 'vd_sort', { filterModel: { ...SEARCH_AND_FILTER_MODEL, tss: 'old tree' } }, 'Unsupported stem state filter'],
    ['an unknown tss entry', 'vd_sort', { filterModel: { ...SEARCH_AND_FILTER_MODEL, tss: ['old tree', 'bogus'] } }, 'Unsupported stem state filter'],
    ['quickFilterValues sent as a string', 'vd_sort', { filterModel: { ...SEARCH_AND_FILTER_MODEL, quickFilterValues: 'abc' } }, 'Unsupported quick filter'],
    [
      'a non-string quickFilterValues entry',
      'vd_sort',
      { filterModel: { ...SEARCH_AND_FILTER_MODEL, quickFilterValues: ['abc', 7] } },
      'Unsupported quick filter'
    ]
  ])('returns 400 for %s and runs no SQL', async (_label, schemaName, body, message) => {
    const { res, json, exec } = await post('measurementssummary', schemaName, body);
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(json.error).toBe(message);
    expect(exec).not.toHaveBeenCalled();
  });

  it('ANDs search and filter, adds the projection, the status ORDER BY and the Stem status clause', async () => {
    const { res, paginatedSQL } = await post('measurementssummary', 'vd_status', {
      filterModel: { ...SEARCH_AND_FILTER_MODEL, stemStatus: ['dead'] },
      sortModel: [{ field: 'measurementStatus', sort: 'desc' }]
    });
    expect(res.status).toBe(HTTPResponses.OK);
    expect(paginatedSQL).toMatch(/AND \(SEARCH_STUB\)\s+AND \(FILTER_STUB\)/);
    expect(paginatedSQL).not.toContain('SEARCH_STUB OR FILTER_STUB');
    expect(paginatedSQL).toContain('AS MeasurementStatusRank');
    expect(paginatedSQL).toContain('ORDER BY MeasurementStatusRank DESC, vft.CoreMeasurementID ASC');
    expect(paginatedSQL).toContain("sf_attr.Status IN ('dead')");
  });

  it('sorts by stem state through JSON_UNQUOTE with blanks last', async () => {
    const { paginatedSQL } = await post('measurementssummary', 'vd_sort', {
      filterModel: SEARCH_AND_FILTER_MODEL,
      sortModel: [{ field: 'stemState', sort: 'asc' }]
    });
    expect(paginatedSQL).toContain("ORDER BY (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(vft.UserDefinedFields, '$.treestemstate')), '') IS NULL)");
  });

  it.each([
    ['measurementssummaryview', 'vd_view'],
    ['measurementssummary_staging', 'vd_staging']
  ])('%s keeps today: search OR filter, no projection, fixed date order', async (dataType, schemaName) => {
    const { paginatedSQL } = await post(dataType, schemaName, {
      filterModel: SEARCH_AND_FILTER_MODEL,
      sortModel: [{ field: 'measurementStatus', sort: 'desc' }]
    });
    expect(paginatedSQL).toContain('(SEARCH_STUB OR FILTER_STUB)');
    expect(paginatedSQL).not.toContain('MeasurementStatusRank');
    expect(paginatedSQL).toContain('ORDER BY vft.MeasurementDate ASC');
  });

  it('maps the rank to MeasurementStatus before mapping and returns a boolean HasContradiction', async () => {
    const { json } = await post('measurementssummary', 'vd_rank', { filterModel: SEARCH_AND_FILTER_MODEL });
    expect(json.output).toEqual([{ CoreMeasurementID: 10, MeasurementStatus: 'ingestionFailed', HasContradiction: true }]);
  });

  it('returns a projection-free finishedQuery ordered by date for CSV export', async () => {
    const { json } = await post('measurementssummary', 'vd_export', {
      filterModel: SEARCH_AND_FILTER_MODEL,
      sortModel: [{ field: 'treeTag', sort: 'desc' }]
    });
    console.log('[fixeddatafilter] finishedQuery', json.finishedQuery);
    expect(json.finishedQuery).not.toContain('MeasurementStatusRank');
    expect(json.finishedQuery).toMatch(/ORDER BY vft\.MeasurementDate ASC LIMIT \?, \?;/);
  });

  it('counts three copies of one tss state as one state: the stem state predicate stays', async () => {
    const { res, paginatedSQL } = await post('measurementssummary', 'vd_search', {
      filterModel: { ...SEARCH_AND_FILTER_MODEL, tss: ['old tree', 'old tree', 'old tree'] }
    });
    expect(res.status).toBe(HTTPResponses.OK);
    expect(paginatedSQL).toContain("JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('old tree'), '$.treestemstate') = 1");
  });

  it('warns about a rejected logic operator for measurementssummary as it does for every other data type', async () => {
    const { res, json, exec } = await post('measurementssummary', 'vd_search', {
      filterModel: { ...SEARCH_AND_FILTER_MODEL, logicOperator: ') OR (1=1) OR (' }
    });
    console.log('[fixeddatafilter] warn calls', JSON.stringify(vi.mocked(ailogger.warn).mock.calls));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(json).toEqual({ error: UNSUPPORTED_LOGIC_OPERATOR_MESSAGE });
    expect(exec).not.toHaveBeenCalled();
    expect(ailogger.warn).toHaveBeenCalledWith('[fixeddatafilter API] rejected an unsupported filter logic operator for measurementssummary');
  });
});

describe('logicOperator guard (SQL injection)', () => {
  const GUARD_TEST_SCHEMA = 'testschema';
  const HOSTILE_LOGIC_OPERATOR = ') OR (1=1) OR (';
  const CONTROL_DATA_TYPE = 'sitespecificvalidations';
  // Every entry of the route's ALLOWED_DATA_TYPES, so no branch is left out.
  const DATA_TYPES = [
    'sitespecificvalidations',
    'failedmeasurements',
    'attributes',
    'species',
    'stems',
    'alltaxonomiesview',
    'stemtaxonomiesview',
    'roles',
    'personnel',
    'unifiedchangelog',
    'quadrats',
    'census',
    'measurementssummary',
    'measurementssummary_staging',
    'measurementssummaryview',
    'viewfulltable',
    'viewfulltableview',
    'coremeasurements'
  ] as const;
  const filterBody = (logicOperator: string) => ({
    filterModel: {
      items: [
        { field: 'treeTag', operator: 'equals', value: '010203' },
        { field: 'stemTag', operator: 'equals', value: '1' }
      ],
      quickFilterValues: [],
      logicOperator
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('control: the same fixture with a valid operator passes authorization and reaches the handler', async () => {
    const executeQuerySpy = vi
      .spyOn((ConnectionManager as any).getInstance(), 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'TreeTag' }, { COLUMN_NAME: 'StemTag' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ totalRows: 0 }]);
    const response = await POST(makeRequest(filterBody('and')), makeProps(CONTROL_DATA_TYPE, [GUARD_TEST_SCHEMA, '0', '10', '1', '1']));
    const json = await response.json();
    console.log('[fixeddatafilter guard] control', response.status, JSON.stringify(json), 'queries', executeQuerySpy.mock.calls.length);
    expect(json.code).not.toBe('INVALID_SCHEMA');
    expect(response.status).toBe(HTTPResponses.OK);
    expect(executeQuerySpy).toHaveBeenCalled();
  });

  it.each(DATA_TYPES)('answers 400 and runs no query for %s', async dataType => {
    const executeQuerySpy = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await POST(makeRequest(filterBody(HOSTILE_LOGIC_OPERATOR)), makeProps(dataType, [GUARD_TEST_SCHEMA, '0', '10', '1', '1']));
    const json = await response.json();
    console.log('[fixeddatafilter guard]', dataType, response.status, JSON.stringify(json), 'queries', executeQuerySpy.mock.calls.length);
    expect(json).toEqual({ error: UNSUPPORTED_LOGIC_OPERATOR_MESSAGE });
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(executeQuerySpy).not.toHaveBeenCalled();
  });
});
