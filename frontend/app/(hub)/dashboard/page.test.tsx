/**
 * @fileoverview Integration tests for Enhanced Dashboard Page
 *
 * Tests the complete dashboard with all visual enhancements integrated.
 * Validates data loading, component rendering, user interactions, and
 * responsive layout behavior.
 *
 * @see /app/(hub)/dashboard/page.tsx
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within as _within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './page';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, useOrgCensusListDispatch, usePlotContext, useSiteContext, useSiteListContext } from '@/app/contexts/compat-hooks';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import { useAppStore } from '@/config/store/appstore';
import { CENSUS_DELETE_GENERIC_FAILURE_MESSAGE } from '@/config/censusdeletion';
import { HTTPResponses } from '@/config/macros';
import { CENSUS_DATES_REFRESH_FAILURE_MESSAGE, CENSUS_DATES_SAVE_FAILURE_MESSAGE } from '@/config/censuswindow';
import { buildCensusDatesPatchBody } from '@/lib/db/definitions/timekeeping';

// Mock dependencies
vi.mock('next-auth/react');
vi.mock('@/app/contexts/compat-hooks');
vi.mock('@/app/contexts/lockanimationcontext');
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  })
}));
vi.mock('@/components/metrics/progresstachometer', () => ({
  default: ({ PopulatedPercent }: any) => <div data-testid="tachometer">{PopulatedPercent}%</div>
}));
vi.mock('@/components/metrics/progresspiechart', () => ({
  default: ({ PopulatedPercent }: any) => <div data-testid="piechart">{PopulatedPercent}%</div>
}));
vi.mock('@/lib/db/definitions/views', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAllViewFullTableViewsHCs: () => ({
      coreMeasurementID: false,
      plotID: false,
      censusID: false,
      quadratID: false,
      speciesID: false,
      treeID: false,
      stemGUID: false,
      personnelID: false,
      familyID: false,
      genusID: false
    }),
    getMeasurementsSummaryViewHCs: () => ({
      coreMeasurementID: false,
      plotID: false,
      censusID: false,
      quadratID: false,
      speciesID: false,
      treeID: false,
      stemGUID: false,
      personnelID: false
    }),
    getAllTaxonomiesViewHCs: () => ({
      speciesID: false,
      familyID: false,
      genusID: false
    })
  };
});
vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getFailedMeasurementsHCs: () => ({
      failedMeasurementID: false,
      plotID: false,
      censusID: false
    }),
    getCoreMeasurementsHCs: () => ({
      censusID: false,
      stemGUID: false,
      description: false
    })
  };
});
vi.mock('@/lib/db/definitions/personnel', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getPersonnelHCs: () => ({
      censusID: false,
      personnelID: false
    })
  };
});
// The shared platform mocks stub this module empty; the census edit and refresh paths need the real one.
vi.mock('@/lib/db/definitions/timekeeping', async importOriginal => importOriginal());
vi.mock('@/config/datamapper', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getQuadratHCs: () => ({
      quadratID: false,
      plotID: false,
      censusID: false
    })
  };
});
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSpeciesLimitsHCs: () => ({
      speciesLimitsID: false,
      speciesID: false
    })
  };
});

// Mock fetch globally
global.fetch = vi.fn();

describe('Enhanced Dashboard Page', () => {
  const mockSession = {
    user: {
      name: 'John Doe',
      email: 'john@example.com',
      userStatus: 'Administrator',
      sites: [
        { schemaName: 'site1', siteName: 'Test Site 1' },
        { schemaName: 'site2', siteName: 'Test Site 2' }
      ]
    }
  };

  const mockSite = {
    schemaName: 'testsite',
    siteName: 'Test Site'
  };

  const mockPlot = {
    plotID: 1,
    plotName: 'Test Plot'
  };

  const mockCensus = {
    dateRanges: [
      {
        censusID: 1,
        startDate: '2023-01-01',
        endDate: '2023-12-31'
      }
    ],
    plotCensusNumber: 1
  };

  const mockDashboardData = {
    progressTachometer: {
      TotalQuadrats: 100,
      PopulatedQuadrats: 75,
      PopulatedPercent: 75,
      UnpopulatedQuadrats: 'Q001;Q002;Q003'
    },
    activeUsers: {
      CountActiveUsers: 5
    },
    countTrees: {
      CountTrees: 1234
    },
    countStems: {
      CountStems: 2468
    },
    stemTypes: {
      CountOldStems: 1000,
      CountMultiStems: 500,
      CountNewRecruits: 968
    }
  };

  const mockChangelogData = [
    {
      changeID: 1,
      operation: 'INSERT',
      tableName: 'stems',
      changeTimestamp: new Date('2023-12-01').toISOString(),
      oldRowState: {},
      newRowState: { stemID: 1, treeID: 1 }
    },
    {
      changeID: 2,
      operation: 'UPDATE',
      tableName: 'measurements',
      changeTimestamp: new Date('2023-12-02').toISOString(),
      oldRowState: { dbh: 10 },
      newRowState: { dbh: 11 }
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup session mock
    vi.mocked(useSession).mockReturnValue({
      data: mockSession,
      status: 'authenticated',
      update: vi.fn()
    } as any);

    // Setup context mocks
    vi.mocked(useSiteContext).mockReturnValue(mockSite as any);
    vi.mocked(usePlotContext).mockReturnValue(mockPlot as any);
    vi.mocked(useOrgCensusContext).mockReturnValue(mockCensus as any);
    vi.mocked(useLockAnimation).mockReturnValue({
      triggerPulse: vi.fn(),
      isPulsing: false
    } as any);
    // Default: empty catalog site list; individual tests override for the site-selection state.
    vi.mocked(useSiteListContext).mockReturnValue([]);

    // Setup fetch mocks
    vi.mocked(global.fetch).mockImplementation((url: any) => {
      if (url.includes('/api/dashboardmetrics/all/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDashboardData)
        } as Response);
      }
      if (url.includes('/api/changelog/overview/unifiedchangelog/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockChangelogData)
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should render welcome header with user name', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/Welcome back, John Doe!/)).toBeInTheDocument();
      });
    });

    it('should render dashboard subtitle', async () => {
      render(<DashboardPage />);

      expect(screen.getByText("Here's what's happening with your census data")).toBeInTheDocument();
    });

    it('should load and display all dashboard metrics', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('1,234')).toBeInTheDocument(); // Trees
        expect(screen.getByText('2,468')).toBeInTheDocument(); // Stems
        expect(screen.getAllByText('5').length).toBeGreaterThan(0); // Active users (may appear multiple times)
        expect(screen.getAllByText('968').length).toBeGreaterThan(0); // New recruits (appears in metric card and chips)
      });
    });
  });

  describe('MetricCard Display', () => {
    it('should render Total Trees metric card', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Total Trees')).toBeInTheDocument();
        expect(screen.getByText('1,234')).toBeInTheDocument();
      });
    });

    it('should render Total Stems metric card', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Total Stems')).toBeInTheDocument();
        expect(screen.getByText('2,468')).toBeInTheDocument();
      });
    });

    it('should calculate and display stems per tree', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const stemsPerTree = (2468 / 1234).toFixed(1);
        // The component displays "X.X stems per tree"
        expect(screen.getByText(`${stemsPerTree} stems per tree`)).toBeInTheDocument();
      });
    });

    it('should render Active Personnel metric card', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Active Personnel')).toBeInTheDocument();
        // The PersonnelCard shows "X people assigned to this census" as subtitle
        expect(screen.getByText('people assigned to this census')).toBeInTheDocument();
      });
    });

    it('should render New Recruits metric card', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('New Recruits')).toBeInTheDocument(); // Metric card title uses regular case
        expect(screen.getAllByText('968').length).toBeGreaterThan(0); // Value may appear in multiple places
      });
    });

    it('should show appropriate trend for active users', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // The PersonnelCard shows "X people assigned to this census"
        expect(screen.getByText('people assigned to this census')).toBeInTheDocument();
      });
    });
  });

  describe('ProgressCard Display', () => {
    it('should render progress card with correct percentage', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument();
        // Component uses "Quadrat Coverage" as the title
        expect(screen.getByText('Quadrat Coverage')).toBeInTheDocument();
      });
    });

    it('should display populated quadrats count', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Component shows "X with data" for populated quadrats
        expect(screen.getByText('75 with data')).toBeInTheDocument();
      });
    });

    it('should display pending quadrats count', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Component shows "X pending" in a Chip
        expect(screen.getByText('3 pending')).toBeInTheDocument();
      });
    });
  });

  describe('Census Statistics', () => {
    it('should render tree-stem classification section', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Tree-Stem Classification')).toBeInTheDocument();
      });
    });

    it('should display core counts section', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Core Counts')).toBeInTheDocument();
        expect(screen.getByText('Total trees and stems in this census')).toBeInTheDocument();
      });
    });

    it('should display stem type breakdown', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Old Trees')).toBeInTheDocument();
        expect(screen.getByText('New Recruits')).toBeInTheDocument();
        expect(screen.getByText('Multi-Stems')).toBeInTheDocument();
      });
    });

    it('should display quadrat coverage section', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Quadrat Coverage')).toBeInTheDocument();
        expect(screen.getByText('Measurement completion across all quadrats')).toBeInTheDocument();
      });
    });

    it('should display stem type values', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Old stems: 1000, Multi-stems: 500, New recruits: 968
        expect(screen.getByText('1,000')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();
        expect(screen.getAllByText('968').length).toBeGreaterThan(0);
      });
    });
  });

  describe('User Profile Section', () => {
    it('should display user profile card', async () => {
      render(<DashboardPage />);

      expect(screen.getByText('Your Profile')).toBeInTheDocument();
    });

    it('should display user role', async () => {
      render(<DashboardPage />);

      expect(screen.getByText('Assigned Role')).toBeInTheDocument();
      expect(screen.getByText('Administrator')).toBeInTheDocument();
    });

    it('should display user email', async () => {
      render(<DashboardPage />);

      expect(screen.getByText('Registered Email')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    it('should display accessible sites', async () => {
      render(<DashboardPage />);

      expect(screen.getByText('Site Access')).toBeInTheDocument();
      expect(screen.getByText('Test Site 1')).toBeInTheDocument();
      expect(screen.getByText('Test Site 2')).toBeInTheDocument();
    });

    it('should display report incorrect info button', async () => {
      render(<DashboardPage />);

      expect(screen.getByText('Report incorrect info')).toBeInTheDocument();
    });
  });

  describe('Recent Activity Section', () => {
    it('should display recent activity card', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Recent Activity')).toBeInTheDocument();
        expect(screen.getByText('Latest changes to census data')).toBeInTheDocument();
      });
    });

    it('should display changelog entries', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/Added a stem/)).toBeInTheDocument();
        expect(screen.getByText(/Updated a measurement record/)).toBeInTheDocument();
      });
    });

    it('should display changelog with accordions', async () => {
      render(<DashboardPage />);

      // Wait for changelog entries to load
      await waitFor(
        () => {
          expect(screen.getByText(/Added a stem/)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Verify the accordion structure exists
      expect(screen.getByText(/Updated a measurement record/)).toBeInTheDocument();
    });

    it('should display changelog operation details', async () => {
      render(<DashboardPage />);

      // Wait for changelog entries to load
      await waitFor(
        () => {
          // Check that changelog data is displayed
          expect(screen.getByText(/Added a stem/)).toBeInTheDocument();
          expect(screen.getByText(/Updated a measurement record/)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Data Loading', () => {
    it('should make API call for dashboard metrics', async () => {
      render(<DashboardPage />);

      // Wait for data to load and verify fetch was called
      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/dashboardmetrics/all/testsite/1/1'), expect.anything());
        },
        { timeout: 3000 }
      );
    });

    it('should make API call for changelog', async () => {
      render(<DashboardPage />);

      // Wait for data to load and verify fetch was called
      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/changelog/overview/unifiedchangelog/1/1?schema=testsite'), expect.anything());
        },
        { timeout: 3000 }
      );
    });

    it('should display loading skeletons initially', () => {
      render(<DashboardPage />);

      // The component should render - initial render before data loads shows the dashboard structure
      // We verify the page renders without error
      expect(screen.getByRole('region', { name: 'Dashboard page container' })).toBeInTheDocument();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(global.fetch).mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        } as Response)
      );

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load dashboard data/)).toBeInTheDocument();
      });
    });

    it('should show empty state when no data', async () => {
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        if (url.includes('/api/dashboardmetrics/all/')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                progressTachometer: { TotalQuadrats: 0, PopulatedQuadrats: 0, PopulatedPercent: 0, UnpopulatedQuadrats: '' },
                activeUsers: { CountActiveUsers: 0 },
                countTrees: { CountTrees: 0 },
                countStems: { CountStems: 0 },
                stemTypes: { CountOldStems: 0, CountMultiStems: 0, CountNewRecruits: 0 }
              })
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([])
        } as Response);
      });

      render(<DashboardPage />);

      await waitFor(() => {
        // EmptyState shows "No Census Data Yet" when there's no data
        expect(screen.getByText('No Census Data Yet')).toBeInTheDocument();
      });
    });
  });

  describe('Context Changes', () => {
    it('should reset data when site context is cleared', async () => {
      const { rerender } = render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('1,234')).toBeInTheDocument();
      });

      vi.mocked(useSiteContext).mockReturnValue(undefined as any);

      rerender(<DashboardPage />);

      await waitFor(() => {
        expect(screen.queryByText('1,234')).not.toBeInTheDocument();
      });
    });

    it('should reload data when census context changes', async () => {
      const { rerender } = render(<DashboardPage />);

      // Wait for initial data to load
      await waitFor(
        () => {
          expect(screen.getByText('1,234')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      const newCensus = {
        dateRanges: [{ censusID: 2, startDate: '2024-01-01', endDate: '2024-12-31' }],
        plotCensusNumber: 2
      };

      vi.mocked(useOrgCensusContext).mockReturnValue(newCensus as any);

      rerender(<DashboardPage />);

      // Verify fetch was called with new census ID
      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/dashboardmetrics/all/testsite/1/2'), expect.anything());
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Feedback Form', () => {
    it('should have clickable feedback button with correct accessibility', async () => {
      render(<DashboardPage />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('Report incorrect info')).toBeInTheDocument();
      });

      // Find the feedback button by its aria-label and verify it's properly accessible
      const feedbackButton = screen.getByRole('button', { name: /Report incorrect profile information/i });
      expect(feedbackButton).toBeInTheDocument();
      expect(feedbackButton).toHaveAttribute('tabIndex', '0');
      expect(feedbackButton).toHaveAttribute('aria-label', 'Report incorrect profile information');
    });
  });

  describe('Responsive Layout', () => {
    it('should render metrics in grid layout', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Check that metric cards are rendered
        expect(screen.getByText('Total Trees')).toBeInTheDocument();
        expect(screen.getByText('Total Stems')).toBeInTheDocument();
      });
    });

    it('should render proper spacing between sections', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        // Check that the main container exists with proper region role
        const mainBox = screen.getByRole('region', { name: 'Dashboard page container' });
        expect(mainBox).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper region label', async () => {
      render(<DashboardPage />);

      const region = screen.getByRole('region', { name: 'Dashboard page container' });
      expect(region).toBeInTheDocument();
    });

    it('should have proper heading hierarchy', async () => {
      render(<DashboardPage />);

      // Check that welcome heading exists
      await waitFor(() => {
        expect(screen.getByText(/Welcome back/)).toBeInTheDocument();
      });
    });
  });

  describe('Available Sites card (no site selected)', () => {
    // Copy that must NOT appear for users who actually have site access.
    const NO_ACCESS_COPY = /don't have access to any sites yet/i;

    // A representative catalog list the sidebar would receive via the site list context.
    const catalogSites = Array.from({ length: 9 }, (_, index) => ({
      siteID: index + 1,
      siteName: `Catalog Site ${index + 1}`,
      schemaName: `catalog_site_${index + 1}`
    }));

    beforeEach(() => {
      // Site-selection state renders only when no site is selected.
      vi.mocked(useSiteContext).mockReturnValue(undefined as any);
    });

    it('should render every catalog site for a global user with no explicit grants', async () => {
      vi.mocked(useSession).mockReturnValue({
        data: { user: { name: 'Global User', email: 'global@example.com', userStatus: 'global', sites: [] } },
        status: 'authenticated',
        update: vi.fn()
      } as any);
      vi.mocked(useSiteListContext).mockReturnValue(catalogSites as any);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(catalogSites[0].siteName)).toBeInTheDocument();
      });
      catalogSites.forEach(site => {
        expect(screen.getByText(site.siteName)).toBeInTheDocument();
      });
      expect(screen.queryByText(NO_ACCESS_COPY)).not.toBeInTheDocument();
    });

    it('should not keep a global user in a permanent loading state when the catalog is empty', async () => {
      vi.mocked(useSession).mockReturnValue({
        data: { user: { name: 'Global User', email: 'global@example.com', userStatus: 'global', sites: [] } },
        status: 'authenticated',
        update: vi.fn()
      } as any);
      vi.mocked(useSiteListContext).mockReturnValue([]);

      render(<DashboardPage />);

      expect(screen.queryByRole('section', { name: /loading sites/i })).not.toBeInTheDocument();
      expect(await screen.findByText('No Sites Available')).toBeInTheDocument();
    });

    it('should render only the explicit grants for a non-global user, ignoring the catalog list', async () => {
      const grantedSites = [
        { siteID: 3, siteName: 'Granted Site A', schemaName: 'granted_a' },
        { siteID: 7, siteName: 'Granted Site B', schemaName: 'granted_b' }
      ];
      vi.mocked(useSession).mockReturnValue({
        data: { user: { name: 'Crew User', email: 'crew@example.com', userStatus: 'field crew', sites: grantedSites } },
        status: 'authenticated',
        update: vi.fn()
      } as any);
      vi.mocked(useSiteListContext).mockReturnValue(catalogSites as any);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Granted Site A')).toBeInTheDocument();
      });
      expect(screen.getByText('Granted Site B')).toBeInTheDocument();
      // Catalog-only sites the user was not granted must not leak into the card.
      expect(screen.queryByText(catalogSites[0].siteName)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_ACCESS_COPY)).not.toBeInTheDocument();
    });

    it('should show the contact-administrator empty state for a non-global user with zero grants', async () => {
      vi.mocked(useSession).mockReturnValue({
        data: { user: { name: 'Pending User', email: 'pending@example.com', userStatus: 'pending', sites: [] } },
        status: 'authenticated',
        update: vi.fn()
      } as any);
      vi.mocked(useSiteListContext).mockReturnValue(catalogSites as any);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(NO_ACCESS_COPY)).toBeInTheDocument();
      });
      // Non-global users never inherit the catalog list.
      expect(screen.queryByText(catalogSites[0].siteName)).not.toBeInTheDocument();
    });
  });

  describe('Census delete rejections (#525 items 2+3)', () => {
    const CLEAR_CENSUS_URL = '/api/clearcensus';
    const CLEAR_CENSUS_CONFLICT_MESSAGE = 'Only the latest census can be cleared. Delete newer censuses first.';
    const SERVER_INTERNAL_DETAIL = 'ER_LOCK_DEADLOCK in clearcensusmsmts';
    const DELETABLE_CENSUS = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [1],
      dateRanges: [{ censusID: 1, startDate: new Date('2023-01-01'), endDate: new Date('2023-12-31') }],
      description: 'Only census',
      isActive: true
    };

    function routeClearCensusTo(clearCensusResponse: Response) {
      vi.mocked(global.fetch).mockImplementation((url: any) =>
        String(url) === CLEAR_CENSUS_URL ? Promise.resolve(clearCensusResponse) : Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      );
    }

    async function deleteTheOnlyCensus() {
      const user = userEvent.setup();
      render(<DashboardPage />);
      await user.click(await screen.findByRole('button', { name: 'More actions for census 1' }));
      await user.click(await screen.findByRole('menuitem', { name: /Delete census/ }));
      await user.click(await screen.findByRole('button', { name: 'Delete Census' }));
    }

    beforeEach(() => {
      vi.mocked(useSession).mockReturnValue({
        data: { ...mockSession, user: { ...mockSession.user, userStatus: 'global' } },
        status: 'authenticated',
        update: vi.fn()
      } as any);
      vi.mocked(useOrgCensusContext).mockReturnValue(undefined as any);
      useAppStore.getState().setCensusList([DELETABLE_CENSUS]);
    });

    afterEach(() => {
      useAppStore.getState().setCensusList([]);
    });

    it('shows a 409 body error verbatim', async () => {
      routeClearCensusTo(new Response(JSON.stringify({ error: CLEAR_CENSUS_CONFLICT_MESSAGE }), { status: HTTPResponses.CONFLICT }));
      await deleteTheOnlyCensus();

      expect(await screen.findByText(CLEAR_CENSUS_CONFLICT_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE)).not.toBeInTheDocument();
    });

    describe('refreshing the census list after a refusal', () => {
      const CENSUS_LIST_URL_FRAGMENT = '/api/fetchall/census/';

      function censusListFetchesAfterTheDeleteRequest() {
        const urls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
        const deleteRequestIndex = urls.indexOf(CLEAR_CENSUS_URL);
        return urls.slice(deleteRequestIndex + 1).filter(url => url.includes(CENSUS_LIST_URL_FRAGMENT));
      }

      it('refreshes the census list once after a 409 and still shows the server text', async () => {
        routeClearCensusTo(new Response(JSON.stringify({ error: CLEAR_CENSUS_CONFLICT_MESSAGE }), { status: HTTPResponses.CONFLICT }));
        await deleteTheOnlyCensus();

        expect(await screen.findByText(CLEAR_CENSUS_CONFLICT_MESSAGE)).toBeInTheDocument();
        const refreshes = censusListFetchesAfterTheDeleteRequest();
        console.log(`[#525 refused delete] census list fetches after the 409: ${JSON.stringify(refreshes)}`);
        expect(refreshes).toHaveLength(1);
      });

      it('refreshes the census list after a 404 refusal', async () => {
        routeClearCensusTo(new Response(JSON.stringify({ error: 'Census not found' }), { status: HTTPResponses.NOT_FOUND }));
        await deleteTheOnlyCensus();

        expect(await screen.findByText('Census not found')).toBeInTheDocument();
        expect(censusListFetchesAfterTheDeleteRequest()).toHaveLength(1);
      });

      it('does not refresh the census list after a 500', async () => {
        routeClearCensusTo(new Response(JSON.stringify({ error: SERVER_INTERNAL_DETAIL }), { status: HTTPResponses.INTERNAL_SERVER_ERROR }));
        await deleteTheOnlyCensus();

        expect(await screen.findByText(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE)).toBeInTheDocument();
        expect(censusListFetchesAfterTheDeleteRequest()).toHaveLength(0);
      });

      it('still shows the server text when the refresh itself fails', async () => {
        vi.mocked(global.fetch).mockImplementation((url: any) =>
          String(url) === CLEAR_CENSUS_URL
            ? Promise.resolve(new Response(JSON.stringify({ error: CLEAR_CENSUS_CONFLICT_MESSAGE }), { status: HTTPResponses.CONFLICT }))
            : String(url).includes(CENSUS_LIST_URL_FRAGMENT)
              ? Promise.reject(new TypeError('network down'))
              : Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        );
        await deleteTheOnlyCensus();

        expect(await screen.findByText(CLEAR_CENSUS_CONFLICT_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText(/refreshing the census list failed/)).not.toBeInTheDocument();
        expect(censusListFetchesAfterTheDeleteRequest()).toHaveLength(1);
      });
    });

    it('shows the generic text for a 4xx whose body is not JSON', async () => {
      routeClearCensusTo(new Response('<html>Not Found</html>', { status: HTTPResponses.NOT_FOUND }));
      await deleteTheOnlyCensus();

      expect(await screen.findByText(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE)).toBeInTheDocument();
    });

    it('shows the generic text for a 500 and never leaks its internal detail', async () => {
      routeClearCensusTo(new Response(JSON.stringify({ error: SERVER_INTERNAL_DETAIL }), { status: HTTPResponses.INTERNAL_SERVER_ERROR }));
      await deleteTheOnlyCensus();

      expect(await screen.findByText(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(SERVER_INTERNAL_DETAIL)).not.toBeInTheDocument();
    });
  });

  describe('Edit census dates', () => {
    const CENSUS_PATCH_URL = '/api/fixeddata/census/testsite/censusID';
    const CENSUS_LIST_URL_FRAGMENT = '/api/fetchall/census/';
    const EDITABLE_CENSUS_ID = 7;
    const EDITABLE_CENSUS = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [EDITABLE_CENSUS_ID],
      dateRanges: [
        {
          censusID: EDITABLE_CENSUS_ID,
          startDate: '2023-01-01T00:00:00.000Z',
          endDate: '2023-12-31T00:00:00.000Z',
          censusStartDate: '2023-01-01T00:00:00.000Z',
          censusEndDate: '2023-12-31T00:00:00.000Z',
          firstMeasurementDate: null,
          lastMeasurementDate: null
        }
      ],
      description: 'Only census',
      isActive: true
    };

    function routeCensusPatchTo(
      patchResponse: () => Promise<Response>,
      censusListResponse: () => Promise<Response> = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
    ) {
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        if (String(url) === CENSUS_PATCH_URL) return patchResponse();
        if (String(url).includes(CENSUS_LIST_URL_FRAGMENT)) return censusListResponse();
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      });
    }

    function callsAfterThePatch() {
      const urls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
      const patchIndex = urls.indexOf(CENSUS_PATCH_URL);
      return { patchIndex, censusListFetches: urls.slice(patchIndex + 1).filter(url => url.includes(CENSUS_LIST_URL_FRAGMENT)) };
    }

    async function openEditDatesModal() {
      const user = userEvent.setup();
      const view = render(<DashboardPage />);
      await user.click(await screen.findByRole('button', { name: 'More actions for census 1' }));
      await user.click(await screen.findByRole('menuitem', { name: /Edit census dates/ }));
      await screen.findByText('Edit Census 1 Dates');
      return { user, ...view };
    }

    beforeEach(() => {
      vi.mocked(useSession).mockReturnValue({
        data: { ...mockSession, user: { ...mockSession.user, userStatus: 'global' } },
        status: 'authenticated',
        update: vi.fn()
      } as any);
      vi.mocked(useOrgCensusContext).mockReturnValue(undefined as any);
      vi.mocked(useOrgCensusListDispatch).mockReturnValue(async ({ censusList }) => {
        useAppStore.getState().setCensusList(censusList ?? []);
      });
      useAppStore.getState().setCensusList([EDITABLE_CENSUS as any]);
    });

    afterEach(() => {
      vi.mocked(useOrgCensusListDispatch).mockReset();
      useAppStore.getState().setCensusList([]);
    });

    it('prefills the census window, PATCHes the edited days, refreshes the list once and closes', async () => {
      routeCensusPatchTo(() => Promise.resolve(new Response(JSON.stringify({ message: 'Update successful', changed: true }), { status: HTTPResponses.OK })));
      const { user } = await openEditDatesModal();

      const startInput = screen.getByLabelText(/^Start date/) as HTMLInputElement;
      const endInput = screen.getByLabelText('End date (optional)') as HTMLInputElement;
      console.log(`[edit census dates page] prefilled start="${startInput.value}" end="${endInput.value}"`);
      expect(startInput.value).toBe('2023-01-01');
      expect(endInput.value).toBe('2023-12-31');

      fireEvent.change(startInput, { target: { value: '2023-02-01' } });
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));

      await waitFor(() => expect(screen.queryByText('Edit Census 1 Dates')).not.toBeInTheDocument());
      const patchCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url) === CENSUS_PATCH_URL);
      console.log(`[edit census dates page] PATCH calls: ${JSON.stringify(patchCalls.map(([, init]) => init))}`);
      expect(patchCalls).toHaveLength(1);
      const [, patchInit] = patchCalls[0];
      expect(patchInit?.method).toBe('PATCH');
      expect(JSON.parse(String(patchInit?.body))).toEqual(buildCensusDatesPatchBody(EDITABLE_CENSUS_ID, { startDate: '2023-02-01', endDate: '2023-12-31' }));
      expect(callsAfterThePatch().censusListFetches).toHaveLength(1);
    });

    it('keeps the modal open with the save error when the PATCH fails, and does not refresh', async () => {
      routeCensusPatchTo(() => Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: HTTPResponses.INTERNAL_SERVER_ERROR })));
      const { user } = await openEditDatesModal();
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));

      expect(await screen.findByText(CENSUS_DATES_SAVE_FAILURE_MESSAGE)).toBeInTheDocument();
      expect(screen.getByText('Edit Census 1 Dates')).toBeInTheDocument();
      expect(screen.queryByText('boom')).not.toBeInTheDocument();
      expect(callsAfterThePatch().censusListFetches).toHaveLength(0);
    });

    it('closes the modal and reports a refresh failure separately when the save committed', async () => {
      routeCensusPatchTo(
        () => Promise.resolve(new Response(JSON.stringify({ message: 'Update successful', changed: true }), { status: HTTPResponses.OK })),
        () => Promise.reject(new TypeError('network down'))
      );
      const { user } = await openEditDatesModal();
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));

      expect(await screen.findByText(CENSUS_DATES_REFRESH_FAILURE_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText('Edit Census 1 Dates')).not.toBeInTheDocument();
      expect(screen.queryByText(CENSUS_DATES_SAVE_FAILURE_MESSAGE)).not.toBeInTheDocument();
    });

    it.each([
      { status: HTTPResponses.INTERNAL_SERVER_ERROR, body: { error: 'temporary server failure' } },
      { status: HTTPResponses.OK, body: { unexpected: 'not a census list' } },
      { status: HTTPResponses.OK, body: null }
    ])('preserves the list and reports a failed refresh for HTTP $status with $body', async ({ status, body }) => {
      routeCensusPatchTo(
        () => Promise.resolve(new Response('{}', { status: HTTPResponses.OK })),
        () => Promise.resolve(new Response(JSON.stringify(body), { status }))
      );
      const { user } = await openEditDatesModal();
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));

      expect(await screen.findByText(CENSUS_DATES_REFRESH_FAILURE_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText('Edit Census 1 Dates')).not.toBeInTheDocument();
      expect(screen.queryByText(CENSUS_DATES_SAVE_FAILURE_MESSAGE)).not.toBeInTheDocument();
      expect(useAppStore.getState().censusList).toEqual([EDITABLE_CENSUS]);
    });

    it('applies a successful refresh to the current plot', async () => {
      routeCensusPatchTo(
        () => Promise.resolve(new Response('{}', { status: HTTPResponses.OK })),
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  censusID: EDITABLE_CENSUS_ID,
                  plotID: 1,
                  plotCensusNumber: 1,
                  isActive: 1,
                  censusStartDate: '2023-02-01',
                  censusEndDate: '2023-12-31'
                }
              ]),
              { status: HTTPResponses.OK }
            )
          )
      );
      const { user } = await openEditDatesModal();
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));

      await waitFor(() => expect(useAppStore.getState().censusList[0]?.dateRanges[0].censusStartDate).toBe('2023-02-01'));
      expect(screen.queryByText(CENSUS_DATES_REFRESH_FAILURE_MESSAGE)).not.toBeInTheDocument();
    });

    it.each(['site', 'plot', 'site round trip', 'unmount'] as const)('ignores a late refresh after a %s change even when fetch ignores abort', async change => {
      let finishRefresh!: (response: Response) => void;
      const pendingRefresh = new Promise<Response>(resolve => {
        finishRefresh = resolve;
      });
      routeCensusPatchTo(
        () => Promise.resolve(new Response('{}', { status: HTTPResponses.OK })),
        () => pendingRefresh
      );
      const { user, rerender, unmount } = await openEditDatesModal();
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));
      await waitFor(() => expect(screen.queryByText('Edit Census 1 Dates')).not.toBeInTheDocument());
      const refreshCall = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url).includes(CENSUS_LIST_URL_FRAGMENT));
      expect(refreshCall).toBeDefined();

      const newPlotID = change === 'plot' ? 2 : 1;
      const newCensus = {
        ...EDITABLE_CENSUS,
        plotID: newPlotID,
        censusIDs: [99],
        dateRanges: [{ ...EDITABLE_CENSUS.dateRanges[0], censusID: 99 }]
      };
      if (change === 'unmount') {
        unmount();
      } else if (change === 'plot') {
        vi.mocked(usePlotContext).mockReturnValue({ ...mockPlot, plotID: newPlotID } as any);
        rerender(<DashboardPage />);
      } else {
        vi.mocked(useSiteContext).mockReturnValue({ schemaName: 'other_site', siteName: 'Other Site' } as any);
        rerender(<DashboardPage />);
        if (change === 'site round trip') {
          vi.mocked(useSiteContext).mockReturnValue(mockSite as any);
          rerender(<DashboardPage />);
        }
      }
      await act(async () => {
        useAppStore.getState().setCensusList([newCensus as any]);
      });
      expect(refreshCall?.[1]?.signal?.aborted).toBe(true);

      await act(async () =>
        finishRefresh(
          new Response(
            JSON.stringify([
              {
                censusID: EDITABLE_CENSUS_ID,
                plotID: 1,
                plotCensusNumber: 1,
                isActive: 1,
                censusStartDate: '2023-02-01',
                censusEndDate: '2023-12-31'
              }
            ]),
            { status: HTTPResponses.OK }
          )
        )
      );

      expect(useAppStore.getState().censusList).toEqual([newCensus]);
      expect(screen.queryByText(CENSUS_DATES_REFRESH_FAILURE_MESSAGE)).not.toBeInTheDocument();
    });

    it('ignores a stale refresh failure after switching sites', async () => {
      let failRefresh!: (error: Error) => void;
      const pendingRefresh = new Promise<Response>((_resolve, reject) => {
        failRefresh = reject;
      });
      routeCensusPatchTo(
        () => Promise.resolve(new Response('{}', { status: HTTPResponses.OK })),
        () => pendingRefresh
      );
      const { user, rerender } = await openEditDatesModal();
      await user.click(screen.getByRole('button', { name: 'Save Dates' }));
      await waitFor(() => expect(screen.queryByText('Edit Census 1 Dates')).not.toBeInTheDocument());
      vi.mocked(useSiteContext).mockReturnValue({ schemaName: 'other_site', siteName: 'Other Site' } as any);
      rerender(<DashboardPage />);

      await act(async () => failRefresh(new TypeError('late network failure')));
      expect(screen.queryByText(CENSUS_DATES_REFRESH_FAILURE_MESSAGE)).not.toBeInTheDocument();
      expect(useAppStore.getState().censusList).toEqual([EDITABLE_CENSUS]);
    });
  });

  describe('Empty State', () => {
    it('should show no activity message when changelog is empty', async () => {
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        if (url.includes('/api/dashboardmetrics/all/')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockDashboardData)
          } as Response);
        }
        if (url.includes('/api/changelog/overview/unifiedchangelog/')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([])
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      render(<DashboardPage />);

      await waitFor(() => {
        // Updated to match EmptyState component text
        expect(screen.getByText('No Recent Activity')).toBeInTheDocument();
      });
    });
  });

  describe('scope switching (#517)', () => {
    const metricsPayload = (trees: number, stems: number, populated = 10) => ({
      progressTachometer: { TotalQuadrats: 100, PopulatedQuadrats: populated, PopulatedPercent: populated, UnpopulatedQuadrats: '' },
      activeUsers: { CountActiveUsers: 1 },
      countTrees: { CountTrees: trees },
      countStems: { CountStems: stems },
      stemTypes: { CountOldStems: 0, CountMultiStems: 0, CountNewRecruits: 0 }
    });
    const censusWithID = (censusID: number, plotCensusNumber = censusID) =>
      ({ dateRanges: [{ censusID, startDate: '2024-01-01', endDate: '2024-12-31' }], plotCensusNumber }) as any;
    const json = (body: unknown, ok = true, status = 200) =>
      Promise.resolve({ ok, status, statusText: ok ? 'OK' : 'Err', json: () => Promise.resolve(body) } as Response);
    const metricsCalls = () =>
      vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => String(url))
        .filter(url => url.includes('/api/dashboardmetrics/all/'));

    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('fires the new scope request even while the previous scope request is still in flight', async () => {
      vi.mocked(global.fetch).mockImplementation((url: any) => (String(url).includes('/api/dashboardmetrics/') ? new Promise(() => undefined) : json([])));
      const { rerender } = render(<DashboardPage />);
      await waitFor(() => expect(metricsCalls()).toEqual(['/api/dashboardmetrics/all/testsite/1/1']));

      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);

      await waitFor(() => expect(metricsCalls()).toEqual(['/api/dashboardmetrics/all/testsite/1/1', '/api/dashboardmetrics/all/testsite/1/2']));
    });

    it('requests metrics for the new plot when only the plot changes (never the old plot)', async () => {
      const { rerender } = render(<DashboardPage />);
      await screen.findByText('1,234');

      vi.mocked(usePlotContext).mockReturnValue({ plotID: 2, plotName: 'Plot 2' } as any);
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(5));
      rerender(<DashboardPage />);

      await waitFor(() => expect(metricsCalls()).toContain('/api/dashboardmetrics/all/testsite/2/5'));
    });

    it('does not issue any metrics request while a switched site has no plot/census selected yet', async () => {
      const { rerender } = render(<DashboardPage />);
      await screen.findByText('1,234');
      const before = metricsCalls().length;

      // What the store cascade produces on a site switch: new site, plot and census cleared.
      vi.mocked(useSiteContext).mockReturnValue({ schemaName: 'newsite', siteName: 'New Site' } as any);
      vi.mocked(usePlotContext).mockReturnValue(undefined as any);
      vi.mocked(useOrgCensusContext).mockReturnValue(undefined as any);
      rerender(<DashboardPage />);

      expect(metricsCalls()).toHaveLength(before);
      expect(metricsCalls().some(url => url.includes('newsite'))).toBe(false);
      expect(screen.queryByText('1,234')).not.toBeInTheDocument();
      expect(screen.queryByText('No Census Data Yet')).not.toBeInTheDocument();
    });

    it('replaces the previous census counts with a loading state instead of keeping or emptying them', async () => {
      const { rerender } = render(<DashboardPage />);
      await screen.findByText('1,234');

      vi.mocked(global.fetch).mockImplementation((url: any) => (String(url).includes('/api/dashboardmetrics/') ? new Promise(() => undefined) : json([])));
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);

      expect(screen.queryByText('1,234')).not.toBeInTheDocument();
      expect(screen.queryByText('2,468')).not.toBeInTheDocument();
      expect(screen.queryByText('No Census Data Yet')).not.toBeInTheDocument();
      expect(screen.getByText('Loading recent activity...')).toBeInTheDocument();
    });

    it('shows "No Census Data Yet" only after a successful empty current-scope response, never while loading', async () => {
      const pending = deferred<Response>();
      vi.mocked(global.fetch).mockImplementation((url: any) => (String(url).includes('/api/dashboardmetrics/') ? pending.promise : json([])));

      render(<DashboardPage />);
      expect(screen.queryByText('No Census Data Yet')).not.toBeInTheDocument();

      pending.resolve({ ok: true, json: () => Promise.resolve(metricsPayload(0, 0, 0)) } as Response);
      expect(await screen.findByText('No Census Data Yet')).toBeInTheDocument();
    });

    it('ignores an older response that resolves after a newer scope response (out of order)', async () => {
      const older = deferred<Response>();
      const newer = deferred<Response>();
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        const u = String(url);
        if (u.endsWith('/testsite/1/1')) return older.promise;
        if (u.endsWith('/testsite/1/2')) return newer.promise;
        return json([]);
      });
      const { rerender } = render(<DashboardPage />);
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);

      newer.resolve({ ok: true, json: () => Promise.resolve(metricsPayload(222, 444)) } as Response);
      expect(await screen.findByText('222')).toBeInTheDocument();

      older.resolve({ ok: true, json: () => Promise.resolve(metricsPayload(111, 999)) } as Response);
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.getByText('222')).toBeInTheDocument();
      expect(screen.queryByText('111')).not.toBeInTheDocument();
      expect(screen.queryByText('999')).not.toBeInTheDocument();
    });

    it('ignores a stale error from a superseded scope', async () => {
      const older = deferred<Response>();
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        const u = String(url);
        if (u.endsWith('/testsite/1/1')) return older.promise;
        if (u.endsWith('/testsite/1/2')) return json(metricsPayload(222, 444));
        return json([]);
      });
      const { rerender } = render(<DashboardPage />);
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);
      await screen.findByText('222');

      older.reject(new Error('late failure from the old census'));
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.getByText('222')).toBeInTheDocument();
      expect(screen.queryByText('Could not load census data')).not.toBeInTheDocument();
      expect(screen.queryByText(/late failure/)).not.toBeInTheDocument();
    });

    it('aborts the previous scope request on scope change and on unmount', async () => {
      const signals: Record<string, AbortSignal> = {};
      vi.mocked(global.fetch).mockImplementation((url: any, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/api/dashboardmetrics/')) {
          signals[u] = init!.signal as AbortSignal;
          return new Promise(() => undefined);
        }
        return json([]);
      });
      const { rerender, unmount } = render(<DashboardPage />);
      await waitFor(() => expect(Object.keys(signals)).toHaveLength(1));

      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);
      await waitFor(() => expect(Object.keys(signals)).toHaveLength(2));

      expect(signals['/api/dashboardmetrics/all/testsite/1/1'].aborted).toBe(true);
      expect(signals['/api/dashboardmetrics/all/testsite/1/2'].aborted).toBe(false);

      unmount();
      expect(signals['/api/dashboardmetrics/all/testsite/1/2'].aborted).toBe(true);
    });

    it('shows an error state with retry (not "No Census Data Yet") when the request fails, and retry reloads the same scope', async () => {
      let failing = true;
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        if (String(url).includes('/api/dashboardmetrics/')) {
          return failing ? json({}, false, 500) : json(metricsPayload(1234, 2468));
        }
        return json([]);
      });

      render(<DashboardPage />);

      expect(await screen.findByText('Could not load census data')).toBeInTheDocument();
      expect(screen.getByText(/Failed to load dashboard data: 500/)).toBeInTheDocument();
      expect(screen.queryByText('No Census Data Yet')).not.toBeInTheDocument();

      failing = false;
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('1,234')).toBeInTheDocument();
      expect(screen.queryByText('Could not load census data')).not.toBeInTheDocument();
      expect(metricsCalls()).toEqual(['/api/dashboardmetrics/all/testsite/1/1', '/api/dashboardmetrics/all/testsite/1/1']);
    });

    it('treats a network failure as an error, not as empty data', async () => {
      vi.mocked(global.fetch).mockImplementation((url: any) =>
        String(url).includes('/api/dashboardmetrics/') ? Promise.reject(new Error('Network down')) : json([])
      );

      render(<DashboardPage />);

      expect(await screen.findByText('Could not load census data')).toBeInTheDocument();
      expect(screen.getByText('Network down')).toBeInTheDocument();
      expect(screen.queryByText('No Census Data Yet')).not.toBeInTheDocument();
    });

    it('A -> B -> A after A succeeded shows loading for the new A request, not the previous A result', async () => {
      const { rerender } = render(<DashboardPage />);
      await screen.findByText('1,234');

      const secondA = deferred<Response>();
      let aCalls = 0;
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        const u = String(url);
        if (u.endsWith('/testsite/1/1')) {
          aCalls++;
          return secondA.promise;
        }
        if (u.endsWith('/testsite/1/2')) return new Promise(() => undefined);
        return json([]);
      });
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(1));
      rerender(<DashboardPage />);

      await waitFor(() => expect(aCalls).toBe(1));
      expect(screen.queryByText('1,234')).not.toBeInTheDocument();
      expect(screen.getByText('Loading recent activity...')).toBeInTheDocument();

      secondA.resolve({ ok: true, json: () => Promise.resolve(metricsPayload(777, 1)) } as Response);
      expect(await screen.findByText('777')).toBeInTheDocument();
    });

    it('A -> B -> A while the first A request is still pending ignores the first A response', async () => {
      const firstA = deferred<Response>();
      const secondA = deferred<Response>();
      let aCalls = 0;
      vi.mocked(global.fetch).mockImplementation((url: any) => {
        const u = String(url);
        if (u.endsWith('/testsite/1/1')) return ++aCalls === 1 ? firstA.promise : secondA.promise;
        if (u.endsWith('/testsite/1/2')) return new Promise(() => undefined);
        return json([]);
      });
      const { rerender } = render(<DashboardPage />);
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(2));
      rerender(<DashboardPage />);
      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(1));
      rerender(<DashboardPage />);
      await waitFor(() => expect(aCalls).toBe(2));

      firstA.resolve({ ok: true, json: () => Promise.resolve(metricsPayload(111, 999)) } as Response);
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.queryByText('111')).not.toBeInTheDocument();
      expect(screen.getByText('Loading recent activity...')).toBeInTheDocument();

      secondA.resolve({ ok: true, json: () => Promise.resolve(metricsPayload(777, 1)) } as Response);
      expect(await screen.findByText('777')).toBeInTheDocument();
    });

    it('does not reload when the census object is re-created with the same scope', async () => {
      const { rerender } = render(<DashboardPage />);
      await screen.findByText('1,234');

      vi.mocked(useOrgCensusContext).mockReturnValue(censusWithID(1));
      rerender(<DashboardPage />);

      expect(metricsCalls()).toHaveLength(1);
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });
  });
});
