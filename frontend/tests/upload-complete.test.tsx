import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import UploadComplete from '@/components/uploadsystem/segments/uploadcomplete';
import type { UploadOutcome } from '@/config/macros/uploadsystemmacros';

let currentCensusValue: any;

const mockTriggerRefresh = vi.fn();
const mockCensusListDispatch = vi.fn();
const mockCensusDispatch = vi.fn(async ({ census }: { census: any }) => {
  currentCensusValue = census;
});
const mockPlotListDispatch = vi.fn();
const mockQuadratListDispatch = vi.fn();
const mockSetCensusListStore = vi.fn();
const mockSetCensusStore = vi.fn();
const mockCreateAndUpdateCensusList = vi.fn();
const mockReconcileCurrentCensusSelection = vi.fn();

vi.mock('@/config/macros/formdetails', () => ({
  FormType: {
    measurements: 'measurements'
  }
}));

vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({
    triggerRefresh: mockTriggerRefresh
  })
}));

vi.mock('@/app/contexts/listselectionprovider', () => ({
  useOrgCensusListDispatch: () => mockCensusListDispatch,
  usePlotListDispatch: () => mockPlotListDispatch,
  useQuadratListDispatch: () => mockQuadratListDispatch
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 11 }),
  useSiteContext: () => ({ schemaName: 'forestgeo_testing' }),
  useOrgCensusContext: () => currentCensusValue,
  useOrgCensusDispatch: () => mockCensusDispatch
}));

vi.mock('@/lib/db/definitions/timekeeping', () => ({
  createAndUpdateCensusList: (...args: any[]) => mockCreateAndUpdateCensusList(...args),
  reconcileCurrentCensusSelection: (...args: any[]) => mockReconcileCurrentCensusSelection(...args)
}));

vi.mock('@/config/store/appstore', () => ({
  useAppStore: (selector: any) =>
    selector({
      setCensusList: mockSetCensusListStore,
      setCensus: mockSetCensusStore
    })
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}));

describe('UploadComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    currentCensusValue = {
      plotCensusNumber: 2,
      dateRanges: [{ censusID: 2001, plotID: 11, startDate: '2024-01-01', endDate: '2024-12-31' }]
    };

    const refreshedCensus = {
      plotCensusNumber: 2,
      dateRanges: [{ censusID: 2001, plotID: 11, startDate: '2024-01-01', endDate: '2024-12-31' }]
    };
    const refreshedCensusList = [refreshedCensus];

    mockCreateAndUpdateCensusList.mockResolvedValue(refreshedCensusList);
    mockReconcileCurrentCensusSelection.mockReturnValue(refreshedCensus);

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/query') {
        return Promise.resolve({
          ok: true,
          json: async () => ({})
        });
      }

      if (url.includes('/api/fetchall/census/')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ censusID: 2001 }]
        });
      }

      if (url.includes('/api/fetchall/plots')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ plotID: 11, plotName: 'serc' }]
        });
      }

      if (url.includes('/api/fetchall/quadrats/')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ quadratID: 1, quadratName: '1314' }]
        });
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as any;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completes the refresh flow once even after census selection is updated', async () => {
    render(<UploadComplete handleCloseUploadModal={vi.fn()} uploadForm={'measurements' as any} />);

    await waitFor(() => {
      expect(screen.getByText('Your data has been processed and uploaded successfully.')).toBeInTheDocument();
    });

    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);
    expect(mockCensusDispatch).toHaveBeenCalledTimes(1);
    expect(mockSetCensusStore).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(4);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('does not block application refresh if temporary measurements cleanup hangs', async () => {
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/query') {
        return new Promise(() => {});
      }

      if (url.includes('/api/fetchall/census/')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ censusID: 2001 }]
        });
      }

      if (url.includes('/api/fetchall/plots')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ plotID: 11, plotName: 'serc' }]
        });
      }

      if (url.includes('/api/fetchall/quadrats/')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ quadratID: 1, quadratName: '1314' }]
        });
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as any;

    render(<UploadComplete handleCloseUploadModal={vi.fn()} uploadForm={'measurements' as any} />);

    await waitFor(() => {
      expect(screen.getByText('Your data has been processed and uploaded successfully.')).toBeInTheDocument();
    });

    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  describe('reported outcome (#525 item 4)', () => {
    const GENERIC_SUCCESS_TEXT = 'Your data has been processed and uploaded successfully.';
    const FAILED_MEASUREMENTS_SENTENCE = /failed measurements/i;

    async function renderCompleted(uploadOutcome: UploadOutcome | undefined) {
      const handleCloseUploadModal = vi.fn();
      render(<UploadComplete handleCloseUploadModal={handleCloseUploadModal} uploadForm={'measurements' as any} uploadOutcome={uploadOutcome} />);
      await screen.findByRole('button', { name: 'Close' });
      return { handleCloseUploadModal };
    }

    it('says every row was inserted, and nothing about failures, when no row failed', async () => {
      await renderCompleted({ kind: 'ingestion', sourceRows: 12, insertedRows: 12, failedRows: 0 });

      expect(screen.getByText('All 12 rows were inserted.')).toBeInTheDocument();
      expect(screen.queryByText(FAILED_MEASUREMENTS_SENTENCE)).not.toBeInTheDocument();
    });

    it('reports inserted of source and how many rows went to Failed Measurements', async () => {
      await renderCompleted({ kind: 'ingestion', sourceRows: 12, insertedRows: 9, failedRows: 3 });

      expect(screen.getByText('9 of 12 rows inserted.')).toBeInTheDocument();
      expect(screen.getByText('3 rows were sent to Failed Measurements for review.')).toBeInTheDocument();
    });

    it('renders every revision apply category', async () => {
      await renderCompleted({
        kind: 'revisions',
        updatedCount: 2,
        deletedDuplicateCount: 1,
        insertedCount: 3,
        failedRowCount: 4,
        skippedCount: 5,
        applyErrorCount: 6,
        hasDuplicateCleanupOnlyRows: true
      });

      for (const line of [
        '2 measurement(s) updated',
        '1 duplicate(s) deleted',
        '3 new measurement(s) inserted',
        '4 rejected row(s) recorded as failed measurements',
        '5 matched row(s) required no field updates',
        'Duplicate cleanup can still use a matched survivor row even when its field values were unchanged.',
        '6 row(s) had errors and were skipped'
      ]) {
        expect(screen.getByText(line), `missing revisions line "${line}"`).toBeInTheDocument();
      }
    });

    it('keeps the generic success text, with no failed-measurements sentence, when no outcome was recorded', async () => {
      await renderCompleted(undefined);

      expect(screen.getByText(GENERIC_SUCCESS_TEXT)).toBeInTheDocument();
      expect(screen.queryByText(FAILED_MEASUREMENTS_SENTENCE)).not.toBeInTheDocument();
    });

    it('closes the upload modal directly from Close, with no "Ready to Continue?" dialog', async () => {
      const { handleCloseUploadModal } = await renderCompleted({ kind: 'ingestion', sourceRows: 1, insertedRows: 1, failedRows: 0 });

      await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));

      expect(handleCloseUploadModal).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Ready to Continue?')).not.toBeInTheDocument();
    });
  });
});
