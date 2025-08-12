// app/api/clearallcookies/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
// --- Import the handler AFTER mocks are ready ---
import { POST } from './route';

// --- Mocks (declare BEFORE importing the route) ---
const { deleteCookieMock, infoMock } = vi.hoisted(() => {
  return {
    deleteCookieMock: vi.fn(async () => {}),
    infoMock: vi.fn()
  };
});

vi.mock('@/app/actions/cookiemanager', () => ({
  deleteCookie: deleteCookieMock
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: infoMock,
    error: vi.fn(),
    warn: vi.fn()
  }
}));

// --- Helpers ---
function makeRequest(url = 'http://localhost/api/clearallcookies') {
  return new Request(url, { method: 'POST' }) as any;
}

// --- Tests ---
describe('POST /api/clearallcookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes all expected cookies in order and returns 200 with { cleared: true }', async () => {
    const res = await POST(makeRequest());

    // response shape
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ cleared: true });

    // deleteCookie called with these names, in this order
    const expectedOrder = ['censusID', 'plotID', 'schema', 'quadratID', 'user', 'censusList'];
    expect(deleteCookieMock).toHaveBeenCalledTimes(expectedOrder.length);
    const actualOrder = deleteCookieMock.mock.calls.map((args: any[]) => args[0]);
    expect(actualOrder).toEqual(expectedOrder);

    // logs happen (we won’t assert every line, just that it logged multiple times)
    expect(infoMock).toHaveBeenCalled();
  });

  it('propagates an error if a cookie deletion fails (no try/catch in handler)', async () => {
    // Make the 3rd deletion reject
    deleteCookieMock.mockReset();
    deleteCookieMock
      .mockResolvedValueOnce(undefined) // censusID
      .mockResolvedValueOnce(undefined) // plotID
      .mockRejectedValueOnce(new Error('boom')) // schema
      .mockResolvedValue(undefined); // default for any extra calls

    await expect(POST(makeRequest())).rejects.toThrow(/boom/i);

    // Ensure it attempted the first three in order and stopped after failure
    const calledNames = deleteCookieMock.mock.calls.map((c: any[]) => c[0]);
    expect(calledNames.slice(0, 3)).toEqual(['censusID', 'plotID', 'schema']);
  });
});
