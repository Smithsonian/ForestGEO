// frontend/app/api/formdownload/[dataType]/[[...slugs]]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---------- Import route AFTER mocks ----------
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

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

vi.mock('@/components/processors/processormacros', () => ({
  buildSearchStub: stubSpies.buildSearchStub,
  buildFilterModelStub: stubSpies.buildFilterModelStub
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

// Mock ConnectionManager to preserve your shared singleton but guarantee getInstance()
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

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

// Route does JSON.parse() directly, so pass a plain JSON string (not URL-encoded)
function fm(obj: any) {
  return JSON.stringify(obj);
}

describe('GET /api/formdownload/[dataType]/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if data type or slugs not provided', async () => {
    await expect(GET({} as any, makeProps(undefined as any, undefined as any))).rejects.toThrow(/data type or slugs not provided/i);
  });

  it('throws if schema missing', async () => {
    await expect(GET({} as any, makeProps('attributes', [undefined as any, '1', '2', fm({})]))).rejects.toThrow(/no schema provided/i);
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

    const props = makeProps('attributes', ['myschema', '10', '20', fm({ quickFilterValues: ['oak'], items: [{ f: 1 }] })]);
    const res = await GET({} as any, props);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      { code: 'A1', description: 'Alpha', status: 'active' },
      { code: 'B2', description: 'Beta', status: 'inactive' }
    ]);

    const sql = exec.mock.calls[1][0] as string;
    expect(sql).toMatch(/FROM myschema\.attributes a/i);
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
        { FirstName: 'Ada', LastName: 'Lovelace', RoleName: 'Lead', RoleDescription: 'Math' },
        { FirstName: 'Grace', LastName: 'Hopper', RoleName: 'Rear Admiral', RoleDescription: 'COBOL' }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('personnel', ['myschema', '1', '2', fm({ quickFilterValues: ['gr'], items: [{ f: 2 }] })]);
    const res = await GET({} as any, props);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      { firstname: 'Ada', lastname: 'Lovelace', role: 'Lead', roledescription: 'Math' },
      { firstname: 'Grace', lastname: 'Hopper', role: 'Rear Admiral', roledescription: 'COBOL' }
    ]);

    const sql = (cm.executeQuery as any).mock.calls[1][0] as string;
    expect(sql).toMatch(/FROM myschema\.personnel p\s+JOIN myschema\.roles r/i);
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
          SpeciesCode: 'ABCD',
          Family: 'Asteraceae',
          Genus: 'Bellis',
          SpeciesName: 'perennis',
          SubspeciesName: null,
          IDLevel: 1,
          SpeciesAuthority: 'L.',
          SubspeciesAuthority: null
        }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('species', ['myschema', '7', '8', fm({ quickFilterValues: ['AB'], items: [{ f: 3 }] })]);
    const res = await GET({} as any, props);

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
    expect(sql).toMatch(/FROM myschema\.species sp\s+LEFT JOIN myschema\.genus/i);
    expect(sql).toMatch(/\(SEARCH_STUB OR FILTER_STUB\)/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('quadrats: 200 and maps expected fields; applies stubs; closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ COLUMN_NAME: 'QuadratName' }])
      .mockResolvedValueOnce([
        {
          QuadratName: 'Q1',
          StartX: 0,
          StartY: 0,
          DimensionX: 20,
          DimensionY: 20,
          Area: 400,
          QuadratShape: 'square'
        }
      ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const props = makeProps('quadrats', ['myschema', '7', '8', fm({ quickFilterValues: ['Q'], items: [{ f: 4 }] })]);
    const res = await GET({} as any, props);

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
    expect(sql).toMatch(/FROM myschema\.quadrats q/i);
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
      tss: ['alive']
    };

    const res = await GET({} as any, makeProps('measurements', ['myschema', '7', '80', fm(fmParam)]));

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
        dbh: 13.5,
        hom: 130,
        date: '2025-01-01',
        codes: 'A;B',
        errors: 'E1;E2'
      }
    ]);

    const params = exec.mock.calls[1][1] as any[];
    expect(params).toEqual([80, 7]); // [censusID, plotID]

    const sql = exec.mock.calls[1][0] as string;
    expect(sql).toMatch(/cm\.IsValidated = TRUE/);
    expect(sql).toMatch(/cm\.IsValidated = FALSE/);
    expect(sql).toMatch(/JSON_CONTAINS\(UserDefinedFields, JSON_QUOTE\('alive'\), '\$\.treestemstate'\) = 1/);
    expect(sql).toMatch(/\(SEARCH_STUB OR FILTER_STUB\)/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown during columns discovery (no close in this path)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('columns fail'));
    // do NOT spy on / assert closeConnection here — route never reaches the finally

    await expect(GET({} as any, makeProps('attributes', ['myschema', '1', '2', fm({})]))).rejects.toThrow(/columns fail/i);

    expect(exec).toHaveBeenCalledTimes(1);
  });
});
