import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrgCensusRDS } from './timekeeping';

let reconcileCurrentCensusSelection: typeof import('./timekeeping').reconcileCurrentCensusSelection;
let OrgCensusToCensusResultMapper: typeof import('./timekeeping').OrgCensusToCensusResultMapper;

beforeAll(async () => {
  vi.unmock('@/lib/db/definitions/timekeeping');
  // The shared auth-mocks setup mocks MapperFactory with 'sites'-only support; the real
  // census mapper is a pure factory (no DB), so use it here rather than the throwing stub.
  vi.unmock('@/config/datamapper');
  ({ reconcileCurrentCensusSelection, OrgCensusToCensusResultMapper } = await import('./timekeeping'));
});

describe('reconcileCurrentCensusSelection', () => {
  const censusList: OrgCensusRDS[] = [
    {
      plotID: 1,
      plotCensusNumber: 2,
      censusIDs: [6],
      dateRanges: [{ censusID: 6, startDate: new Date('2020-01-01'), endDate: new Date('2020-12-31') }],
      description: 'Second census'
    },
    {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [1],
      dateRanges: [{ censusID: 1, startDate: new Date('2010-06-06'), endDate: new Date('2012-10-17') }],
      description: 'First census'
    }
  ];

  it('returns the exact census when the persisted censusID still exists', () => {
    const currentCensus: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [1],
      dateRanges: [{ censusID: 1, startDate: new Date('2010-06-06'), endDate: new Date('2012-10-17') }],
      description: 'Persisted'
    };

    expect(reconcileCurrentCensusSelection(currentCensus, censusList)).toBe(censusList[1]);
  });

  it('falls back to plot census number when the persisted censusID is stale', () => {
    const staleCurrentCensus: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [14],
      dateRanges: [{ censusID: 14, startDate: new Date('2010-06-06'), endDate: new Date('2012-10-17') }],
      description: 'Stale persisted census'
    };

    expect(reconcileCurrentCensusSelection(staleCurrentCensus, censusList)).toBe(censusList[1]);
  });

  it('returns undefined when neither censusID nor plot census number matches', () => {
    const missingCurrentCensus: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 9,
      censusIDs: [99],
      dateRanges: [{ censusID: 99, startDate: new Date('2030-01-01') }],
      description: 'Missing census'
    };

    expect(reconcileCurrentCensusSelection(missingCurrentCensus, censusList)).toBeUndefined();
  });
});

describe('OrgCensusToCensusResultMapper.startNewCensus', () => {
  const SCHEMA = 'forestgeo_harvard';
  const PLOT_ID = 12;
  const PLOT_CENSUS_NUMBER = 1;
  // MySQL DATE literal shape; anything with 'T'/'Z' (a full ISO timestamp) is rejected by
  // a DATE column under strict sql_mode with error 1292.
  const MYSQL_DATE_LITERAL = /^\d{4}-\d{2}-\d{2}$/;
  // Native date inputs expose date-only strings; keep them intact through persistence.
  const PICKED_START = '2026-07-20';
  const PICKED_END = '2026-08-15';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch(response: { ok: boolean; status: number; json?: unknown; text?: string }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: async () => response.json,
      text: async () => response.text ?? ''
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
    return JSON.parse(fetchMock.mock.calls[0][1].body).newRow;
  }

  it('serializes dates as date-only strings a MySQL DATE column accepts, not ISO timestamps', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: { createdIDs: { census: 42 } } });

    const createdID = await new OrgCensusToCensusResultMapper().startNewCensus(SCHEMA, PLOT_ID, PLOT_CENSUS_NUMBER, {
      startDate: PICKED_START,
      endDate: PICKED_END,
      description: 'Harvard Forest census 1'
    });

    expect(createdID).toBe(42);
    const body = bodyOf(fetchMock);
    // The bug: JSON.stringify(Date) produced '2026-07-20T...Z', which strict MySQL rejects.
    expect(body.startDate).toMatch(MYSQL_DATE_LITERAL);
    expect(body.endDate).toMatch(MYSQL_DATE_LITERAL);
    // Preserves the calendar day the user picked (no UTC off-by-one) in any timezone.
    expect(body.startDate).toBe('2026-07-20');
    expect(body.endDate).toBe('2026-08-15');
  });

  it('omits an optional end date without emitting a bogus value', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: { createdIDs: { census: 7 } } });

    await new OrgCensusToCensusResultMapper().startNewCensus(SCHEMA, PLOT_ID, PLOT_CENSUS_NUMBER, { startDate: PICKED_START });

    const body = bodyOf(fetchMock);
    expect(body.startDate).toBe('2026-07-20');
    expect(body.endDate).toBeUndefined();
  });

  it('does not normalize a selected calendar day through the local timezone', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: { createdIDs: { census: 8 } } });

    // 2011-12-30 did not exist in Pacific/Apia. Converting this input through a
    // local Date would silently normalize it to 2011-12-31.
    await new OrgCensusToCensusResultMapper().startNewCensus(SCHEMA, PLOT_ID, PLOT_CENSUS_NUMBER, { startDate: '2011-12-30' });

    expect(bodyOf(fetchMock).startDate).toBe('2011-12-30');
  });

  it('surfaces a failed insert instead of swallowing it into a property-access error', async () => {
    stubFetch({ ok: false, status: 500, text: "Incorrect date value for column 'StartDate'" });

    await expect(new OrgCensusToCensusResultMapper().startNewCensus(SCHEMA, PLOT_ID, PLOT_CENSUS_NUMBER, { startDate: PICKED_START })).rejects.toThrow(
      /Census creation failed \(HTTP 500\).*Incorrect date value/
    );
  });
});
