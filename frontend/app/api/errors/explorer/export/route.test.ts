import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';

const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const EXPORT_CSV_HEADER =
  'CoreMeasurementID,TreeTag,StemTag,SpeciesCode,QuadratName,MeasurementDate,MeasuredDBH,MeasuredHOM,ErrorSource,ErrorCode,ErrorMessage,PriorCensusID,PriorDBH,PriorHOM,HOMChanged';

// Route is wrapped by withRouteAuthz, so auth() runs before the handler.
// A 'global' admin passes the per-site access gate.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}));
  const instance = {
    beginTransaction: vi.fn(async () => 'tx-1'),
    executeQuery: vi.fn(async () => []),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };
  const getInstance = vi.fn(() => instance);
  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/errors/explorer/export', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

function baseFilters() {
  return {
    source: 'all',
    exactMessages: [],
    affectedFields: [],
    contradictionOnly: false,
    contradictionTypes: [],
    quickSearch: ''
  };
}

function baseRawRow(overrides: Record<string, unknown>) {
  return {
    CoreMeasurementID: 101,
    PlotID: 5,
    CensusID: 7,
    QuadratID: 1,
    TreeID: 11,
    StemGUID: 21,
    CoreStemGUID: 21,
    SpeciesID: 31,
    TreeTag: 'TREE-1',
    StemTag: 'A',
    SpeciesName: 'Species 1',
    SubspeciesName: null,
    SpeciesCode: 'SP1',
    QuadratName: 'Q1',
    StemLocalX: 10,
    StemLocalY: 20,
    MeasurementDate: '2026-01-01',
    MeasuredDBH: 5.1,
    MeasuredHOM: 1.3,
    IsValidated: false,
    MeasurementDescription: 'row 101',
    Attributes: null,
    RawCodes: null,
    UserDefinedFields: null,
    UploadFileID: 'file-1',
    UploadBatchID: 'batch-1',
    ValidationCriteria: '',
    ProcedureName: '',
    ...overrides
  };
}

async function readCsvLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split('\r\n').filter(line => line.length > 0);
}

describe('POST /api/errors/explorer/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports one CSV row per error occurrence, not per measurement', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([
        // Measurement 101 carries three unresolved errors: two DBH-change
        // validations (each with its own prior-census snapshot) plus one
        // ingestion error with no comparison context.
        baseRawRow({
          ErrorSource: 'validation',
          ErrorCode: '1',
          DisplayMessage: 'DBH change exceeds threshold',
          PriorCensusID: 6,
          PriorDBH: '10.50',
          PriorHOM: '1.30'
        }),
        baseRawRow({
          ErrorSource: 'validation',
          ErrorCode: '2',
          DisplayMessage: 'DBH change flagged for review',
          PriorCensusID: 6,
          PriorDBH: '11.20',
          PriorHOM: '1.30'
        }),
        baseRawRow({
          ErrorSource: 'ingestion',
          ErrorCode: 'NEGATIVE_DBH',
          DisplayMessage: 'Measured DBH is negative',
          PriorCensusID: null,
          PriorDBH: null,
          PriorHOM: null
        })
      ])
      .mockResolvedValueOnce([]) // duplicate-tag groups
      .mockResolvedValueOnce([]); // same-batch conflict groups

    const response = await POST(
      buildRequest({
        schema: 'forestgeo_testing',
        plotID: 5,
        censusID: 7,
        filters: baseFilters()
      }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const lines = await readCsvLines(response);
    expect(lines[0]).toBe(EXPORT_CSV_HEADER);
    // header + 3 occurrence rows, all for the same CoreMeasurementID.
    expect(lines).toHaveLength(4);
    lines.slice(1).forEach(line => expect(line.startsWith('101,')).toBe(true));
  });

  it('preserves distinct prior-census contexts for the same CoreMeasurementID', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([
        baseRawRow({
          ErrorSource: 'validation',
          ErrorCode: '1',
          DisplayMessage: 'DBH change exceeds threshold',
          PriorCensusID: 6,
          PriorDBH: '10.50',
          PriorHOM: '1.30'
        }),
        baseRawRow({
          ErrorSource: 'validation',
          ErrorCode: '2',
          DisplayMessage: 'DBH change flagged for review',
          PriorCensusID: 6,
          PriorDBH: '11.20',
          PriorHOM: '1.30'
        })
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      buildRequest({
        schema: 'forestgeo_testing',
        plotID: 5,
        censusID: 7,
        filters: baseFilters()
      }),
      ROUTE_CONTEXT
    );

    const lines = await readCsvLines(response);
    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(2);
    expect(dataLines.every(line => line.startsWith('101,'))).toBe(true);
    const priorDbhValues = dataLines.map(line => line.split(',').at(12));
    expect(priorDbhValues).toEqual(expect.arrayContaining(['10.5', '11.2']));
    expect(new Set(priorDbhValues).size).toBe(2);
  });

  it('exports every filtered occurrence across many measurements, with no pagination slice', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const measurementCount = 150;
    const rawRows = Array.from({ length: measurementCount }, (_, index) =>
      baseRawRow({
        CoreMeasurementID: 1000 + index,
        TreeTag: `TREE-${index}`,
        ErrorSource: 'ingestion',
        ErrorCode: 'NEGATIVE_DBH',
        DisplayMessage: 'Measured DBH is negative',
        PriorCensusID: null,
        PriorDBH: null,
        PriorHOM: null
      })
    );
    vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce(rawRows).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await POST(
      buildRequest({
        schema: 'forestgeo_testing',
        plotID: 5,
        censusID: 7,
        filters: baseFilters()
      }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const lines = await readCsvLines(response);
    expect(lines).toHaveLength(measurementCount + 1);
  });

  it('scopes the download filename to the schema, plot, and census', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await POST(
      buildRequest({
        schema: 'forestgeo_testing',
        plotID: 5,
        censusID: 7,
        filters: baseFilters()
      }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    const disposition = response.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('attachment; filename="errors-forestgeo_testing-plot5-census7-');
    expect(disposition).toContain('.csv"');
  });

  it('rejects an invalid schema before ever querying the database', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const querySpy = vi.spyOn(cm, 'executeQuery');

    const response = await POST(
      buildRequest({
        schema: 'not a real schema',
        plotID: 5,
        censusID: 7,
        filters: baseFilters()
      }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('rejects a request missing plotID or censusID', async () => {
    const missingPlot = await POST(buildRequest({ schema: 'forestgeo_testing', censusID: 7, filters: baseFilters() }), ROUTE_CONTEXT);
    expect(missingPlot.status).toBe(HTTPResponses.INVALID_REQUEST);

    const missingCensus = await POST(buildRequest({ schema: 'forestgeo_testing', plotID: 5, filters: baseFilters() }), ROUTE_CONTEXT);
    expect(missingCensus.status).toBe(HTTPResponses.INVALID_REQUEST);
  });
});
