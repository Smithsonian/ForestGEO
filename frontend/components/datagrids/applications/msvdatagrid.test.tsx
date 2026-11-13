import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MeasurementsSummaryViewDataGrid from './msvdatagrid';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';

const { routerReplaceMock, sessionState, uploadModalProps, multilineModalProps } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  sessionState: { userStatus: 'global' },
  uploadModalProps: [] as Array<Record<string, any>>,
  multilineModalProps: [] as Array<Record<string, any>>
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { userStatus: sessionState.userStatus } } })
}));

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
    replace: routerReplaceMock
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
  default: (props: Record<string, any>) => {
    uploadModalProps.push(props);
    return <div data-testid="upload-parent-modal" />;
  }
}));

vi.mock('@/components/datagrids/applications/multiline/multilinemodal', () => ({
  default: (props: Record<string, any>) => {
    multilineModalProps.push(props);
    return <div data-testid="multiline-modal" />;
  }
}));

vi.mock('@/components/client/rendergridformexplanations', () => ({
  default: () => <div data-testid="form-explanations" />
}));

vi.mock('@/components/datagrids/measurementscommons', () => ({
  default: vi.fn(() => <div data-testid="measurements-commons" />)
}));

const failedMeasurementsModalMock = vi.fn((_props: Record<string, any>) => null);
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
      if (url.includes('/api/failedmeasurements/count/')) {
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

const FAKE_CONTROLS = {
  stateCounts: {
    unresolvedLogged: 2,
    failedNoLog: 0,
    pending: 1,
    valid: 5,
    overridable: 1,
    revalidatable: 0,
    firstMeasurementDate: '2024-06-03',
    lastMeasurementDate: '2024-06-09'
  },
  showOption: 'all' as const,
  onShowOptionChange: vi.fn(),
  searchText: '',
  appliedSearchText: '',
  onSearchTextChange: vi.fn(),
  onSearchApply: vi.fn(),
  onSearchClear: vi.fn(),
  onRunValidations: vi.fn(),
  onOverrideValidations: vi.fn(),
  onResetValidations: vi.fn(),
  onOpenExport: vi.fn()
};

function renderLatestHeader() {
  const renderAboveGrid = latestCommonsProps()?.renderAboveGrid as (controls: typeof FAKE_CONTROLS) => React.ReactNode;
  return render(<>{renderAboveGrid(FAKE_CONTROLS)}</>);
}

function latestModalProps(): Record<string, any> | undefined {
  return failedMeasurementsModalMock.mock.calls.at(-1)?.[0] as Record<string, any> | undefined;
}

describe('MeasurementsSummaryViewDataGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    uploadModalProps.length = 0;
    multilineModalProps.length = 0;
    sessionState.userStatus = 'global';
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

  it('offers a "Fix 3 failed uploads" header button when failed measurements exist, and clicking it opens the modal', async () => {
    const user = userEvent.setup();
    mockFailedRowCount(3);
    render(<MeasurementsSummaryViewDataGrid />);

    await waitFor(() => {
      renderLatestHeader();
      expect(screen.queryByRole('button', { name: 'Fix 3 failed uploads' })).toBeInTheDocument();
    });
    expect(latestModalProps()?.open).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Fix 3 failed uploads' }));

    expect(latestModalProps()?.open).toBe(true);
  });

  it('hides the failed-uploads button when there are no failed measurements', async () => {
    render(<MeasurementsSummaryViewDataGrid />);

    // Allow the count fetch to settle before asserting absence.
    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    });
    renderLatestHeader();
    expect(screen.queryByRole('button', { name: /^Fix / })).not.toBeInTheDocument();
  });

  it('does not offer failed-row recovery to pending users', async () => {
    sessionState.userStatus = 'pending';
    mockFailedRowCount(3);
    render(<MeasurementsSummaryViewDataGrid />);

    renderLatestHeader();
    expect(screen.queryByRole('button', { name: /^Fix / })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('opens the failed-measurements modal on mount when autoOpenFailedMeasurements is set', async () => {
    render(<MeasurementsSummaryViewDataGrid autoOpenFailedMeasurements />);

    await waitFor(() => {
      expect(latestModalProps()?.open).toBe(true);
    });
  });

  it('closes and strips a deep-link query without waiting on another count request', async () => {
    render(<MeasurementsSummaryViewDataGrid autoOpenFailedMeasurements failedMeasurementsCloseRedirectHref="/measurementshub/summary" />);
    await waitFor(() => expect(latestModalProps()?.open).toBe(true));
    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalled());
    const callsBeforeClose = vi.mocked(global.fetch).mock.calls.length;

    await act(async () => {
      await latestModalProps()?.handleCloseModal();
    });

    expect(latestModalProps()?.open).toBe(false);
    expect(routerReplaceMock).toHaveBeenCalledWith('/measurementshub/summary');
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(callsBeforeClose);
  });

  it('surfaces an invalid count response instead of rendering a misleading badge', async () => {
    mockFailedRowCount(-2);
    render(<MeasurementsSummaryViewDataGrid />);

    await waitFor(() => expect(screen.getByText(/unable to load the failed-measurement count/i)).toBeInTheDocument());
    renderLatestHeader();
    expect(screen.queryByRole('button', { name: /^Fix / })).not.toBeInTheDocument();
  });

  it('passes the header slot and the empty-census action, and no dynamicButtons', () => {
    render(<MeasurementsSummaryViewDataGrid />);
    const props = latestCommonsProps();
    console.log(JSON.stringify({ propKeys: Object.keys(props ?? {}) }));
    expect(typeof props?.renderAboveGrid).toBe('function');
    expect(props?.emptyCensusAction).toBeTruthy();
    expect(props).not.toHaveProperty('dynamicButtons');
  });

  it('passes no empty-census action when the toolbar actions are hidden', () => {
    render(<MeasurementsSummaryViewDataGrid showToolbarActions={false} />);
    expect(latestCommonsProps()?.emptyCensusAction).toBeNull();
  });

  it('keeps the empty-census action element identical across re-renders so the grid overlay does not remount', async () => {
    const { rerender } = render(<MeasurementsSummaryViewDataGrid />);
    const actionBeforeRerender = latestCommonsProps()?.emptyCensusAction;
    const callsBeforeRerender = vi.mocked(MeasurementsCommons).mock.calls.length;

    rerender(<MeasurementsSummaryViewDataGrid />);
    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalled());

    console.log(JSON.stringify({ callsBeforeRerender, callsAfterRerender: vi.mocked(MeasurementsCommons).mock.calls.length }));
    expect(vi.mocked(MeasurementsCommons).mock.calls.length).toBeGreaterThan(callsBeforeRerender);
    expect(latestCommonsProps()?.emptyCensusAction).toBe(actionBeforeRerender);
  });

  it('renders the scope line and wires Export CSV and the validation items to the controls', async () => {
    const user = userEvent.setup();
    render(<MeasurementsSummaryViewDataGrid />);
    renderLatestHeader();
    expect(screen.getByTestId('view-data-scope-line')).toHaveTextContent('Test Site · Test Plot · Census 1');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(FAKE_CONTROLS.onOpenExport).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: /Run validations/ }));
    expect(FAKE_CONTROLS.onRunValidations).toHaveBeenCalledTimes(1);
  });

  it('runs reloadMSV for "Refresh the view" and opens the Header reference dialog', async () => {
    const user = userEvent.setup();
    render(<MeasurementsSummaryViewDataGrid />);
    renderLatestHeader();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: /Refresh the view/ }));
    await waitFor(() => {
      const refreshCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url) === '/api/refreshviews/measurementssummary/testschema');
      console.log(JSON.stringify({ refreshCalls: refreshCalls.map(([url, init]) => ({ url: String(url), method: init?.method })) }));
      expect(refreshCalls.some(([, init]) => init?.method === 'POST')).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: /Header reference/ }));
    expect(await screen.findByRole('dialog', { name: 'Header reference' })).toBeInTheDocument();
  });

  it('opens the manual-entry and ArcGIS modals from the Add measurements menu', async () => {
    const user = userEvent.setup();
    render(<MeasurementsSummaryViewDataGrid />);
    renderLatestHeader();

    await user.click(screen.getByRole('button', { name: 'Add measurements' }));
    await user.click(screen.getByRole('menuitem', { name: /Manual entry form/ }));
    await waitFor(() => expect(multilineModalProps.some(props => props.isManualEntryFormOpen === true)).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Add measurements' }));
    await user.click(screen.getByRole('menuitem', { name: /Import an ArcGIS workbook/ }));
    await waitFor(() => expect(uploadModalProps.some(props => props.isUploadModalOpen === true && Boolean(props.sourceFormat))).toBe(true));
  });

  it('opens the upload modal from Add measurements and shows no "Changes detected" snackbar after an upload', async () => {
    const user = userEvent.setup();
    render(<MeasurementsSummaryViewDataGrid />);
    renderLatestHeader();
    await user.click(screen.getByRole('button', { name: 'Add measurements' }));
    await user.click(screen.getByRole('menuitem', { name: /Upload a CSV/ }));
    await waitFor(() => expect(uploadModalProps.some(props => props.isUploadModalOpen === true)).toBe(true));
    const csvUploadProps = [...uploadModalProps].reverse().find(props => props.isUploadModalOpen === true && !props.sourceFormat);
    act(() => csvUploadProps?.onUploadComplete());
    await act(async () => {
      [...uploadModalProps]
        .reverse()
        .find(props => !props.sourceFormat)
        ?.handleCloseUploadModal();
    });
    await waitFor(() =>
      expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).startsWith('/api/refreshviews/measurementssummary/'))).toBe(true)
    );
    expect(screen.queryByText('Changes detected!')).not.toBeInTheDocument();
    expect(screen.queryByText('CORE CHANGES DETECTED!')).not.toBeInTheDocument();
  });

  it('appends the read-only line for a pending user', () => {
    sessionState.userStatus = 'pending';
    render(<MeasurementsSummaryViewDataGrid />);
    renderLatestHeader();
    expect(screen.getByTestId('view-data-facts-line')).toHaveTextContent("Read-only: your role can't edit these rows");
  });
});
