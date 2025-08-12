// frontend/app/api/fixeddata/[dataType]/[[...slugs]]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// Import handler after mocks are set up
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // ---------- helpers ----------

// ---------- hoisted spies (safe for vi.mock factories) ----------
const { getMapperSpy, mapDataSpy } = vi.hoisted(() => ({
  getMapperSpy: vi.fn(),
  mapDataSpy: vi.fn((rows: any[]) => rows)
}));

// ---------- mocks (must appear before importing the route) ----------
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params: any[]) => `FORMATTED_SQL:${sql}::PARAMS:${JSON.stringify(params)}`;
  return { format };
});

vi.mock('@/config/datamapper', () => ({
  default: { getMapper: getMapperSpy.mockReturnValue({ mapData: mapDataSpy }) }
}));

vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);
  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance?.()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance?.()) ||
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

// ---------- helpers ----------
function makeProps(dataType: string, slugs?: string[]) {
  return { params: Promise.resolve({ dataType, slugs }) } as any;
}

describe('GET /api/fixeddata/[dataType]/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMapperSpy.mockReturnValue({ mapData: mapDataSpy });
  });

  it('throws if slugs are missing or fewer than 5', async () => {
    await expect(GET({} as any, makeProps('species', undefined))).rejects.toThrow(/slugs not received/i);

    await expect(GET({} as any, makeProps('species', ['myschema', '0', '25', '101']))).rejects.toThrow(/slugs not received/i);
  });

  it('throws if core slugs schema/page/pageSize are not valid', async () => {
    await expect(GET({} as any, makeProps('species', [undefined as any, '0', '25', '1', '2']))).rejects.toThrow(
      /core slugs schema\/page\/pageSize not correctly received/i
    );

    await expect(GET({} as any, makeProps('species', ['myschema', undefined as any, '25', '1', '2']))).rejects.toThrow(
      /core slugs schema\/page\/pageSize not correctly received/i
    );

    await expect(GET({} as any, makeProps('species', ['myschema', '0', 'undefined', '1', '2']))).rejects.toThrow(
      /core slugs schema\/page\/pageSize not correctly received/i
    );
  });

  it('unifiedchangelog: 200 with mapped data, totalCount, finishedQuery; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    exec
      .mockResolvedValueOnce([
        { ChangeID: 11, PlotID: 7, CensusID: 3 },
        { ChangeID: 12, PlotID: 7, CensusID: 3 }
      ])
      .mockResolvedValueOnce([{ totalRows: 42 }]);

    const res = await GET({} as any, makeProps('unifiedchangelog', ['myschema', '1', '25', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();

    expect(body.output).toEqual([
      { ChangeID: 11, PlotID: 7, CensusID: 3 },
      { ChangeID: 12, PlotID: 7, CensusID: 3 }
    ]);
    expect(body.totalCount).toBe(42);
    expect(String(body.finishedQuery)).toMatch(/FORMATTED_SQL:/);
    expect(String(body.finishedQuery)).toMatch(/FROM myschema\.unifiedchangelog/i);
    expect(String(body.finishedQuery)).toMatch(/::PARAMS:\[7,3,25,25\]/);

    expect(getMapperSpy).toHaveBeenCalledWith('unifiedchangelog');
    expect(mapDataSpy).toHaveBeenCalled();
    expect(exec).toHaveBeenNthCalledWith(2, 'SELECT FOUND_ROWS() as totalRows');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stems: parses UserDefinedFields before mapping', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    exec
      .mockResolvedValueOnce([
        { StemID: 5, UserDefinedFields: JSON.stringify({ treestemstate: { foo: 1 } }) },
        { StemID: 6, UserDefinedFields: { treestemstate: { bar: 2 } } }
      ])
      .mockResolvedValueOnce([{ totalRows: 2 }]);

    const res = await GET({} as any, makeProps('stems', ['myschema', '0', '10', '101', '2']));
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();

    expect(body.output).toEqual([
      { StemID: 5, UserDefinedFields: { foo: 1 } },
      { StemID: 6, UserDefinedFields: { bar: 2 } }
    ]);
    expect(body.totalCount).toBe(2);
    expect(getMapperSpy).toHaveBeenCalledWith('stems');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('personnel: finishedQuery param order is correct', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    exec.mockResolvedValueOnce([{ PersonnelID: 1 }, { PersonnelID: 2 }]).mockResolvedValueOnce([{ totalRows: 2 }]);

    const res = await GET({} as any, makeProps('personnel', ['myschema', '2', '50', '77', '9']));
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();

    expect(body.output).toEqual([{ PersonnelID: 1 }, { PersonnelID: 2 }]);
    expect(body.totalCount).toBe(2);
    expect(String(body.finishedQuery)).toMatch(/FROM myschema\.personnel/i);
    expect(String(body.finishedQuery)).toMatch(/::PARAMS:\[9,77,100,50\]/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws for unknown dataType', async () => {
    await expect(GET({} as any, makeProps('not-a-table', ['myschema', '0', '25', '1', '1']))).rejects.toThrow(/Unknown dataType/i);
  });

  it('propagates DB errors and closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('db down'));
    const close = vi.spyOn(cm, 'closeConnection');

    await expect(GET({} as any, makeProps('species', ['myschema', '0', '25', '1', '1']))).rejects.toThrow(/db down/i);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
