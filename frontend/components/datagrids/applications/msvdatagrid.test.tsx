import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MeasurementsSummaryViewDataGrid from './msvdatagrid';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';

vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

vi.mock('@/lib/db/definitions/views', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn()
  })
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1, plotName: 'Test Plot' }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }], plotCensusNumber: 1 }),
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
}));

vi.mock('@/app/contexts/loadingprovider', () => ({
  useLoading: () => ({
    setLoading: vi.fn()
  })
}));

vi.mock('@/components/uploadsystemhelpers/uploadparentmodal', () => ({
  default: () => <div data-testid="upload-parent-modal" />
}));

vi.mock('@/components/datagrids/applications/multiline/multilinemodal', () => ({
  default: () => <div data-testid="multiline-modal" />
}));

vi.mock('@/components/datagrids/measurementscommons', () => ({
  default: vi.fn(() => <div data-testid="measurements-commons" />)
}));

const failedMeasurementsModalMock = vi.fn(() => null);
vi.mock('@/components/client/modals/failedmeasurementsmodal', () => ({
  default: (props: any) => failedMeasurementsModalMock(props)
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

function mockFailedRowCount(recordCount: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/clear/failedmeasurements/')) {
        return { ok: true, json: async () => ({ recordCount }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    })
  );
}

function latestCommonsProps(): Record<string, any> | undefined {
  const mockedMeasurementsCommons = vi.mocked(MeasurementsCommons);
  return mockedMeasurementsCommons.mock.calls.at(-1)?.[0] as Record<string, any> | undefined;
}

function latestModalProps(): Record<string, any> | undefined {
  return failedMeasurementsModalMock.mock.calls.at(-1)?.[0] as Record<string, any> | undefined;
}

describe('MeasurementsSummaryViewDataGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    // Default: no failed rows, so pre-existing tests see no recovery button.
    mockFailedRowCount(0);
  });

  it('renders the summary grid without a pre-applied visible filter by default', () => {
    render(<MeasurementsSummaryViewDataGrid />);

    const mockedMeasurementsCommons = vi.mocked(MeasurementsCommons);
    const renderedProps = mockedMeasurementsCommons.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

    expect(screen.getByTestId('measurements-commons')).toBeInTheDocument();
    expect(renderedProps).toBeDefined();
    expect(renderedProps?.initialVisibleFilters).toBeUndefined();
  });

  it('passes through an initial errors-only visible filter when requested', () => {
    render(<MeasurementsSummaryViewDataGrid initialVisibleFilters={['errors']} />);

    const mockedMeasurementsCommons = vi.mocked(MeasurementsCommons);
    const renderedProps = mockedMeasurementsCommons.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

    expect(renderedProps?.initialVisibleFilters).toEqual(['errors']);
  });

  it('offers a Fix Failed Rows button when failed measurements exist, and clicking it opens the modal', async () => {
    mockFailedRowCount(3);
    render(<MeasurementsSummaryViewDataGrid />);

    await waitFor(() => {
      const buttons = latestCommonsProps()?.dynamicButtons as Array<Record<string, any>>;
      expect(buttons.some(button => button.label === 'Fix Failed Rows')).toBe(true);
    });

    const fixButton = (latestCommonsProps()?.dynamicButtons as Array<Record<string, any>>).find(button => button.label === 'Fix Failed Rows');
    expect(fixButton?.badgeCount).toBe(3);
    expect(latestModalProps()?.open).toBe(false);

    act(() => {
      fixButton?.onClick();
    });

    expect(latestModalProps()?.open).toBe(true);
  });

  it('hides the Fix Failed Rows button when there are no failed measurements', async () => {
    render(<MeasurementsSummaryViewDataGrid />);

    // Allow the count fetch to settle before asserting absence.
    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    });
    const buttons = latestCommonsProps()?.dynamicButtons as Array<Record<string, any>>;
    expect(buttons.some(button => button.label === 'Fix Failed Rows')).toBe(false);
  });

  it('opens the failed-measurements modal on mount when autoOpenFailedMeasurements is set', async () => {
    render(<MeasurementsSummaryViewDataGrid autoOpenFailedMeasurements />);

    await waitFor(() => {
      expect(latestModalProps()?.open).toBe(true);
    });
  });
});
