import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { SetStateAction } from 'react';
import UploadFireSQL from './uploadfiresql';
import { FileWithStream, ReviewStates, type UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

const startValidation = vi.fn();
const lifecycle: string[] = [];
const holdForRecovery = vi.fn();

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 7, plotName: 'Test Plot', dimensionX: 100, dimensionY: 100 }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 3 }] })
}));
vi.mock('@/app/hooks/usebackgroundvalidation', () => ({
  useBackgroundValidation: () => ({ startValidation })
}));
vi.mock('@/app/hooks/useuploadsession', async importOriginal => {
  const actual = await importOriginal<typeof import('@/app/hooks/useuploadsession')>();
  return {
    ...actual,
    useUploadSession: (options: Parameters<typeof actual.useUploadSession>[0]) => {
      const value = actual.useUploadSession(options);
      return {
        ...value,
        holdForRecovery: () => {
          lifecycle.push('holdForRecovery');
          holdForRecovery();
          value.holdForRecovery();
        }
      };
    }
  };
});
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Test User' } }, status: 'authenticated' })
}));
vi.mock('@/app/contexts/animationcacheprovider', () => ({
  useAnimationCacheContext: () => ({ getAnimationUrl: (path: string) => path })
}));
vi.mock('@lottiefiles/dotlottie-react', () => ({ DotLottieReact: () => null }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('UploadFireSQL recovery hold', () => {
  const fetchMock = vi.fn();
  const setReviewState = vi.fn((nextState: SetStateAction<ReviewStates>) => {
    const state = typeof nextState === 'function' ? nextState(ReviewStates.UPLOAD_SQL) : nextState;
    if (state === ReviewStates.ERRORS) lifecycle.push('ERRORS');
  });
  const setUploadError = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    holdForRecovery.mockReset();
    lifecycle.length = 0;
    setReviewState.mockReset();
    setUploadError.mockReset();
    startValidation.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/uploadsession' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ session: { sessionId: 'recovery-session', state: 'uploading' } }));
      }
      if (url.includes('/api/sqlpacketload')) {
        return Promise.resolve(jsonResponse({ transactionCompleted: true, batchID: 'staged-batch', fileID: 'measurements.csv', failingRows: [] }));
      }
      if (url.includes('/api/verifyupload')) {
        return Promise.resolve(jsonResponse({ count: 1 }));
      }
      if (url.includes('/api/setupbulkprocedure/')) {
        return Promise.resolve(jsonResponse({ code: 'SETUP_COMMIT_OUTCOME_UNKNOWN', recoveryRequired: true, retryable: false }, 409));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('holds the real session before reporting uncertain setup and prevents automatic cleanup', async () => {
    const raw = new File(['tag,spcode,quadrat,lx,ly,date\n1,ABAL,Q0001,1.5,2.5,2020-01-01'], 'measurements.csv', { type: 'text/csv' });
    const props: UploadFireProps = {
      schema: 'forestgeo_testing',
      uploadForm: FormType.measurements,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      personnelRecording: '',
      acceptedFiles: [new FileWithStream(raw, false)],
      parsedData: {},
      uploadCompleteMessage: '',
      selectedDelimiters: { 'measurements.csv': ',' },
      quadratOverlapAcknowledgment: null,
      onQuadratOverlapAcknowledgmentRequired: vi.fn(),
      setUploadCompleteMessage: vi.fn(),
      setIsDataUnsaved: vi.fn(),
      setUploadError,
      setErrorComponent: vi.fn(),
      setReviewState,
      setAllRowToCMID: vi.fn()
    };
    const view = render(<UploadFireSQL {...props} />);

    await waitFor(() => expect(setReviewState).toHaveBeenCalledWith(ReviewStates.ERRORS), { timeout: 10_000 });
    expect(
      lifecycle.indexOf('holdForRecovery'),
      JSON.stringify({ lifecycle, calls: fetchMock.mock.calls.map(call => String(call[0])) })
    ).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf('holdForRecovery')).toBeLessThan(lifecycle.indexOf('ERRORS'));
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/setupbulkprocedure/'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/sqlpacketload'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/setupbulkfailure/'))).toBe(false);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/setupbulkcollapser/'))).toBe(false);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/verifysession'))).toBe(false);

    view.unmount();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/uploadsession?') && (call[1] as RequestInit)?.method === 'DELETE')).toBe(false);
    expect(holdForRecovery).toHaveBeenCalled();
  });
});
