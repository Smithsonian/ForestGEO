import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import UploadFireSQL from './uploadfiresql';
import { FileWithStream, type UploadFireProps } from '@/config/macros/uploadsystemmacros';
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

vi.mock('@lottiefiles/dotlottie-react', () => ({
  DotLottieReact: () => null
}));

const SQL_PACKET_LOAD_ENDPOINT = '/api/sqlpacketload';
const MEASUREMENT_ROW_COUNT = 30_001;
const MINIMUM_CHUNK_COUNT = 3;
const FIRST_REQUEST_RESOLVE_DELAY_MS = 300;
const UPLOAD_TIMEOUT_MS = 15_000;
const MEASUREMENTS_FILE_NAME = 'measurements.csv';

interface RecordedRequest {
  callIndex: number;
  body: Record<string, unknown>;
}

interface ChunkSummary {
  callIndex: number;
  firstRowOrdinal: unknown;
  rowCount: number;
  firstTag: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function buildMeasurementsFile(): FileWithStream {
  const rows = Array.from({ length: MEASUREMENT_ROW_COUNT }, (_, index) => `${index + 1},ABAL,Q0001,1.5,2.5,2020-01-01`);
  return new FileWithStream(new File([['tag,spcode,quadrat,lx,ly,date', ...rows].join('\n')], MEASUREMENTS_FILE_NAME, { type: 'text/csv' }), false);
}

function buildAttributesFile(): FileWithStream {
  const rows = Array.from({ length: 50 }, (_, index) => `A${index},description ${index},alive`);
  return new FileWithStream(new File([['code,description,status', ...rows].join('\n')], 'attributes.csv', { type: 'text/csv' }), false);
}

describe('UploadFireSQL — firstRowOrdinal on /api/sqlpacketload', () => {
  const fetchMock = vi.fn();
  const resolutionOrder: number[] = [];
  const setReviewState = vi.fn();
  const setUploadError = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    resolutionOrder.length = 0;
    setReviewState.mockReset();
    setUploadError.mockReset();
    startValidation.mockReset();
    let sqlPacketLoadCallCount = 0;
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (!String(url).includes(SQL_PACKET_LOAD_ENDPOINT)) {
        return jsonResponse({ transactionCompleted: true });
      }
      const callIndex = sqlPacketLoadCallCount++;
      if (callIndex === 0) {
        await new Promise(resolve => setTimeout(resolve, FIRST_REQUEST_RESOLVE_DELAY_MS));
      }
      resolutionOrder.push(callIndex);
      return jsonResponse({ transactionCompleted: true, batchID: 'BATCH-TEST', failingRows: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderUpload(uploadForm: FormType, uploadMode: UploadMode, file: FileWithStream) {
    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm,
      uploadMode,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [file],
      parsedData: {},
      uploadCompleteMessage: '',
      selectedDelimiters: { [file.name]: ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadCompleteMessage: vi.fn(),
      setIsDataUnsaved: vi.fn(),
      setUploadError,
      setErrorComponent: vi.fn(),
      setReviewState,
      setAllRowToCMID: vi.fn()
    };
    return render(<UploadFireSQL {...props} />);
  }

  const recordedRequests = (): RecordedRequest[] =>
    fetchMock.mock.calls
      .filter(call => String(call[0]).includes(SQL_PACKET_LOAD_ENDPOINT))
      .map((call, callIndex) => ({ callIndex, body: JSON.parse(String((call[1] as RequestInit).body)) }));

  const rowsOf = (body: Record<string, unknown>): Record<string, string>[] =>
    body.rawRows
      ? (body.rawRows as Record<string, string>[])
      : (Object.values(body.fileRowSet as Record<string, Record<string, string>>) as Record<string, string>[]);

  const summarize = (requests: RecordedRequest[]): ChunkSummary[] =>
    requests.map(({ callIndex, body }) => {
      const rows = rowsOf(body);
      const tags = rows.map(row => Number(row.tag));
      return { callIndex, firstRowOrdinal: body.firstRowOrdinal, rowCount: rows.length, firstTag: Math.min(...tags) };
    });

  async function uploadMeasurementsAndSummarize(uploadMode: UploadMode): Promise<ChunkSummary[]> {
    renderUpload(FormType.measurements, uploadMode, buildMeasurementsFile());
    await waitFor(
      () => {
        const uploadedRowCount = recordedRequests().reduce((sum, request) => sum + rowsOf(request.body).length, 0);
        expect(uploadedRowCount).toBe(MEASUREMENT_ROW_COUNT);
      },
      { timeout: UPLOAD_TIMEOUT_MS }
    );
    await waitFor(() => expect(resolutionOrder).toHaveLength(recordedRequests().length), { timeout: UPLOAD_TIMEOUT_MS });
    const summaries = summarize(recordedRequests());
    console.log(`[${uploadMode}] resolution order of requests:`, resolutionOrder);
    console.log(`[${uploadMode}] fileName/firstRowOrdinal/rowCount/firstTag per request:`, JSON.stringify(summaries));
    return summaries;
  }

  function expectOrdinalsToBeCumulativeRowOffsets(summaries: ChunkSummary[]) {
    expect(summaries.length).toBeGreaterThanOrEqual(MINIMUM_CHUNK_COUNT);
    const inFileOrder = [...summaries].sort((a, b) => a.firstTag - b.firstTag);
    let expectedOrdinal = 0;
    for (const chunk of inFileOrder) {
      expect(chunk.firstRowOrdinal).toBe(expectedOrdinal);
      expect(chunk.firstTag).toBe(expectedOrdinal + 1);
      expectedOrdinal += chunk.rowCount;
    }
    expect(expectedOrdinal).toBe(MEASUREMENT_ROW_COUNT);
  }

  it('sends the cumulative row offset of each chunk on the mapping (rawRows) path, with the first request deliberately slow', async () => {
    const summaries = await uploadMeasurementsAndSummarize(UploadMode.CLEAN_REUPLOAD);

    expect(summaries.every(summary => summary.firstRowOrdinal !== undefined)).toBe(true);
    expect(recordedRequests().every(request => request.body.rawRows !== undefined)).toBe(true);
    expectOrdinalsToBeCumulativeRowOffsets(summaries);
  });

  it('sends the same raw-row offsets on the legacy fileRowSet path', async () => {
    const summaries = await uploadMeasurementsAndSummarize(UploadMode.REVISIONS);

    expect(recordedRequests().every(request => request.body.fileRowSet !== undefined && request.body.rawRows === undefined)).toBe(true);
    expectOrdinalsToBeCumulativeRowOffsets(summaries);
  });

  it('sends no firstRowOrdinal for a non-measurement form', async () => {
    renderUpload(FormType.attributes, UploadMode.CLEAN_REUPLOAD, buildAttributesFile());
    await waitFor(() => expect(recordedRequests().length).toBeGreaterThan(0), { timeout: UPLOAD_TIMEOUT_MS });
    await waitFor(() => expect(resolutionOrder).toHaveLength(recordedRequests().length), { timeout: UPLOAD_TIMEOUT_MS });

    const bodies = recordedRequests().map(request => request.body);
    console.log('attributes request bodies keys:', JSON.stringify(bodies.map(body => Object.keys(body))));
    for (const body of bodies) {
      expect(body.formType).toBe(FormType.attributes);
      expect('firstRowOrdinal' in body).toBe(false);
    }
  });
});
