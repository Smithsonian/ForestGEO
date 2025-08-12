import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// Import after mocks
import { POST } from './route';
import ConnectionManager from '@/config/connectionmanager'; // -------------------- helpers --------------------

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

vi.mock('@/components/processors/processormacros', () => ({
  buildFilterModelStub: filterStubSpy,
  buildSearchStub: searchStubSpy
}));

vi.mock('@/config/macros/coreapifunctions', () => ({
  POST: singlePostSpy,
  PATCH: vi.fn(),
  DELETE: vi.fn()
}));

vi.mock('@/config/connectionmanager', async () => {
  // Try to reuse your test setup’s singleton if present
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);
  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance?.()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance?.()) ||
    actual?.default ||
    actual;

  // Either use the real test instance or stub a safe default
  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx'),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
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

    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toEqual({ delegated: true });
  });

  // AFTER
  it('throws if slugs missing or fewer than 5', async () => {
    await expect(POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', undefined as any))).rejects.toThrow(/slugs not received/i);

    await expect(POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', ['myschema', '0', '25', '101']))).rejects.toThrow(
      /slugs not received/i
    );
  });

  it('throws if core slugs schema/page/pageSize invalid', async () => {
    await expect(POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', [undefined as any, '0', '25', '1', '2']))).rejects.toThrow(
      /core slugs/i
    );

    await expect(POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', ['myschema', undefined as any, '25', '1', '2']))).rejects.toThrow(
      /core slugs/i
    );

    await expect(POST(makeRequest({ filterModel: baseFilterModel }), makeProps('species', ['myschema', '0', 'undefined', '1', '2']))).rejects.toThrow(
      /core slugs/i
    );
  });

  it('sitespecificvalidations: builds WHERE with search+filter, paginates, maps rows, commits, closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const commit = vi.spyOn(cm, 'commitTransaction');
    const rollback = vi.spyOn(cm, 'rollbackTransaction');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) column introspection
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'ColA' }, { COLUMN_NAME: 'ColB' }]);
    // 2) paginated results
    exec.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    // 3) FOUND_ROWS
    exec.mockResolvedValueOnce([{ totalRows: 2 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('sitespecificvalidations', ['myschema', '1', '50', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([{ id: 1 }, { id: 2 }]);
    expect(body.totalCount).toBe(2);

    // finishedQuery shows our prepared query + params
    expect(String(body.finishedQuery)).toMatch(/FORMATTED_SQL:/);
    expect(String(body.finishedQuery)).toMatch(/FROM myschema\.sitespecificvalidations/);
    // LIMIT params appended at the end: page*pageSize, pageSize => 1*50=50, 50
    expect(String(body.finishedQuery)).toMatch(/::PARAMS:\[50,50\]$/);

    // flow
    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);

    // filter/search builders used
    expect(searchStubSpy).toHaveBeenCalled();
    expect(filterStubSpy).toHaveBeenCalled();
    expect(mapDataSpy).toHaveBeenCalled();
  });

  it('measurementssummaryview: respects visible + tss filters; commits and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-ms');
    const commit = vi.spyOn(cm, 'commitTransaction');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) columns
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'MeasurementDate' }]);
    // 2) paginated results
    exec.mockResolvedValueOnce([{ CoreMeasurementID: 10 }]);
    // 3) FOUND_ROWS
    exec.mockResolvedValueOnce([{ totalRows: 1 }]);

    const filterModel = {
      items: [{ field: 'foo', operator: 'contains', value: 'bar' }],
      quickFilterValues: ['needle'],
      visible: ['valid', 'pending'],
      tss: ['alive', 'dead']
    };

    const req = makeRequest({ filterModel });
    const res = await POST(req, makeProps('measurementssummaryview', ['myschema', '0', '25', '101', '7']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([{ CoreMeasurementID: 10 }]);
    expect(body.totalCount).toBe(1);

    const [, paginatedSQL] = exec.mock.calls; // second call is the paginated query
    const sqlStr = String(paginatedSQL);
    // sanity that our extra conditions were embedded
    expect(sqlStr).toMatch(/IsValidated = TRUE/);
    expect(sqlStr).toMatch(/IsValidated IS NULL/);
    expect(sqlStr).toMatch(/JSON_CONTAINS\(UserDefinedFields, JSON_QUOTE\('alive'\), '\$\.treestemstate'\)/);
    expect(sqlStr).toMatch(/JSON_CONTAINS\(UserDefinedFields, JSON_QUOTE\('dead'\), '\$\.treestemstate'\)/);

    expect(begin).toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith('tx-ms');
    expect(close).toHaveBeenCalledTimes(1);
    expect(mapDataSpy).toHaveBeenCalled();
  });

  it('coremeasurements: when multiple census IDs, returns deprecated filtered subset; commits and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-cm');
    const commit = vi.spyOn(cm, 'commitTransaction');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) columns for building search/filter
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'MeasurementDate' }]);
    // 2) censusQuery -> multiple census IDs
    exec.mockResolvedValueOnce([{ CensusID: 100 }, { CensusID: 90 }, { CensusID: 80 }]);
    // 3) paginated results (mix of current & past census rows, with overlapping keys)
    exec.mockResolvedValueOnce([
      // Current census (100)
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemID: 111, CensusID: 100 },
      // Past census rows (should be deprecated if same key combo)
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemID: 111, CensusID: 90 }, // same key -> deprecated
      { PlotID: 7, QuadratID: 2, TreeID: 12, StemID: 112, CensusID: 80 } // different key -> filtered out
    ]);
    // 4) FOUND_ROWS
    exec.mockResolvedValueOnce([{ totalRows: 3 }]);

    const req = makeRequest({ filterModel: baseFilterModel });
    const res = await POST(req, makeProps('coremeasurements', ['myschema', '0', '25', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body.output).toEqual([
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemID: 111, CensusID: 100 },
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemID: 111, CensusID: 90 },
      { PlotID: 7, QuadratID: 2, TreeID: 12, StemID: 112, CensusID: 80 }
    ]);
    // Only deprecated rows that match an output key combo
    expect(body.deprecated).toEqual([
      { PlotID: 7, QuadratID: 1, TreeID: 11, StemID: 111, CensusID: 90 },
      { PlotID: 7, QuadratID: 2, TreeID: 12, StemID: 112, CensusID: 80 }
    ]);
    expect(body.totalCount).toBe(3);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('tx-cm');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows if a DB error occurs during query; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const rollback = vi.spyOn(cm, 'rollbackTransaction');
    const close = vi.spyOn(cm, 'closeConnection');

    // 1) columns ok
    exec.mockResolvedValueOnce([{ COLUMN_NAME: 'ColX' }]);
    // 2) paginated results boom
    exec.mockRejectedValueOnce(new Error('kapow'));

    const req = makeRequest({ filterModel: baseFilterModel });
    await expect(POST(req, makeProps('species', ['myschema', '0', '25', '1', '2']))).rejects.toThrow(/kapow/i);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
