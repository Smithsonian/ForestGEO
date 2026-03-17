import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MeasurementsSummaryViewDataGrid from './msvdatagrid';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';

vi.mock('@/config/sqlrdsdefinitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

vi.mock('@/config/sqlrdsdefinitions/views', async importOriginal => {
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

vi.mock('@/components/client/modals/failedmeasurementsmodal', () => ({
  default: () => null
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('MeasurementsSummaryViewDataGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
