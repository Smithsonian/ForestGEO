import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import UploadFireSQL from './uploadfiresql';
import { FileWithStream, ReviewStates, type UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

const startValidation = vi.fn();

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 7, plotName: 'Test Plot', dimensionX: 100, dimensionY: 100 }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 3 }] })
}));

vi.mock('@/app/hooks/usebackgroundvalidation', () => ({
  useBackgroundValidation: () => ({ startValidation })
}));

vi.mock('@/app/hooks/useuploadsession', () => ({
  useUploadSession: () => ({
    sessionId: 'test-session-id',
    getCurrentSessionId: () => 'test-session-id',
    createSession: vi.fn().mockResolvedValue('test-session-id'),
    updateState: vi.fn().mockResolvedValue(undefined),
    completeSession: vi.fn().mockResolvedValue(undefined),
    cancelSession: vi.fn().mockResolvedValue(undefined),
    isSessionActive: true
  })
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Test User' } }, status: 'authenticated' })
}));

vi.mock('@/app/contexts/animationcacheprovider', () => ({
  useAnimationCacheContext: () => ({ getAnimationUrl: (path: string) => path })
}));

// The real player loads a WASM asset over the network and requires IntersectionObserver, neither
// of which exist in this unit-test environment; the progress animation is not under test here.
vi.mock('@lottiefiles/dotlottie-react', () => ({
  DotLottieReact: () => null
}));

function buildQuadratFile(): FileWithStream {
  const csvContent = ['quadrat,startx,starty,dimx,dimy,area,quadratshape', 'Q0001,0,0,20,20,400,square'].join('\n');
  const raw = new File([csvContent], 'quadrats.csv', { type: 'text/csv' });
  return new FileWithStream(raw, false);
}

