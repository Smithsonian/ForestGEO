// Mock ResizeObserver
class ResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

global.ResizeObserver = ResizeObserver;

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '@/components/sidebar';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useOrgCensusListContext, usePlotListContext, useSiteListContext } from '@/app/contexts/listselectionprovider';
import '@testing-library/jest-dom/vitest';
import { UserAuthRoles } from '@/config/macros';
import { Session } from 'next-auth/core/types';
import { CensusDateRange } from '@/config/sqlrdsdefinitions/timekeeping';

// Mock the necessary hooks
vi.mock('next-auth/react', () => ({
  useSession: vi.fn()
}));

vi.mock('@/app/contexts/userselectionprovider', () => ({
  useSiteContext: vi.fn(),
  usePlotContext: vi.fn(),
  useOrgCensusContext: vi.fn(),
  useSiteDispatch: vi.fn(),
  usePlotDispatch: vi.fn(),
  useOrgCensusDispatch: vi.fn()
}));

vi.mock('@/app/contexts/listselectionprovider', () => ({
  useSiteListContext: vi.fn(),
  usePlotListContext: vi.fn(),
  useOrgCensusListContext: vi.fn(),
  useSiteListDispatch: vi.fn(),
  usePlotListDispatch: vi.fn(),
  useOrgCensusListDispatch: vi.fn()
}));

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useRouter: vi.fn().mockReturnValue({
      route: '/',
      pathname: '/',
      query: {},
      asPath: '/',
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn()
    }),
    usePathname: vi.fn().mockReturnValue('/mock-path'),
    useSearchParams: vi.fn().mockReturnValue({
      get: vi.fn()
    })
  };
});

describe.skip('Sidebar Component', () => {
  // Mock session data
  const mockSession = {
    user: {
      name: 'John Doe',
      email: 'john.doe@example.com',
      userStatus: 'global' as UserAuthRoles,
      sites: [
        { siteID: 1, siteName: 'Site 1', schemaName: 'schema1' },
        { siteID: 2, siteName: 'Site 2', schemaName: 'schema2' }
      ],
      allsites: [
        { siteID: 1, siteName: 'Site 1', schemaName: 'schema1' },
        { siteID: 2, siteName: 'Site 2', schemaName: 'schema2' }
      ]
    },
    expires: '9999-12-31T23:59:59.999Z' // Add this line to satisfy the 'Session' type
  };

  // Mock site, plot, and census contexts
  const mockSite = { siteID: 1, siteName: 'Site 1', schemaName: 'schema1' };
  const mockPlot = { plotID: 1, plotName: 'Plot 1', numQuadrats: 5 };
  const mockCensus = {
    plotCensusNumber: 1,
    dateRanges: [{ censusID: 1, startDate: new Date('2023-01-01'), endDate: new Date('2023-01-31') } as CensusDateRange],
    plotID: 1,
    censusIDs: [1, 2],
    description: 'Test Census'
  };
  const mockCensusList = [
    {
      plotCensusNumber: 1,
      dateRanges: [{ censusID: 1, startDate: new Date('2023-01-01'), endDate: new Date('2023-01-31') } as CensusDateRange],
      plotID: 1,
      censusIDs: [1, 2],
      description: 'Test Census'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock session
    vi.mocked(useSession).mockReturnValue({
      data: mockSession,
      status: 'authenticated',
      update: function (_data?: any): Promise<Session | null> {
        throw new Error('Function not implemented.');
      }
    });

    // Mock contexts
    vi.mocked(useSiteContext).mockReturnValue(mockSite);
    vi.mocked(usePlotContext).mockReturnValue(mockPlot);
    vi.mocked(useOrgCensusContext).mockReturnValue(mockCensus);

    // Mock list contexts
    vi.mocked(useSiteListContext).mockReturnValue([mockSite]);
    vi.mocked(usePlotListContext).mockReturnValue([mockPlot]);
    vi.mocked(useOrgCensusListContext).mockReturnValue(mockCensusList);
  });

  it('renders the sidebar', async () => {
    render(<Sidebar siteListLoaded={true} coreDataLoaded={true} setCensusListLoaded={vi.fn()} setManualReset={vi.fn()} />);

    // Check if the sidebar renders the user name and admin status
    expect(screen.getByTestId('login-logout-component')).toBeInTheDocument();

    // Check if the site, plot, and census dropdowns are rendered using data-testid
    expect(screen.getByTestId('site-select-component')).toBeInTheDocument();
    expect(screen.getByTestId('plot-select-component')).toBeInTheDocument();
    expect(screen.getByTestId('census-select-component')).toBeInTheDocument();
  });

  it('displays the selected site, plot, and census', async () => {
    render(<Sidebar siteListLoaded={true} coreDataLoaded={true} setCensusListLoaded={vi.fn()} setManualReset={vi.fn()} />);

    // Check that the selected site, plot, and census are displayed correctly
    expect(screen.getByTestId('selected-site-name')).toHaveTextContent('Site: Site 1');
    expect(screen.getByTestId('selected-plot-name')).toHaveTextContent('Plot: Plot 1');
    expect(screen.getByTestId('selected-census-plotcensusnumber')).toHaveTextContent('Census: 1');

    // Check dates
    expect(screen.getByTestId('selected-census-dates')).toHaveTextContent('First Record: Sun Jan 01 2023');
    expect(screen.getByTestId('selected-census-dates')).toHaveTextContent('Last Record: Tue Jan 31 2023');
  });

  // it('opens the "Add New Census" modal when clicked', async () => {
  //   render(<Sidebar siteListLoaded={true} coreDataLoaded={true} setCensusListLoaded={vi.fn()} setManualReset={vi.fn()} />);
  //
  //   // Find and click the "Add New Census" button
  //   const addCensusButton = screen.getByTestId('add-new-census-button');
  //   expect(addCensusButton).toBeInTheDocument();
  //
  //   await act(async () => {
  //     fireEvent.click(addCensusButton);
  //   });
  //
  //   // Verify that the modal opens successfully using its test ID
  //   expect(screen.getByTestId('rollover-modal')).toBeInTheDocument();
  // });
});
