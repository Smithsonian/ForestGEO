// frontend/app/api/formdownload/[dataType]/[[...slugs]]/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---------- Import route AFTER mocks ----------
import { GET, POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { UNSUPPORTED_LOGIC_OPERATOR_MESSAGE } from '@/components/processors/processormacros';
import { VIEW_DATA_REQUEST_ERRORS } from '@/lib/viewdata/measurementssummaryquery';

// ---------- Hoisted spies (usable inside vi.mock factories) ----------
const mapperSpies = vi.hoisted(() => {
  const mapDataSpy = vi.fn((rows: any[]) => rows);
  const getMapperSpy = vi.fn(() => ({ mapData: mapDataSpy }));
  return { mapDataSpy, getMapperSpy };
});

const stubSpies = vi.hoisted(() => {
  const buildSearchStub = vi.fn((_cols: string[], _values?: string[] | undefined, _alias?: string) => 'SEARCH_STUB');
  const buildFilterModelStub = vi.fn((_fm: any, _alias?: string) => 'FILTER_STUB');
  return { buildSearchStub, buildFilterModelStub };
});

// ---------- Mocks (factories can safely reference hoisted spies) ----------
vi.mock('@/config/datamapper', () => ({
  default: { getMapper: mapperSpies.getMapperSpy }
}));

vi.mock('@/components/processors/processormacros', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/processors/processormacros')>()),
  buildSearchStub: stubSpies.buildSearchStub,
  buildFilterModelStub: stubSpies.buildFilterModelStub
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

// Mock ConnectionManager to preserve your shared singleton but guarantee getInstance()
vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

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

// ---------- Helpers ----------
function makeProps(dataType?: string, slugs?: string[]) {
  return { params: Promise.resolve({ dataType: dataType as any, slugs }) } as any;
}

function makeRequest(url: string = 'http://localhost:3000') {
  return { nextUrl: new URL(url) } as any;
}

// Route does JSON.parse() directly, so pass a plain JSON string (not URL-encoded)
function fm(obj: any) {
  return JSON.stringify(obj);
}

describe('GET /api/formdownload/[dataType]/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if data type or slugs not provided', async () => {
    const res = await GET(makeRequest(), makeProps(undefined as any, ['forestgeo_testing']));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/data type or slugs not provided/i);
  });

  it('returns 400 if schema missing from the route params', async () => {
    const res = await GET(makeRequest(), makeProps('attributes', [undefined as any, '1', '2', fm({})]));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body = await res.json();
    expect(body.code).toBe('INVALID_SCHEMA');
  });

  it('attributes: 200 with mapped rows; uses search+filter stubs; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'Code' }, { COLUMN_NAME: 'Description' }, { COLUMN_NAME: 'Status' }])
      .mockResolvedValueOnce([
        { code: 'A1', description: 'Alpha', status: 'active' },
        { code: 'B2', description: 'Beta', status: 'inactive' }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('attributes', ['forestgeo_testing', '10', '20', fm({ quickFilterValues: ['oak'], items: [{ f: 1 }] })]);
    const res = await GET(makeRequest(), props);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      { code: 'A1', description: 'Alpha', status: 'active' },
      { code: 'B2', description: 'Beta', status: 'inactive' }
    ]);

    const sql = exec.mock.calls[1][0] as string;
    expect(sql).toMatch(/FROM forestgeo_testing\.attributes a/i);
    expect(sql).toMatch(/\(SEARCH_STUB OR FILTER_STUB\)/i);

    expect(mapperSpies.getMapperSpy).toHaveBeenCalledWith('attributes');
    expect(mapperSpies.mapDataSpy).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('personnel: 200 and maps expected fields; applies stubs; closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'FirstName' }])
      .mockResolvedValueOnce([
        { firstname: 'Ada', lastname: 'Lovelace', role: 'Lead', roledescription: 'Math' },
        { firstname: 'Grace', lastname: 'Hopper', role: 'Rear Admiral', roledescription: 'COBOL' }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('personnel', ['forestgeo_testing', '1', '2', fm({ quickFilterValues: ['gr'], items: [{ f: 2 }] })]);
    const res = await GET(makeRequest(), props);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      { firstname: 'Ada', lastname: 'Lovelace', role: 'Lead', roledescription: 'Math' },
      { firstname: 'Grace', lastname: 'Hopper', role: 'Rear Admiral', roledescription: 'COBOL' }
    ]);

    const sql = (cm.executeQuery as any).mock.calls[1][0] as string;
    expect(sql).toMatch(/FROM forestgeo_testing\.personnel p\s+JOIN forestgeo_testing\.roles r/i);
    expect(sql).toMatch(/\(SEARCH_STUB OR FILTER_STUB\)/);

    // personnel path doesn't call MapperFactory
    expect(mapperSpies.getMapperSpy).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('species: 200 and maps expected fields; applies stubs; closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'SpeciesCode' }])
      .mockResolvedValueOnce([
        {
          spcode: 'ABCD',
          family: 'Asteraceae',
          genus: 'Bellis',
          species: 'perennis',
          subspecies: null,
          idlevel: 1,
          authority: 'L.',
          subspeciesauthority: null
        }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('species', ['forestgeo_testing', '7', '8', fm({ quickFilterValues: ['AB'], items: [{ f: 3 }] })]);
    const res = await GET(makeRequest(), props);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      {
        spcode: 'ABCD',
        family: 'Asteraceae',
        genus: 'Bellis',
        species: 'perennis',
        subspecies: null,
        idlevel: 1,
        authority: 'L.',
        subspeciesauthority: null
      }
    ]);

    const sql = (cm.executeQuery as any).mock.calls[1][0] as string;
    expect(sql).toMatch(/FROM forestgeo_testing\.species sp\s+LEFT JOIN forestgeo_testing\.genus/i);
    expect(sql).toMatch(/\(SEARCH_STUB OR FILTER_STUB\)/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('quadrats: 200 and maps expected fields; applies stubs; closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'QuadratName' }])
      .mockResolvedValueOnce([
        {
          quadrat: 'Q1',
          startx: 0,
          starty: 0,
          dimx: 20,
          dimy: 20,
          area: 400,
          quadratshape: 'square'
        }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('quadrats', ['forestgeo_testing', '7', '8', fm({ quickFilterValues: ['Q'], items: [{ f: 4 }] })]);
    const res = await GET(makeRequest(), props);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      {
        quadrat: 'Q1',
        startx: 0,
        starty: 0,
        dimx: 20,
        dimy: 20,
        area: 400,
        quadratshape: 'square'
      }
    ]);

    const sql = (cm.executeQuery as any).mock.calls[1][0] as string;
    expect(sql).toMatch(/FROM forestgeo_testing\.quadrats q/i);
    expect(sql).toMatch(/\(SEARCH_STUB OR FILTER_STUB\)/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('measurements: 200, maps expected fields; respects visible/tss/search/filter; param order [censusID, plotID]; closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'MeasuredDBH' }])
      .mockResolvedValueOnce([
        {
          StemGUID: 11,
          TreeID: 1,
          StemTag: 'S-1',
          TreeTag: 'T-1',
          SpeciesCode: 'ABCD',
          QuadratName: 'Q1',
          StartX: 1.1,
          StartY: 2.2,
          PlotX: 3.3,
          PlotY: 4.4,
          MeasurementDate: '2025-01-01',
          MeasuredDBH: 13.5,
          MeasuredHOM: 130,
          Codes: 'A;B',
          Errors: 'E1;E2'
        }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const fmParam = {
      quickFilterValues: ['tag'],
      items: [{ field: 'SpeciesCode', op: 'contains', value: 'AB' }],
      visible: ['valid', 'errors'],
      tss: ['multi stem']
    };

    const res = await GET(makeRequest(), makeProps('measurements', ['forestgeo_testing', '7', '80', fm(fmParam)]));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      {
        stemID: 11,
        treeID: 1,
        tag: 'T-1',
        stemtag: 'S-1',
        spcode: 'ABCD',
        quadrat: 'Q1',
        lx: 1.1,
        ly: 2.2,
        px: 3.3,
        py: 4.4,
        dbh: 13.5,
        hom: 130,
        date: '2025-01-01',
        codes: 'A;B',
        errors: 'E1;E2'
      }
    ]);

    const params = exec.mock.calls[1][1] as any[];
    expect(params).toEqual([7, 80]); // [plotID, censusID]

    const sql = exec.mock.calls[1][0] as string;
    expect(sql).toMatch(/cm\.IsValidated = TRUE/);
    expect(sql).toMatch(/cm\.IsValidated = FALSE/);
    expect(sql).toMatch(/JSON_CONTAINS\(UserDefinedFields, JSON_QUOTE\('multi stem'\), '\$\.treestemstate'\) = 1/);
    expect(sql).toMatch(/LEFT JOIN forestgeo_testing\.sitespecificvalidations vp/i);
    expect(sql).toMatch(/COALESCE\(/);
    expect(sql).toContain('AND (SEARCH_STUB)');
    expect(sql).toContain('AND (FILTER_STUB)');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('measurements: PlotX/PlotY export prefers the raw snapshot over the stem row, falling back to the stem row when the raw snapshot is NULL', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'MeasuredDBH' }])
      .mockResolvedValueOnce([
        // Row 1: raw and stem coordinates disagree. cm.RawPlotX/RawPlotY is the
        // as-uploaded snapshot; st.PlotX/PlotY is the shared stems row. MySQL's
        // COALESCE(cm.RawPlotX, st.PlotX) returns the first non-null argument, so
        // with both present the raw snapshot (100.111) wins over the stem value
        // (999.999) that the SQL never even selects once resolved.
        {
          StemGUID: 21,
          TreeID: 2,
          StemTag: 'S-2',
          TreeTag: 'T-2',
          SpeciesCode: 'ABCD',
          QuadratName: 'Q1',
          StartX: 1.1,
          StartY: 2.2,
          PlotX: 100.111,
          PlotY: 200.222,
          MeasurementDate: '2025-01-01',
          MeasuredDBH: 13.5,
          MeasuredHOM: 130,
          Codes: null,
          Errors: null
        },
        // Row 2: raw snapshot is NULL for this row, so COALESCE falls back to the
        // stem row's PlotX/PlotY.
        {
          StemGUID: 22,
          TreeID: 3,
          StemTag: 'S-3',
          TreeTag: 'T-3',
          SpeciesCode: 'ABCD',
          QuadratName: 'Q1',
          StartX: 1.3,
          StartY: 2.4,
          PlotX: 55.5,
          PlotY: 66.6,
          MeasurementDate: '2025-01-02',
          MeasuredDBH: 14.0,
          MeasuredHOM: 131,
          Codes: null,
          Errors: null
        }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const fmParam = { quickFilterValues: [], items: [], visible: ['valid', 'errors'], tss: [] };
    const res = await GET(makeRequest(), makeProps('measurements', ['forestgeo_testing', '7', '80', fm(fmParam)]));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body[0]).toMatchObject({ stemID: 21, px: 100.111, py: 200.222 });
    expect(body[1]).toMatchObject({ stemID: 22, px: 55.5, py: 66.6 });

    const sql = exec.mock.calls[1][0] as string;
    expect(sql).toMatch(/COALESCE\(cm\.RawPlotX, st\.PlotX\)\s+AS PlotX/);
    expect(sql).toMatch(/COALESCE\(cm\.RawPlotY, st\.PlotY\)\s+AS PlotY/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('measurements: returns no rows when visible filters are all disabled', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'MeasuredDBH' }])
      .mockResolvedValueOnce([]);
    vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await GET(
      makeRequest(),
      makeProps('measurements', ['forestgeo_testing', '7', '80', fm({ quickFilterValues: [], items: [], visible: [], tss: ['multi stem'] })])
    );

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([]);

    const sql = exec.mock.calls[1][0] as string;
    expect(sql).toMatch(/AND 1 = 0/);
  });

  it('returns 500 on errors during columns discovery and closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('columns fail'));

    const res = await GET(makeRequest(), makeProps('attributes', ['forestgeo_testing', '1', '2', fm({})]));

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.error).toMatch(/columns fail/i);

    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe('logicOperator guard (SQL injection)', () => {
  const GUARD_TEST_SCHEMA = 'forestgeo_testing';
  const makeBodyRequest = (body: unknown) => ({ nextUrl: new URL('http://localhost:3000'), json: async () => body }) as any;
  const HOSTILE_FILTER = { items: [{ f: 1 }, { f: 2 }], logicOperator: ') OR (1=1) OR (' };
  const CONTROL_FILTER = { ...HOSTILE_FILTER, logicOperator: 'and' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('control: a valid operator in the path slug passes authorization and reaches the column query', async () => {
    const exec = vi
      .spyOn((ConnectionManager as any).getInstance(), 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'Code' }])
      .mockResolvedValueOnce([]);
    const response = await GET(makeRequest(), makeProps('attributes', [GUARD_TEST_SCHEMA, '10', '20', fm(CONTROL_FILTER)]));
    console.log('[formdownload guard] control', response.status, 'queries', exec.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(exec).toHaveBeenCalled();
  });

  it.each([
    ['the path slug', () => GET(makeRequest(), makeProps('attributes', [GUARD_TEST_SCHEMA, '10', '20', fm(HOSTILE_FILTER)]))],
    [
      'the filterModel search parameter',
      () =>
        GET(
          makeRequest(`http://localhost:3000?filterModel=${encodeURIComponent(fm(HOSTILE_FILTER))}`),
          makeProps('attributes', [GUARD_TEST_SCHEMA, '10', '20'])
        )
    ]
  ])('answers 400 and runs no query when the filter model comes from %s', async (_label, call) => {
    const exec = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await call();
    const json = await response.json();
    console.log('[formdownload guard]', _label, response.status, JSON.stringify(json), 'queries', exec.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(json).toEqual({ error: UNSUPPORTED_LOGIC_OPERATOR_MESSAGE });
    expect(exec).not.toHaveBeenCalled();
  });

  it('control: a valid operator in the request body passes authorization and reaches the column query', async () => {
    const exec = vi
      .spyOn((ConnectionManager as any).getInstance(), 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'Code' }])
      .mockResolvedValueOnce([]);
    const response = await POST(makeBodyRequest({ filterModel: CONTROL_FILTER }), makeProps('attributes', [GUARD_TEST_SCHEMA, '10', '20']));
    console.log('[formdownload guard] body control', response.status, 'queries', exec.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(exec).toHaveBeenCalled();
  });

  it('answers 400 with the unsupported-operator message and runs no query when the filter model comes from the request body', async () => {
    const exec = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await POST(makeBodyRequest({ filterModel: HOSTILE_FILTER }), makeProps('attributes', [GUARD_TEST_SCHEMA, '10', '20']));
    const json = await response.json();
    console.log('[formdownload guard] body', response.status, JSON.stringify(json), 'queries', exec.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(json).toEqual({ error: UNSUPPORTED_LOGIC_OPERATOR_MESSAGE });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('Stem status filter on the measurements Form CSV export', () => {
  const STEM_STATUS_SCHEMA = 'forestgeo_testing';
  const EXPORT_PLOT_ID = '7';
  const EXPORT_CENSUS_ID = '80';
  const BASE_MEASUREMENTS_FILTER = { quickFilterValues: [], items: [], visible: ['valid', 'errors'], tss: [] };
  const INJECTION_SHAPED_STATUS = "dead') OR 1=1 --";
  const makeBodyRequest = (body: unknown) => ({ nextUrl: new URL('http://localhost:3000'), json: async () => body }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubColumnsThenRows() {
    const exec = vi
      .spyOn((ConnectionManager as any).getInstance(), 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'MeasuredDBH' }])
      .mockResolvedValueOnce([]);
    vi.spyOn((ConnectionManager as any).getInstance(), 'closeConnection').mockResolvedValue(undefined);
    return exec;
  }

  function exportMeasurements(filterModel: unknown) {
    return GET(makeRequest(), makeProps('measurements', [STEM_STATUS_SCHEMA, EXPORT_PLOT_ID, EXPORT_CENSUS_ID, fm(filterModel)]));
  }

  it('restricts the export to rows carrying a dead effective code when Stem status is Dead', async () => {
    const exec = stubColumnsThenRows();

    const response = await exportMeasurements({ ...BASE_MEASUREMENTS_FILTER, stemStatus: ['dead'] });

    const exportSql = exec.mock.calls[1]?.[0] as string;
    console.log('[formdownload stemStatus] dead', response.status, 'queries', exec.mock.calls.length, 'sql has clause', exportSql?.includes('sf_attr'));
    expect(response.status).toBe(HTTPResponses.OK);
    expect(exportSql).toContain("sf_attr.Status IN ('dead')");
    expect(exportSql).toContain('AND cm.CoreMeasurementID IN (');
    expect(exportSql).not.toContain('sf_ca.CoreMeasurementID = cm.CoreMeasurementID');
    expect(exportSql).toContain(`FROM ${STEM_STATUS_SCHEMA}.cmattributes sf_ca`);
    expect(exportSql).toContain('MAX(effective_attr.IsActive)');
  });

  it('ANDs the Stem status clause to the visible filter instead of widening it', async () => {
    const exec = stubColumnsThenRows();

    await exportMeasurements({ ...BASE_MEASUREMENTS_FILTER, stemStatus: ['dead', 'alive'] });

    const exportSql = exec.mock.calls[1][0] as string;
    expect(exportSql).toContain("sf_attr.Status IN ('dead', 'alive')");
    expect(exportSql.indexOf('cm.IsValidated')).toBeLessThan(exportSql.indexOf('sf_attr.Status'));
    expect(exportSql).toMatch(
      /AND cm\.CoreMeasurementID IN \(\s+SELECT \/\*\+ SEMIJOIN\(MATERIALIZATION\) \*\/ sf_ca\.CoreMeasurementID FROM forestgeo_testing\.cmattributes sf_ca/
    );
  });

  it('adds no Stem status clause when the filter model carries none', async () => {
    const exec = stubColumnsThenRows();

    const response = await exportMeasurements(BASE_MEASUREMENTS_FILTER);

    expect(response.status).toBe(HTTPResponses.OK);
    expect(exec.mock.calls[1][0] as string).not.toContain('sf_attr');
  });

  it('applies the Stem status clause when the filter model arrives in a POST body', async () => {
    const exec = stubColumnsThenRows();

    const response = await POST(
      makeBodyRequest({ filterModel: { ...BASE_MEASUREMENTS_FILTER, stemStatus: ['dead'] } }),
      makeProps('measurements', [STEM_STATUS_SCHEMA, EXPORT_PLOT_ID, EXPORT_CENSUS_ID])
    );

    expect(response.status).toBe(HTTPResponses.OK);
    expect(exec.mock.calls[1][0] as string).toContain("sf_attr.Status IN ('dead')");
  });

  it.each([
    ['an unknown status', ['zombie']],
    ['an injection-shaped status', [INJECTION_SHAPED_STATUS]],
    ['a non-string status', [7]],
    ['a bare string instead of a list', 'dead']
  ])('answers 400 and runs no query for %s', async (_label, stemStatus) => {
    const exec = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');

    const response = await exportMeasurements({ ...BASE_MEASUREMENTS_FILTER, stemStatus });
    const json = await response.json();

    console.log('[formdownload stemStatus]', _label, response.status, JSON.stringify(json), 'queries', exec.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(json).toEqual({ error: VIEW_DATA_REQUEST_ERRORS.unsupportedStemStatus });
    expect(exec).not.toHaveBeenCalled();
  });

  it('leaves the other export branches untouched by a Stem status in the filter model', async () => {
    const exec = vi
      .spyOn((ConnectionManager as any).getInstance(), 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'Code' }])
      .mockResolvedValueOnce([]);
    vi.spyOn((ConnectionManager as any).getInstance(), 'closeConnection').mockResolvedValue(undefined);

    const response = await GET(
      makeRequest(),
      makeProps('attributes', [STEM_STATUS_SCHEMA, EXPORT_PLOT_ID, EXPORT_CENSUS_ID, fm({ quickFilterValues: [], items: [], stemStatus: ['dead'] })])
    );

    expect(response.status).toBe(HTTPResponses.OK);
    expect(exec.mock.calls[1][0] as string).not.toContain('sf_attr');
  });
});

describe('Search and column filter composition in the Form CSV', () => {
  const COMPOSITION_SCHEMA = 'forestgeo_testing';
  const COMPOSITION_PLOT_ID = '7';
  const COMPOSITION_CENSUS_ID = '80';
  const SEARCH_CLAUSE = 'SEARCH_STUB';
  const FILTER_CLAUSE = 'FILTER_STUB';
  const SEARCH_TERMS = ['tag'];
  const FILTER_ITEMS = [{ field: 'MeasuredDBH', operator: '>', value: 20 }];
  const NO_FILTER_ITEMS: unknown[] = [];
  const NO_SEARCH_TERMS: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubStubsLikeTheRealBuilders() {
    stubSpies.buildSearchStub.mockImplementationOnce((_columns, values) => (values?.length ? SEARCH_CLAUSE : ''));
    stubSpies.buildFilterModelStub.mockImplementationOnce(filterModel => (filterModel.items?.length ? FILTER_CLAUSE : ''));
  }

  async function exportSqlFor(dataType: string, filterModel: Record<string, unknown>) {
    stubStubsLikeTheRealBuilders();
    const exec = vi
      .spyOn((ConnectionManager as any).getInstance(), 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'Code' }])
      .mockResolvedValueOnce([]);
    vi.spyOn((ConnectionManager as any).getInstance(), 'closeConnection').mockResolvedValue(undefined);
    const response = await GET(makeRequest(), makeProps(dataType, [COMPOSITION_SCHEMA, COMPOSITION_PLOT_ID, COMPOSITION_CENSUS_ID, fm(filterModel)]));
    const sql = exec.mock.calls[1]?.[0] as string;
    console.log(
      `[formdownload composition] ${dataType}`,
      JSON.stringify({ status: response.status, whereTail: sql?.replace(/\s+/g, ' ').slice(-220), filterModel })
    );
    expect(response.status).toBe(HTTPResponses.OK);
    return sql;
  }

  const MEASUREMENTS_BASE_FILTER = { visible: ['valid', 'errors'], tss: [] };

  it('measurements: a search and a column filter are ANDed as two separate clauses, so only rows matching both export', async () => {
    const sql = await exportSqlFor('measurements', { ...MEASUREMENTS_BASE_FILTER, quickFilterValues: SEARCH_TERMS, items: FILTER_ITEMS });

    expect(sql).toMatch(new RegExp(`AND \\(${SEARCH_CLAUSE}\\)\\s+AND \\(${FILTER_CLAUSE}\\)`));
    expect(sql).not.toContain(`${SEARCH_CLAUSE} OR ${FILTER_CLAUSE}`);
  });

  it('measurements: a search alone adds only the search clause', async () => {
    const sql = await exportSqlFor('measurements', { ...MEASUREMENTS_BASE_FILTER, quickFilterValues: SEARCH_TERMS, items: NO_FILTER_ITEMS });

    expect(sql).toContain(`AND (${SEARCH_CLAUSE})`);
    expect(sql).not.toContain(FILTER_CLAUSE);
  });

  it('measurements: a column filter alone adds only the filter clause', async () => {
    const sql = await exportSqlFor('measurements', { ...MEASUREMENTS_BASE_FILTER, quickFilterValues: NO_SEARCH_TERMS, items: FILTER_ITEMS });

    expect(sql).toContain(`AND (${FILTER_CLAUSE})`);
    expect(sql).not.toContain(SEARCH_CLAUSE);
  });

  it('measurements: neither a search nor a filter adds a clause', async () => {
    const sql = await exportSqlFor('measurements', { ...MEASUREMENTS_BASE_FILTER, quickFilterValues: NO_SEARCH_TERMS, items: NO_FILTER_ITEMS });

    expect(sql).not.toContain(SEARCH_CLAUSE);
    expect(sql).not.toContain(FILTER_CLAUSE);
  });

  it.each(['attributes', 'failedmeasurements'])('%s: keeps combining the search and the filter with OR, as before', async dataType => {
    const sql = await exportSqlFor(dataType, { quickFilterValues: SEARCH_TERMS, items: FILTER_ITEMS });

    expect(sql).toContain(`(${SEARCH_CLAUSE} OR ${FILTER_CLAUSE})`);
  });
});