function buildMultiChunkQuadratFile(): FileWithStream {
  const rows = Array.from(
    { length: 10_000 },
    (_, index) => `Q${String(index + 1).padStart(5, '0')},${index % 100},${Math.floor(index / 100)},1,1,1,square,valid-multi-chunk-regression-row`
  );
  const csvContent = ['quadrat,startx,starty,dimx,dimy,area,quadratshape,notes', ...rows].join('\n');
  const raw = new File([csvContent], 'quadrats-multi-chunk.csv', { type: 'text/csv' });
  return new FileWithStream(raw, false);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('UploadFireSQL — the /api/sqlpacketload request body', () => {
  const fetchMock = vi.fn();
  const setReviewState = vi.fn();
  const setIsDataUnsaved = vi.fn();
  const setUploadError = vi.fn();
  const setErrorComponent = vi.fn();
  const setUploadOutcome = vi.fn();
  const setAllRowToCMID = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    setReviewState.mockReset();
    setIsDataUnsaved.mockReset();
    setUploadError.mockReset();
    setErrorComponent.mockReset();
    setUploadOutcome.mockReset();
    setAllRowToCMID.mockReset();
    startValidation.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ transactionCompleted: true, batchID: 'BATCH-TEST' })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderQuadratUpload() {
    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.quadrats,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [buildQuadratFile()],
      parsedData: {},
      selectedDelimiters: { 'quadrats.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };
    return render(<UploadFireSQL {...props} />);
  }

  // Quadrats uploads (non-measurements) never populate `rawPayload`, so uploadToSql always takes
  // the `fileRowSet` JSON.stringify branch — the real production path a quadrat file travels.
  it('sends a quadrats upload through the fileRowSet branch, with no coordinate-orientation field', async () => {
    renderQuadratUpload();

    await waitFor(() => {
      const sqlPacketLoadCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload'));
      expect(sqlPacketLoadCalls.length).toBeGreaterThan(0);
    });

    const sqlPacketLoadCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/api/sqlpacketload'));
    expect(sqlPacketLoadCall).toBeDefined();
    const requestInit = sqlPacketLoadCall?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));

    expect(requestBody.formType).toBe(FormType.quadrats);
    // Coordinates are south-west by definition, so the client must not negotiate an orientation.
    expect(requestBody.coordinateReferenceCorner).toBeUndefined();
    // fileRowSet branch: the request must NOT carry rawRows (that is the measurements-mapping branch).
    expect(requestBody.fileRowSet).toBeDefined();
    expect(requestBody.rawRows).toBeUndefined();
  });

  it('returns a server-discovered overlap challenge to the review step instead of a generic error', async () => {
    const overlapSummary = {
      layoutSignature: 'quadrat-layout-v1-0123456789abcdef',
      reportedPairCount: 1,
      minimumPairCount: 1,
      truncated: false,
      pairs: [{ key: 'pair-1', message: 'Quadrat "Q0001" overlaps quadrat "EXISTING".' }]
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT',
          error: 'Review and confirm overlaps.',
          overlapSummaries: [overlapSummary]
        },
        400
      )
    );
    const onAcknowledgmentRequired = vi.fn();

    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.quadrats,
      uploadMode: UploadMode.REVISIONS,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [buildQuadratFile()],
      parsedData: {},
      selectedDelimiters: { 'quadrats.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: onAcknowledgmentRequired,
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };
    render(<UploadFireSQL {...props} />);

    await waitFor(() => {
      expect(onAcknowledgmentRequired).toHaveBeenCalledWith([overlapSummary]);
    });
    expect(setUploadError).not.toHaveBeenCalled();
    expect(setReviewState).not.toHaveBeenCalledWith(ReviewStates.ERRORS);
  });

  it('uploads a quadrat file atomically in one clean-reupload request', async () => {
    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.quadrats,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [buildMultiChunkQuadratFile()],
      parsedData: {},
      selectedDelimiters: { 'quadrats-multi-chunk.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };

    render(<UploadFireSQL {...props} />);

    await waitFor(
      () => {
        const sqlPacketLoadCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload'));
        expect(sqlPacketLoadCalls.length).toBe(1);
      },
      { timeout: 10_000 }
    );

    const requestBodies = fetchMock.mock.calls
      .filter(call => String(call[0]).includes('/api/sqlpacketload'))
      .map(call => JSON.parse(String((call[1] as RequestInit).body)));
    expect(requestBodies.map(body => body.uploadMode)).toEqual([UploadMode.CLEAN_REUPLOAD]);
    // #507: the fileRowSet (client-resolved) branch must also send chunkSequence,
    // not only the rawPayload (server-resolved) branch.
    expect(requestBodies[0].chunkSequence).toBe(1);
  });

  it.each([
    { form: FormType.species, headers: 'spcode,species,authority', key: 'spcode', row: (code: string) => `${code},alba,${'authority '.repeat(10)}` },
    { form: FormType.attributes, headers: 'code,description,status', key: 'code', row: (code: string) => `${code},${'description '.repeat(10)},alive` },
    {
      form: FormType.personnel,
      headers: 'firstname,lastname,role,roledescription',
      key: 'firstname',
      row: (code: string) => `${code},Tester,Recorder,${'description '.repeat(10)}`
    }
  ])('preserves every row of a $form file larger than 256 KB in one clean-reupload request (#472)', async ({ form, headers, key, row }) => {
    const codes = Array.from({ length: 3_000 }, (_, index) => `R${String(index).padStart(5, '0')}`);
    const file = new FileWithStream(new File([[headers, ...codes.map(row)].join('\n')], `${form}.csv`, { type: 'text/csv' }), false);
    expect(file.size).toBeGreaterThan(256 * 1024);

    render(
      <UploadFireSQL
        schema="forestgeo_testing"
        uploadForm={form}
        uploadMode={UploadMode.CLEAN_REUPLOAD}
        sourceFormat={SourceFormat.csv}
        personnelRecording=""
        acceptedFiles={[file]}
        parsedData={{}}
        selectedDelimiters={{ [file.name]: ',' }}
        setUploadOutcome={setUploadOutcome}
        setIsDataUnsaved={setIsDataUnsaved}
        setUploadError={setUploadError}
        setErrorComponent={setErrorComponent}
        setReviewState={setReviewState}
        setAllRowToCMID={setAllRowToCMID}
      />
    );

    // Wait until the entire SQL upload finishes: checking at the first request can
    // pass while a later chunk is still queued to delete the rows it just inserted.
    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.UPLOAD_AZURE), { timeout: 10_000 });
    expect(setUploadError).not.toHaveBeenCalled();

    const requests = fetchMock.mock.calls
      .filter(call => String(call[0]).includes('/api/sqlpacketload'))
      .map(call => JSON.parse(String((call[1] as RequestInit).body)));
    expect(requests).toHaveLength(1);
    expect(requests[0].uploadMode).toBe(UploadMode.CLEAN_REUPLOAD);
    const uploadedRows = Object.values(requests[0].fileRowSet) as Record<string, string>[];
    expect(uploadedRows).toHaveLength(codes.length);
    expect(new Set(uploadedRows.map(uploadedRow => uploadedRow[key]))).toEqual(new Set(codes));
  });
  it('rejects a compact reference file above the row limit before sending any rows', async () => {
    const csv = ['code,description,status', ...Array.from({ length: 10001 }, (_, i) => `A${i},description,alive`)].join('\n');
    const file = new FileWithStream(new File([csv], 'attributes.csv', { type: 'text/csv' }), false);
    expect(file.size).toBeLessThan(8 * 1024 * 1024);
    render(
      <UploadFireSQL
        schema="forestgeo_testing"
        uploadForm={FormType.attributes}
        uploadMode={UploadMode.CLEAN_REUPLOAD}
        sourceFormat={SourceFormat.csv}
        personnelRecording=""
        acceptedFiles={[file]}
        parsedData={{}}
        selectedDelimiters={{ 'attributes.csv': ',' }}
        quadratOverlapAcknowledgment={null}
        onQuadratOverlapAcknowledgmentRequired={vi.fn()}
        setUploadOutcome={setUploadOutcome}
        setIsDataUnsaved={setIsDataUnsaved}
        setUploadError={setUploadError}
        setErrorComponent={setErrorComponent}
        setReviewState={setReviewState}
        setAllRowToCMID={setAllRowToCMID}
      />
    );
    await waitFor(() => expect(setUploadError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('10,000 rows per file') })));
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload'))).toHaveLength(0);
  });
});

