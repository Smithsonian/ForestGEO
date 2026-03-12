import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MeasurementsSummaryViewDataGrid from './msvdatagrid';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { useRouter } from 'next/navigation';

vi.mock('@/config/sqlrdsdefinitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

vi.mock('@/config/sqlrdsdefinitions/views', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

vi.mock('next/navigation', () => ({
  useRouter: vi.fn()
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

vi.mock('@/components/client/modals/failedmeasurementsmodal', () => ({
  default: ({ open, handleCloseModal }: { open: boolean; handleCloseModal: () => Promise<void> }) =>
    open ? (
      <div data-testid="failed-measurements-modal">
        <button type="button" onClick={() => void handleCloseModal()}>
          Close Failed Measurements
        </button>
      </div>
    ) : null
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('MeasurementsSummaryViewDataGrid', () => {
  const mockReplace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace
    } as any);
  });

  it('keeps failed-measurements review separate from the summary toolbar props by default', () => {
    render(<MeasurementsSummaryViewDataGrid />);

    const mockedMeasurementsCommons = vi.mocked(MeasurementsCommons);
    const renderedProps = mockedMeasurementsCommons.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

    expect(screen.getByTestId('measurements-commons')).toBeInTheDocument();
    expect(screen.queryByTestId('failed-measurements-modal')).not.toBeInTheDocument();
    expect(renderedProps).toBeDefined();
    expect(renderedProps).not.toHaveProperty('failedTrigger');
  });

  it('auto-opens the failed-measurements review for the errors entry and returns to summary on close', async () => {
    const user = userEvent.setup();

    render(<MeasurementsSummaryViewDataGrid autoOpenFailedMeasurements failedMeasurementsCloseRedirectHref="/measurementshub/summary" />);

    expect(screen.getByTestId('failed-measurements-modal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close Failed Measurements' }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/measurementshub/summary');
    });
  });
});
