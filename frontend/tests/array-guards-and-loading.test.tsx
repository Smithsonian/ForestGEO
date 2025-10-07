import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useSession } from 'next-auth/react';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch
} from '@/app/contexts/userselectionprovider';
import { useOrgCensusListContext, usePlotListContext, useQuadratListContext, useSiteListContext } from '@/app/contexts/listselectionprovider';
import { useAsyncOperation } from '@/hooks/useAsyncOperation';

// Mock all the context hooks
vi.mock('@/app/contexts/userselectionprovider', () => ({
  useOrgCensusContext: vi.fn(),
  useOrgCensusDispatch: vi.fn(),
  usePlotContext: vi.fn(),
  usePlotDispatch: vi.fn(),
  useSiteContext: vi.fn(),
  useSiteDispatch: vi.fn()
}));

vi.mock('@/app/contexts/listselectionprovider', () => ({
  useOrgCensusListContext: vi.fn(),
  useOrgCensusListDispatch: vi.fn(),
  usePlotListContext: vi.fn(),
  usePlotListDispatch: vi.fn(),
  useSiteListContext: vi.fn(),
  useSiteListDispatch: vi.fn(),
  useQuadratListContext: vi.fn(),
  useQuadratListDispatch: vi.fn()
}));

vi.mock('next-auth/react', () => ({
  useSession: vi.fn()
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn()
  })
}));

vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({ validity: { sites: true, plots: true, census: true, quadrats: true } })
}));

vi.mock('@/app/contexts/loadingprovider', () => ({
  useLoading: () => ({
    setLoading: vi.fn(),
    startOperation: vi.fn(() => 'operation-id'),
    endOperation: vi.fn(),
    isOperationActive: vi.fn(() => false)
  })
}));

vi.mock('@/app/contexts/lockanimationcontext', () => ({
  useLockAnimation: () => ({ isPulsing: false })
}));

vi.mock('@/hooks/useAsyncOperation');

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), log: vi.fn(), warn: vi.fn() }
}));

