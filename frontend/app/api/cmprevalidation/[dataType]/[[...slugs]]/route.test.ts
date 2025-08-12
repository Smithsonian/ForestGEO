import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ========== Import handler AFTER mocks ==========
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

// ========== Mocks (must be BEFORE importing the route) ==========

// Ensure ConnectionManager.getInstance() exists and returns the shared mock instance
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);
  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' && // not used here, but harmless
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

// Logger mock
const { logErr } = vi.hoisted(() => ({ logErr: vi.fn() }));
vi.mock('@/ailogger', () => ({
  default: { error: logErr, info: vi.fn(), warn: vi.fn() }
}));

// ========== Helpers ==========
function makeProps(dataType?: string, slugs?: string[]) {
  return { params: Promise.resolve({ dataType: dataType as any, slugs }) } as any;
}
function noopRequest() {
  return new Request('http://localhost/api') as any;
}

// ========== Tests ==========
describe('GET /api/cmprevalidation/[dataType]/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when slugs or dataType missing', async () => {
    // missing slugs
    await expect(GET(noopRequest(), makeProps('attributes', undefined as any))).rejects.toThrow(/missing slugs/i);
    // missing dataType
    await expect(GET(noopRequest(), makeProps(undefined as any, ['s', '1', '1']))).rejects.toThrow(/missing slugs/i);
  });

  it('throws when incorrect slugs (length not 3 or "undefined" values)', async () => {
    await expect(GET(noopRequest(), makeProps('attributes', ['schema', '1']))).rejects.toThrow(/incorrect slugs/i);
    await expect(GET(noopRequest(), makeProps('attributes', ['schema', '1', 'undefined']))).rejects.toThrow(/incorrect slugs/i);
    await expect(GET(noopRequest(), makeProps('attributes', ['undefined', '1', '2']))).rejects.toThrow(/incorrect slugs/i);
  });

  it('attributes: 200 when table has rows; 428 when empty; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    // success path
    exec.mockResolvedValueOnce([{ _1: 1 }]);
    let res = await GET(noopRequest(), makeProps('attributes', ['myschema', '42', '7']));
    expect(res.status).toBe(HTTPResponses.OK);
    expect(close).toHaveBeenCalledTimes(1);
    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/^SELECT 1 FROM myschema\.attributes dt/i);

    // failure path (no rows)
    exec.mockResolvedValueOnce([]);
    res = await GET(noopRequest(), makeProps('attributes', ['myschema', '42', '7']));
    expect(res.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('species: mirrors attributes behavior', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ _1: 1 }]);
    const close = vi.spyOn(cm, 'closeConnection');

    const ok = await GET(noopRequest(), makeProps('species', ['s1', '1', '2']));
    expect(ok.status).toBe(HTTPResponses.OK);
    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/^SELECT 1 FROM s1\.species dt/i);

    exec.mockResolvedValueOnce([]);
    const fail = await GET(noopRequest(), makeProps('species', ['s1', '1', '2']));
    expect(fail.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);

    expect(close).toHaveBeenCalledTimes(2);
  });

  it('personnel: 200 when table has rows; 428 when empty; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    exec.mockResolvedValueOnce([{ _1: 1 }]);
    let res = await GET(noopRequest(), makeProps('personnel', ['org', '3', '1']));
    expect(res.status).toBe(HTTPResponses.OK);
    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/^SELECT 1 FROM org\.personnel p/i);

    exec.mockResolvedValueOnce([]);
    res = await GET(noopRequest(), makeProps('personnel', ['org', '3', '1']));
    expect(res.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);

    expect(close).toHaveBeenCalledTimes(2);
  });

  it('quadrats: uses PlotID in WHERE; 200 when rows; 428 when none', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    exec.mockResolvedValueOnce([{ _1: 1 }]);
    let res = await GET(noopRequest(), makeProps('quadrats', ['myschema', '99', '4']));
    expect(res.status).toBe(HTTPResponses.OK);
    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.quadrats q\s+WHERE q\.PlotID = 99/i);

    exec.mockResolvedValueOnce([]);
    res = await GET(noopRequest(), makeProps('quadrats', ['myschema', '99', '4']));
    expect(res.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);

    expect(close).toHaveBeenCalledTimes(2);
  });

  it('postvalidation: builds expected JOIN/Census filter; 200 when rows; 428 when none', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection');

    exec.mockResolvedValueOnce([{ _1: 1 }]);
    let res = await GET(noopRequest(), makeProps('postvalidation', ['sch', '7', '3']));
    expect(res.status).toBe(HTTPResponses.OK);

    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM sch\.coremeasurements cm/i);
    expect(String(sql)).toMatch(/JOIN sch\.census c ON C\.CensusID = cm\.CensusID/i);
    expect(String(sql)).toMatch(/JOIN sch\.plots p ON p\.PlotID = c\.PlotID/i);
    expect(String(sql)).toMatch(/WHERE p\.PlotID = 7 AND c\.CensusID IN \(SELECT CensusID from sch\.census WHERE PlotID = 7 AND PlotCensusNumber = 3\)/i);

    exec.mockResolvedValueOnce([]);
    res = await GET(noopRequest(), makeProps('postvalidation', ['sch', '7', '3']));
    expect(res.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);

    expect(close).toHaveBeenCalledTimes(2);
  });

  it('default (unknown dataType): returns 428 and closes connection (no DB call)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await GET(noopRequest(), makeProps('wut', ['myschema', '1', '2']));
    expect(res.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);
    expect(exec).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('on DB error: logs via ailogger.error and returns 428; always closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await GET(noopRequest(), makeProps('attributes', ['schema', '1', '1']));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(HTTPResponses.PRECONDITION_VALIDATION_FAILURE);
    expect(logErr).toHaveBeenCalled(); // ailogger.error(e)
    expect(close).toHaveBeenCalledTimes(1);
  });
});
