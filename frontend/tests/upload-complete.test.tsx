import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import UploadComplete from '@/components/uploadsystem/segments/uploadcomplete';

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

vi.mock('@/config/sqlrdsdefinitions/timekeeping', () => ({
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
});
