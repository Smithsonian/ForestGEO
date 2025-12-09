import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
// Import after mocks
import { GET } from './route'; // ─── Helpers ───────────────────────────────────────────────────────────────────

// ─── Mocks (hoisted) ───────────────────────────────────────────────────────────
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  // If test env already provided a singleton, reuse it; otherwise create a stub
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

// deterministic mysql2.format so we can assert what was passed
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params: any[]) => `FORMATTED:${sql}::${JSON.stringify(params)}`;
  return { format };
});

// quiet logger
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// Mock schema validation to accept test schemas
vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: vi.fn((schema: string) => {
    return ['myschema', 'testschema', 'catdb', 's'].includes(schema);
  })
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────
function makeProps(dataType?: string, slugs?: string[]) {
  return { params: Promise.resolve({ dataType: dataType as any, slugs }) } as any;
}

describe('GET /api/formvalidation/[dataType]/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if slugs missing or length !== 3', async () => {
    const res1 = await GET({} as any, makeProps('attributes', undefined as any));
    expect(res1.status).toBe(HTTPResponses.INVALID_REQUEST);
    const res2 = await GET({} as any, makeProps('attributes', ['schema', 'col']));
    expect(res2.status).toBe(HTTPResponses.INVALID_REQUEST);
    const res3 = await GET({} as any, makeProps('attributes', ['a', 'b', 'c', 'd']));
    expect(res3.status).toBe(HTTPResponses.INVALID_REQUEST);
  });

  it('returns 400 if dataType missing or "undefined"', async () => {
    const res1 = await GET({} as any, makeProps(undefined as any, ['s', 'c', 'v']));
    expect(res1.status).toBe(HTTPResponses.INVALID_REQUEST);
    const res2 = await GET({} as any, makeProps('undefined' as any, ['s', 'c', 'v']));
    expect(res2.status).toBe(HTTPResponses.INVALID_REQUEST);
  });

  it('returns 400 when any of schema/columnName/value is falsy (empty string)', async () => {
    const res = await GET({} as any, makeProps('personnel', ['', 'FirstName', 'Alice']));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
  });

  it('404 when query returns no rows; closes connection; formats SQL with ?? and ?', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    // Use valid dataType 'personnel' instead of 'users'
    const res = await GET({} as any, makeProps('personnel', ['myschema', 'FirstName', 'Alice']));
    expect(res.status).toBe(404);

    expect(exec).toHaveBeenCalledTimes(1);
    const [formatted] = exec.mock.calls[0];
    // Our format mock encodes both SQL and params for easy assertion
    expect(String(formatted)).toContain('SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1');
    expect(String(formatted)).toContain(`["myschema.personnel","FirstName","Alice"]`);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('200 when at least one row exists; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ 1: 1 }]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await GET({} as any, makeProps('species', ['catdb', 'SpeciesCode', 'ABCD']));
    expect(res.status).toBe(HTTPResponses.OK);

    expect(exec).toHaveBeenCalledTimes(1);
    const [formatted] = exec.mock.calls[0];
    expect(String(formatted)).toContain('SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1');
    expect(String(formatted)).toContain(`["catdb.species","SpeciesCode","ABCD"]`);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on DB errors and still closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    // Use valid dataType 'personnel' instead of 'roles'
    const res = await GET({} as any, makeProps('personnel', ['myschema', 'FirstName', 'Admin']));
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