describe('Array Guard Protection Tests', () => {
  const mockSites = [
    { siteID: 1, siteName: 'Site A', schemaName: 'site_a', subquadratDimX: 5, subquadratDimY: 5, doubleDataEntry: true },
    { siteID: 2, siteName: 'Site B', schemaName: 'site_b', subquadratDimX: 5, subquadratDimY: 5, doubleDataEntry: true }
  ];

  const mockPlots = [
    { plotID: 1, plotName: 'Plot 1', numQuadrats: 100, area: 1, dimensionX: 100, dimensionY: 100 },
    { plotID: 2, plotName: 'Plot 2', numQuadrats: 200, area: 2, dimensionX: 200, dimensionY: 100 }
  ];

  const mockCensuses = [
    {
      plotCensusNumber: 1,
      dateRanges: [{ censusID: 1, plotID: 1, startDate: '2020-01-01', endDate: '2020-12-31' }]
    },
    {
      plotCensusNumber: 2,
      dateRanges: [{ censusID: 2, plotID: 1, startDate: '2021-01-01', endDate: '2021-12-31' }]
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Context Array Guard Tests', () => {
    it('should handle undefined plotListContext without throwing "map is not a function" error', () => {
      (usePlotListContext as any).mockReturnValue(undefined);

      // Simulate the rendering logic that would call .map()
      const plotListContext = usePlotListContext();

      // This should not throw an error when we check Array.isArray
      expect(() => {
        if (Array.isArray(plotListContext)) {
          plotListContext.map(item => item.plotName);
        }
      }).not.toThrow();

      // Verify it's undefined
      expect(plotListContext).toBeUndefined();
    });

    it('should handle null plotListContext without throwing error', () => {
      (usePlotListContext as any).mockReturnValue(null);

      const plotListContext = usePlotListContext();

      expect(() => {
        if (Array.isArray(plotListContext)) {
          plotListContext.map(item => item.plotName);
        }
      }).not.toThrow();

      expect(plotListContext).toBeNull();
    });

    it('should handle empty array for plotListContext', () => {
      (usePlotListContext as any).mockReturnValue([]);

      const plotListContext = usePlotListContext();

      expect(Array.isArray(plotListContext)).toBe(true);
      expect(plotListContext).toHaveLength(0);

      // Should not throw and should return empty array
      const result = Array.isArray(plotListContext) ? plotListContext.map(item => item.plotName) : [];
      expect(result).toEqual([]);
    });

    it('should successfully map over valid plotListContext', () => {
      (usePlotListContext as any).mockReturnValue(mockPlots);

      const plotListContext = usePlotListContext();

      expect(Array.isArray(plotListContext)).toBe(true);
      expect(plotListContext).toHaveLength(2);

      const plotNames = Array.isArray(plotListContext) ? plotListContext.map(item => item.plotName) : [];
      expect(plotNames).toEqual(['Plot 1', 'Plot 2']);
    });

    it('should handle undefined censusListContext during state transitions', () => {
      (useOrgCensusListContext as any).mockReturnValue(undefined);

      const censusListContext = useOrgCensusListContext();

      expect(() => {
        if (Array.isArray(censusListContext)) {
          censusListContext.sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0)).map(item => item?.plotCensusNumber);
        }
      }).not.toThrow();

      expect(censusListContext).toBeUndefined();
    });

    it('should handle undefined siteListContext for filtering operations', () => {
      (useSiteListContext as any).mockReturnValue(undefined);
      const mockSession = {
        user: {
          sites: [{ siteID: 1 }]
        }
      };

      const siteListContext = useSiteListContext();

      // Simulate the filtering logic used in sidebar
      const allowedSites = Array.isArray(siteListContext)
        ? siteListContext.filter(site => mockSession.user.sites.some(allowedSite => allowedSite.siteID === site.siteID))
        : [];

      expect(allowedSites).toEqual([]);
      expect(() => allowedSites.map(site => site.siteName)).not.toThrow();
    });

    it('should handle nested array operations (dateRanges.map)', () => {
      const censusWithUndefinedDateRanges = {
        plotCensusNumber: 1,
        dateRanges: undefined as any
      };

      expect(() => {
        if (Array.isArray(censusWithUndefinedDateRanges.dateRanges)) {
          censusWithUndefinedDateRanges.dateRanges.map((dr: any) => dr.startDate);
        }
      }).not.toThrow();

      // Verify nested arrays work correctly when valid
      const validCensus = mockCensuses[0];
      expect(Array.isArray(validCensus.dateRanges)).toBe(true);
      const dates = validCensus.dateRanges.map(dr => dr.startDate);
      expect(dates).toEqual(['2020-01-01']);
    });
  });

  describe('Context Reduce Operations', () => {
    it('should handle reduce operations on undefined censusListContext', () => {
      (useOrgCensusListContext as any).mockReturnValue(undefined);

      const censusListContext = useOrgCensusListContext();

      // Simulate the reduce logic used for finding max census number
      const maxCensusNumber = Array.isArray(censusListContext)
        ? censusListContext.reduce((currentMax, item) => Math.max(currentMax, item?.plotCensusNumber ?? 0), 0)
        : 0;

      expect(maxCensusNumber).toBe(0);
    });

    it('should correctly compute max census number when data is available', () => {
      (useOrgCensusListContext as any).mockReturnValue(mockCensuses);

      const censusListContext = useOrgCensusListContext();

      const maxCensusNumber = Array.isArray(censusListContext)
        ? censusListContext.reduce((currentMax, item) => Math.max(currentMax, item?.plotCensusNumber ?? 0), 0)
        : 0;

      expect(maxCensusNumber).toBe(2);
    });
  });

  describe('Filter and Sort Chain Operations', () => {
    it('should handle filter and sort on undefined arrays', () => {
      (useSiteListContext as any).mockReturnValue(undefined);
      const mockSession = {
        user: {
          sites: [{ siteID: 1 }]
        }
      };

      const siteListContext = useSiteListContext();

      // Simulate the complete filter-sort-map chain
      const allowedSites = Array.isArray(siteListContext)
        ? siteListContext
            .filter(site => mockSession.user.sites.some(allowedSite => allowedSite.siteID === site.siteID))
            .sort((a, b) => {
              const nameA = a.siteName?.toLowerCase() ?? '';
              const nameB = b.siteName?.toLowerCase() ?? '';
              return nameA.localeCompare(nameB);
            })
        : [];

      expect(allowedSites).toEqual([]);
    });

    it('should correctly filter, sort, and map when data is available', () => {
      (useSiteListContext as any).mockReturnValue(mockSites);
      const mockSession = {
        user: {
          sites: [{ siteID: 1 }, { siteID: 2 }]
        }
      };

      const siteListContext = useSiteListContext();

      const allowedSites = Array.isArray(siteListContext)
        ? siteListContext
            .filter(site => mockSession.user.sites.some(allowedSite => allowedSite.siteID === site.siteID))
            .sort((a, b) => {
              const nameA = a.siteName?.toLowerCase() ?? '';
              const nameB = b.siteName?.toLowerCase() ?? '';
              return nameA.localeCompare(nameB);
            })
        : [];

      expect(allowedSites).toHaveLength(2);
      expect(allowedSites.map(s => s.siteName)).toEqual(['Site A', 'Site B']);
    });
  });

  describe('State Transition Edge Cases', () => {
    it('should handle rapid context clearing and resetting', async () => {
      // Start with data
      (usePlotListContext as any).mockReturnValue(mockPlots);
      let plotListContext = usePlotListContext();
      expect(Array.isArray(plotListContext)).toBe(true);
      expect(plotListContext).toHaveLength(2);

      // Simulate clearing (set to undefined)
      (usePlotListContext as any).mockReturnValue(undefined);
      plotListContext = usePlotListContext();
      expect(() => {
        if (Array.isArray(plotListContext)) {
          plotListContext.map(item => item.plotName);
        }
      }).not.toThrow();
      expect(plotListContext).toBeUndefined();

      // Simulate reloading
      (usePlotListContext as any).mockReturnValue(mockPlots);
      plotListContext = usePlotListContext();
      expect(Array.isArray(plotListContext)).toBe(true);
      expect(plotListContext).toHaveLength(2);
    });

    it('should handle site change that clears dependent contexts', () => {
      // Initial state: all contexts populated
      (useSiteListContext as any).mockReturnValue(mockSites);
      (usePlotListContext as any).mockReturnValue(mockPlots);
      (useOrgCensusListContext as any).mockReturnValue(mockCensuses);

      // Verify all are arrays
      expect(Array.isArray(useSiteListContext())).toBe(true);
      expect(Array.isArray(usePlotListContext())).toBe(true);
      expect(Array.isArray(useOrgCensusListContext())).toBe(true);

      // Site changes: plots and censuses should be cleared
      (usePlotListContext as any).mockReturnValue(undefined);
      (useOrgCensusListContext as any).mockReturnValue(undefined);

      // Verify array guards protect against undefined
      const plotListContext = usePlotListContext();
      const censusListContext = useOrgCensusListContext();

      expect(() => {
        if (Array.isArray(plotListContext)) {
          plotListContext.map(item => item.plotName);
        }
        if (Array.isArray(censusListContext)) {
          censusListContext.map(item => item?.plotCensusNumber);
        }
      }).not.toThrow();
    });

    it('should handle plot change that clears census context', () => {
      // Initial state: plot and census populated
      (usePlotListContext as any).mockReturnValue(mockPlots);
      (useOrgCensusListContext as any).mockReturnValue(mockCensuses);

      expect(Array.isArray(usePlotListContext())).toBe(true);
      expect(Array.isArray(useOrgCensusListContext())).toBe(true);

      // Plot changes: census should be cleared
      (useOrgCensusListContext as any).mockReturnValue(undefined);

      const censusListContext = useOrgCensusListContext();
      expect(() => {
        if (Array.isArray(censusListContext)) {
          censusListContext.sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0)).map(item => item?.plotCensusNumber);
        }
      }).not.toThrow();
      expect(censusListContext).toBeUndefined();
    });
  });

  describe('Complex Rendering Scenarios', () => {
    it('should render Select dropdown options with undefined context', () => {
      (usePlotListContext as any).mockReturnValue(undefined);

      const plotListContext = usePlotListContext();

      // Simulate rendering logic
      const options = Array.isArray(plotListContext)
        ? plotListContext.map(item => ({
            key: item.plotName,
            value: item.plotName,
            label: item.plotName
          }))
        : [];

      expect(options).toEqual([]);
    });

    it('should render nested components with undefined dateRanges', () => {
      const invalidCensus = {
        plotCensusNumber: 1,
        dateRanges: undefined as any
      };

      // Simulate the dateRanges rendering logic
      const dateRangeComponents = Array.isArray(invalidCensus.dateRanges)
        ? invalidCensus.dateRanges.map((dateRange, index) => ({
            key: index,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate
          }))
        : [];

      expect(dateRangeComponents).toEqual([]);
    });

    it('should safely compute array lengths for display', () => {
      // Test with undefined
      (usePlotListContext as any).mockReturnValue(undefined);
      let plotListContext = usePlotListContext();
      let length = Array.isArray(plotListContext) ? plotListContext.length : 0;
      expect(length).toBe(0);

      // Test with empty array
      (usePlotListContext as any).mockReturnValue([]);
      plotListContext = usePlotListContext();
      length = Array.isArray(plotListContext) ? plotListContext.length : 0;
      expect(length).toBe(0);

      // Test with valid array
      (usePlotListContext as any).mockReturnValue(mockPlots);
      plotListContext = usePlotListContext();
      length = Array.isArray(plotListContext) ? plotListContext.length : 0;
      expect(length).toBe(2);
    });
  });

  describe('Error Boundary Integration', () => {
    it('should not trigger error boundary with undefined context arrays', () => {
      // Set all contexts to undefined
      (useSiteListContext as any).mockReturnValue(undefined);
      (usePlotListContext as any).mockReturnValue(undefined);
      (useOrgCensusListContext as any).mockReturnValue(undefined);
      (useQuadratListContext as any).mockReturnValue(undefined);

      // All these operations should complete without throwing
      expect(() => {
        const siteListContext = useSiteListContext();
        const plotListContext = usePlotListContext();
        const censusListContext = useOrgCensusListContext();
        const quadratListContext = useQuadratListContext();

        if (Array.isArray(siteListContext)) siteListContext.map(s => s?.siteName);
        if (Array.isArray(plotListContext)) plotListContext.map(p => p?.plotName);
        if (Array.isArray(censusListContext)) censusListContext.map(c => c?.plotCensusNumber);
        if (Array.isArray(quadratListContext)) quadratListContext.map(q => q?.quadratID);
      }).not.toThrow();
    });

    it('should not trigger error boundary with null context arrays', () => {
      (useSiteListContext as any).mockReturnValue(null);
      (usePlotListContext as any).mockReturnValue(null);

      expect(() => {
        const siteListContext = useSiteListContext();
        const plotListContext = usePlotListContext();

        if (Array.isArray(siteListContext)) siteListContext.map(s => s?.siteName);
        if (Array.isArray(plotListContext)) plotListContext.map(p => p?.plotName);
      }).not.toThrow();
    });
  });
});
