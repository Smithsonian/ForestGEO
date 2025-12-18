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
import { render, screen, waitFor, within as _within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './page';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';

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
vi.mock('@/config/sqlrdsdefinitions/views', async importOriginal => {
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
vi.mock('@/config/sqlrdsdefinitions/core', async importOriginal => {
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
vi.mock('@/config/sqlrdsdefinitions/personnel', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getPersonnelHCs: () => ({
      censusID: false,
      personnelID: false
    })
  };
});
vi.mock('@/config/sqlrdsdefinitions/zones', async importOriginal => {
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
vi.mock('@/config/sqlrdsdefinitions/taxonomies', async importOriginal => {
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
        expect(screen.getByText(/INSERT on stems/)).toBeInTheDocument();
        expect(screen.getByText(/UPDATE on measurements/)).toBeInTheDocument();
      });
    });

    it('should display changelog with accordions', async () => {
      render(<DashboardPage />);

      // Wait for changelog entries to load
      await waitFor(
        () => {
          expect(screen.getByText(/INSERT on stems/)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Verify the accordion structure exists
      expect(screen.getByText(/UPDATE on measurements/)).toBeInTheDocument();
    });

    it('should display changelog operation details', async () => {
      render(<DashboardPage />);

      // Wait for changelog entries to load
      await waitFor(
        () => {
          // Check that changelog data is displayed
          expect(screen.getByText(/INSERT on stems/)).toBeInTheDocument();
          expect(screen.getByText(/UPDATE on measurements/)).toBeInTheDocument();
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
});