// The rawPayload branch is only reachable on the measurements + column-mapping flow. Covered
// separately so a later encoding change cannot silently diverge the two JSON.stringify branches.
describe('UploadFireSQL — the rawPayload request branch (measurements/mapping flow)', () => {
  const fetchMock = vi.fn();
  const setReviewState = vi.fn();
  const setIsDataUnsaved = vi.fn();
  const setUploadError = vi.fn();
  const setErrorComponent = vi.fn();
  const setUploadOutcome = vi.fn();
  const setAllRowToCMID = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    setReviewState.mockReset();
    setIsDataUnsaved.mockReset();
    setUploadError.mockReset();
    setErrorComponent.mockReset();
    setUploadOutcome.mockReset();
    setAllRowToCMID.mockReset();
    startValidation.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ transactionCompleted: true, batchID: 'BATCH-TEST', failingRows: [] })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([1, 10_001])('sends all %i measurement rows through the rawPayload branch, retaining chunking for large files', async rowCount => {
    const csvContent = ['tag,spcode,quadrat,lx,ly,date', ...Array.from({ length: rowCount }, (_, index) => `${index + 1},ABAL,Q0001,1.5,2.5,2020-01-01`)].join(
      '\n'
    );
    const raw = new File([csvContent], 'measurements.csv', { type: 'text/csv' });
    const file = new FileWithStream(raw, false);

    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.measurements,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [file],
      parsedData: {},
      selectedDelimiters: { 'measurements.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };

    render(<UploadFireSQL {...props} />);

    const requestBodies = () =>
      fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload')).map(call => JSON.parse(String((call[1] as RequestInit).body)));
    // The 10,000-row case parses ~330KB in jsdom before the last chunk is requested; the default
    // 1s waitFor budget is enough locally but not under CI load.
    await waitFor(() => expect(requestBodies().flatMap(body => body.rawRows)).toHaveLength(rowCount), { timeout: 10_000 });

    const requests = requestBodies();
    if (rowCount > 1) {
      expect(file.size).toBeGreaterThan(256 * 1024);
      expect(requests.length).toBeGreaterThan(1);
    } else {
      expect(requests).toHaveLength(1);
    }
    for (const requestBody of requests) {
      // rawPayload branch: the request must carry rawRows, not a fileRowSet.
      expect(requestBody.rawRows).toBeDefined();
      expect(requestBody.fileRowSet).toBeUndefined();
    }

    // #507: every chunk request must carry its own stable 1-based chunkSequence
    // (PapaParse's actualChunkCount at parse time), and every chunk of this
    // upload must occupy a DISTINCT position — proving two different chunks
    // never collapse onto the same identity even though the queue may upload
    // them out of parse order.
    const chunkSequences = requests.map(requestBody => requestBody.chunkSequence);
    for (const value of chunkSequences) {
      expect(Number.isInteger(value) && value > 0, `chunkSequence must be a positive integer, got ${JSON.stringify(value)}`).toBe(true);
    }
    expect([...chunkSequences].sort((a, b) => a - b)).toEqual(Array.from({ length: requests.length }, (_, index) => index + 1));
  });

  // Issue #504: skipEmptyLines must be 'greedy' for measurements specifically, so a delimiter-only
  // padding row is skipped before staging and never trips the staging guard. Other form types
  // retain their existing (boolean `true`) parsing behavior.
  it('excludes delimiter-only padding rows from rawRows for a measurements file, sending only the real data rows', async () => {
    const csvContent = [
      'tag,spcode,quadrat,lx,ly,date',
      '1,ABAL,Q0001,1.5,2.5,2020-01-01',
      ',,,,,', // delimiter-only padding: 5 commas for the 6 header columns
      '2,ABAL,Q0001,3.5,4.5,2020-01-02'
    ].join('\n');
    const raw = new File([csvContent], 'measurements.csv', { type: 'text/csv' });
    const file = new FileWithStream(raw, false);

    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.measurements,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [file],
      parsedData: {},
      selectedDelimiters: { 'measurements.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };

    render(<UploadFireSQL {...props} />);

    const requestBodies = () =>
      fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload')).map(call => JSON.parse(String((call[1] as RequestInit).body)));

    await waitFor(() => expect(requestBodies().flatMap(body => body.rawRows)).toHaveLength(2));

    const sentTags = requestBodies()
      .flatMap(body => body.rawRows)
      .map((rawRow: Record<string, unknown>) => rawRow.tag);
    expect(new Set(sentTags)).toEqual(new Set(['1', '2']));
  });

  // A row the server rejects (data.failingRows) is pushed straight to /api/batchedupload so the
  // failed measurement can be recovered later. Its plot coordinates must survive that hop, or a
  // failed row's RawPlotX/RawPlotY end up NULL even when the source file carried px/py.
  it('carries plotX/plotY from a server-rejected row into the /api/batchedupload payload', async () => {
    const csvContent = ['tag,spcode,quadrat,lx,ly,date', '1,ABAL,Q0001,1.5,2.5,2020-01-01'].join('\n');
    const raw = new File([csvContent], 'measurements.csv', { type: 'text/csv' });
    const file = new FileWithStream(raw, false);

    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      if (String(url).includes('/api/sqlpacketload')) {
        return Promise.resolve(
          jsonResponse({
            transactionCompleted: true,
            batchID: 'BATCH-TEST',
            failingRows: [
              {
                tag: '2',
                spcode: 'ABAL',
                quadrat: 'Q0001',
                lx: '1.5',
                ly: '2.5',
                px: 0,
                py: '267.5',
                date: '2020-01-01',
                failureReason: 'Duplicate row'
              }
            ]
          })
        );
      }
      return Promise.resolve(jsonResponse({ message: 'Inserted ingestion error rows', rowCount: 1 }));
    });

    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.measurements,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [file],
      parsedData: {},
      selectedDelimiters: { 'measurements.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };

    render(<UploadFireSQL {...props} />);

    await waitFor(() => {
      const batchedUploadCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/batchedupload'));
      expect(batchedUploadCalls.length).toBeGreaterThan(0);
    });

    const batchedUploadCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/api/batchedupload'));
    expect(batchedUploadCall).toBeDefined();
    const requestBody = JSON.parse(String((batchedUploadCall?.[1] as RequestInit).body));

    expect(requestBody).toHaveLength(1);
    expect(requestBody[0].plotX).toBe(0);
    expect(requestBody[0].plotY).toBe('267.5');
  });
});

