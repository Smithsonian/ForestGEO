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
  const setUploadCompleteMessage = vi.fn();
  const setAllRowToCMID = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    setReviewState.mockReset();
    setIsDataUnsaved.mockReset();
    setUploadError.mockReset();
    setErrorComponent.mockReset();
    setUploadCompleteMessage.mockReset();
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
      uploadCompleteMessage: '',
      selectedDelimiters: { 'quadrats.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadCompleteMessage,
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
      uploadCompleteMessage: '',
      selectedDelimiters: { 'quadrats.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: onAcknowledgmentRequired,
      setUploadCompleteMessage,
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
      uploadCompleteMessage: '',
      selectedDelimiters: { 'quadrats-multi-chunk.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadCompleteMessage,
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

    const requestModes = fetchMock.mock.calls
      .filter(call => String(call[0]).includes('/api/sqlpacketload'))
      .map(call => JSON.parse(String((call[1] as RequestInit).body)).uploadMode);
    expect(requestModes).toEqual([UploadMode.CLEAN_REUPLOAD]);
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
  const setUploadCompleteMessage = vi.fn();
  const setAllRowToCMID = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    setReviewState.mockReset();
    setIsDataUnsaved.mockReset();
    setUploadError.mockReset();
    setErrorComponent.mockReset();
    setUploadCompleteMessage.mockReset();
    setAllRowToCMID.mockReset();
    startValidation.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ transactionCompleted: true, batchID: 'BATCH-TEST', failingRows: [] })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a measurements upload through the rawPayload branch', async () => {
    const csvContent = ['tag,spcode,quadrat,lx,ly,date', '1,ABAL,Q0001,1.5,2.5,2020-01-01'].join('\n');
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
      uploadCompleteMessage: '',
      selectedDelimiters: { 'measurements.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadCompleteMessage,
      setIsDataUnsaved,
      setUploadError,
      setErrorComponent,
      setReviewState,
      setAllRowToCMID
    };

    render(<UploadFireSQL {...props} />);

    await waitFor(() => {
      const sqlPacketLoadCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload'));
      expect(sqlPacketLoadCalls.length).toBeGreaterThan(0);
    });

    const sqlPacketLoadCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/api/sqlpacketload'));
    const requestBody = JSON.parse(String((sqlPacketLoadCall?.[1] as RequestInit).body));

    // rawPayload branch: the request must carry rawRows, not a fileRowSet.
    expect(requestBody.rawRows).toBeDefined();
    expect(requestBody.fileRowSet).toBeUndefined();
  });
});