// Drives the measurements path end to end through the mocked endpoints the real
// component calls, so the outcome is checked against what /api/verifysession returns.
describe('UploadFireSQL — the reconciled upload outcome (#525 item 4)', () => {
  const fetchMock = vi.fn();
  const setReviewState = vi.fn();
  const setIsDataUnsaved = vi.fn();
  const setUploadError = vi.fn();
  const setErrorComponent = vi.fn();
  const setUploadOutcome = vi.fn();
  const setAllRowToCMID = vi.fn();
  const UPLOAD_COMPLETION_TIMEOUT_MS = 10_000;
  const SQL_PACKET_LOAD_PATH = '/api/sqlpacketload';
  const ARCGIS_FILE_NAME = 'arcgis-import.xlsx';
  const ARCGIS_STAGED_ROWS = 4;
  const ARCGIS_COMMITTED_ROWS = 3;

  interface VerifiedCounts {
    processedCount: number;
    failedCount: number;
  }

  function buildMeasurementFile(fileName: string, rowCount: number): FileWithStream {
    const rows = Array.from({ length: rowCount }, (_, index) => `${index + 1},ABAL,Q0001,1.5,2.5,2020-01-01`);
    return new FileWithStream(new File([['tag,spcode,quadrat,lx,ly,date', ...rows].join('\n')], fileName, { type: 'text/csv' }), false);
  }

  function routeMeasurementUpload(
    stagedRowsByFile: Record<string, number>,
    verifiedByFile: Record<string, VerifiedCounts>,
    sqlPacketLoadExtras: Record<string, unknown> = {}
  ) {
    return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === SQL_PACKET_LOAD_PATH) {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(jsonResponse({ transactionCompleted: true, batchID: body.batchID, failingRows: [], ...sqlPacketLoadExtras }));
      }
      if (url.pathname === '/api/arcgis/commit') return Promise.resolve(jsonResponse({ rowCount: ARCGIS_COMMITTED_ROWS }));
      if (url.pathname === '/api/verifyupload') return Promise.resolve(jsonResponse({ count: stagedRowsByFile[url.searchParams.get('fileName') ?? ''] }));
      if (url.pathname === '/api/verifyprocessing') return Promise.resolve(jsonResponse({ processedCount: 0, failedCount: 0, remainingCount: 0 }));
      if (url.pathname === '/api/verifysession') return Promise.resolve(jsonResponse(verifiedByFile[url.searchParams.get('fileID') ?? '']));
      return Promise.resolve(jsonResponse({ message: 'ok' }));
    };
  }

  function renderMeasurementUpload(acceptedFiles: FileWithStream[], overrides: Partial<UploadFireProps> = {}) {
    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.measurements,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles,
      parsedData: {},
      selectedDelimiters: Object.fromEntries(acceptedFiles.map(file => [file.name, ','])),
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadOutcome,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID,
      ...overrides
    };
    return render(<UploadFireSQL {...props} />);
  }

  function recordedOutcomes() {
    return setUploadOutcome.mock.calls.map(([outcome]) => outcome).filter(outcome => outcome !== undefined);
  }

  function logCalls(label: string) {
    console.log(
      `[#525 item 4] ${label}: setUploadOutcome=${JSON.stringify(setUploadOutcome.mock.calls)} reviewStates=${JSON.stringify(setReviewState.mock.calls)} uploadError=${String(setUploadError.mock.calls[0]?.[0]?.message ?? '')}`
    );
  }

  function callOrderOf(mock: ReturnType<typeof vi.fn>, predicate: (args: unknown[]) => boolean): number {
    const index = mock.mock.calls.findIndex(predicate);
    expect(index, 'expected the call to have happened').toBeGreaterThanOrEqual(0);
    return mock.mock.invocationCallOrder[index];
  }

  beforeEach(() => {
    for (const mock of [fetchMock, setReviewState, setIsDataUnsaved, setUploadError, setErrorComponent, setUploadOutcome, setAllRowToCMID, startValidation])
      mock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records the verified totals once, before moving to UPLOAD_AZURE', async () => {
    fetchMock.mockImplementation(routeMeasurementUpload({ 'measurements.csv': 3 }, { 'measurements.csv': { processedCount: 2, failedCount: 1 } }));
    renderMeasurementUpload([buildMeasurementFile('measurements.csv', 3)]);

    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.UPLOAD_AZURE), { timeout: UPLOAD_COMPLETION_TIMEOUT_MS });
    logCalls('single file');
    expect(recordedOutcomes()).toEqual([{ kind: 'ingestion', sourceRows: 3, insertedRows: 2, failedRows: 1 }]);
    expect(callOrderOf(setUploadOutcome, ([outcome]) => outcome !== undefined)).toBeLessThan(
      callOrderOf(setReviewState, ([state]) => state === ReviewStates.UPLOAD_AZURE)
    );
  });

  it('sums the verified totals across files', async () => {
    fetchMock.mockImplementation(
      routeMeasurementUpload(
        { 'first.csv': 3, 'second.csv': 2 },
        { 'first.csv': { processedCount: 2, failedCount: 1 }, 'second.csv': { processedCount: 2, failedCount: 0 } }
      )
    );
    renderMeasurementUpload([buildMeasurementFile('first.csv', 3), buildMeasurementFile('second.csv', 2)]);

    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.UPLOAD_AZURE), { timeout: UPLOAD_COMPLETION_TIMEOUT_MS });
    logCalls('two files');
    expect(recordedOutcomes()).toEqual([{ kind: 'ingestion', sourceRows: 5, insertedRows: 4, failedRows: 1 }]);
  });

  it('ignores a large per-chunk droppedCount and reports only the verified totals', async () => {
    const replayInflatedDroppedCount = 999;
    fetchMock.mockImplementation(
      routeMeasurementUpload(
        { 'measurements.csv': 3 },
        { 'measurements.csv': { processedCount: 2, failedCount: 1 } },
        {
          dataIntegrityWarning: true,
          expectedCount: 3,
          insertedCount: 0,
          droppedCount: replayInflatedDroppedCount
        }
      )
    );
    renderMeasurementUpload([buildMeasurementFile('measurements.csv', 3)]);

    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.UPLOAD_AZURE), { timeout: UPLOAD_COMPLETION_TIMEOUT_MS });
    logCalls('large droppedCount');
    expect(recordedOutcomes()).toEqual([{ kind: 'ingestion', sourceRows: 3, insertedRows: 2, failedRows: 1 }]);
  });

  it('never records an outcome when reconciliation fails, and goes to ERRORS', async () => {
    fetchMock.mockImplementation(routeMeasurementUpload({ 'measurements.csv': 3 }, { 'measurements.csv': { processedCount: 1, failedCount: 1 } }));
    renderMeasurementUpload([buildMeasurementFile('measurements.csv', 3)]);

    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.ERRORS), { timeout: UPLOAD_COMPLETION_TIMEOUT_MS });
    logCalls('mismatch');
    expect(recordedOutcomes()).toEqual([]);
    expect(setUploadError.mock.calls[0]?.[0]?.message).toContain('Upload reconciliation failed');
  });

  it('clears any previous outcome before the first /api/sqlpacketload request of a fresh attempt', async () => {
    fetchMock.mockImplementation(routeMeasurementUpload({ 'measurements.csv': 3 }, { 'measurements.csv': { processedCount: 2, failedCount: 1 } }));
    renderMeasurementUpload([buildMeasurementFile('measurements.csv', 3)]);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes(SQL_PACKET_LOAD_PATH))).toBe(true), {
      timeout: UPLOAD_COMPLETION_TIMEOUT_MS
    });
    logCalls('fresh attempt');
    expect(callOrderOf(setUploadOutcome, ([outcome]) => outcome === undefined)).toBeLessThan(
      callOrderOf(fetchMock, ([url]) => String(url).includes(SQL_PACKET_LOAD_PATH))
    );
  });

  it('does not count an ArcGIS commit drop twice: failed equals the verified failedCount', async () => {
    fetchMock.mockImplementation(
      routeMeasurementUpload({ [ARCGIS_FILE_NAME]: ARCGIS_COMMITTED_ROWS }, { [ARCGIS_FILE_NAME]: { processedCount: 3, failedCount: 1 } })
    );
    const arcgisFile = new FileWithStream(new File(['xlsx'], ARCGIS_FILE_NAME), false);
    renderMeasurementUpload([arcgisFile], {
      sourceFormat: SourceFormat.arcgis_xlsx,
      arcgisImportSession: { importSessionId: 'arcgis-session-525', fileName: ARCGIS_FILE_NAME, rowCount: ARCGIS_STAGED_ROWS },
      selectedDelimiters: {}
    });

    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.UPLOAD_AZURE), { timeout: UPLOAD_COMPLETION_TIMEOUT_MS });
    logCalls('ArcGIS');
    expect(recordedOutcomes()).toEqual([{ kind: 'ingestion', sourceRows: ARCGIS_STAGED_ROWS, insertedRows: 3, failedRows: 1 }]);
  });
});
