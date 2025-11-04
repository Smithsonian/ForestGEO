import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import UserSelectionProvider, {
  usePlotContext,
  usePlotDispatch,
  useOrgCensusContext,
  useOrgCensusDispatch,
  useQuadratContext,
  useQuadratDispatch,
  useSiteContext,
  useSiteDispatch
} from './userselectionprovider';

// Mock the list selection provider hooks
vi.mock('@/app/contexts/listselectionprovider', () => ({
  usePlotListContext: vi.fn(() => [
    { PlotID: 1, PlotName: 'Test Plot 1' },
    { PlotID: 2, PlotName: 'Test Plot 2' }
  ]),
  useOrgCensusListContext: vi.fn(() => [
    { CensusID: 1, PlotCensusNumber: 1 },
    { CensusID: 2, PlotCensusNumber: 2 }
  ]),
  useQuadratListContext: vi.fn(() => [
    { QuadratID: 1, QuadratName: 'Q1' },
    { QuadratID: 2, QuadratName: 'Q2' }
  ]),
  useSiteListContext: vi.fn(() => [
    { SiteID: 1, SiteName: 'Test Site 1' },
    { SiteID: 2, SiteName: 'Test Site 2' }
  ])
}));

// Mock the context reducers
vi.mock('@/config/macros/contextreducers', () => ({
  createEnhancedDispatch: vi.fn((dispatch, _name) => dispatch),
  genericLoadContextReducer: vi.fn((state, action, _list) => {
    if (action.load !== undefined) {
      return action.load;
    }
    return state;
  })
}));

describe('UserSelectionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Provider Initialization', () => {
    it('should render children correctly', () => {
      // Simply verify that the provider can be instantiated without errors
      expect(() => {
        renderHook(() => ({}), {
          wrapper: UserSelectionProvider
        });
      }).not.toThrow();
    });

    it('should provide initial undefined values for all contexts', () => {
      const { result } = renderHook(
        () => ({
          plot: usePlotContext(),
          orgCensus: useOrgCensusContext(),
          quadrat: useQuadratContext(),
          site: useSiteContext()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(result.current.plot).toBeUndefined();
      expect(result.current.orgCensus).toBeUndefined();
      expect(result.current.quadrat).toBeUndefined();
      expect(result.current.site).toBeUndefined();
    });
  });

  describe('Context Hooks', () => {
    it('should provide plot context and dispatch', () => {
      const { result } = renderHook(
        () => ({
          plot: usePlotContext(),
          dispatch: usePlotDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(result.current.plot).toBeUndefined();
      expect(result.current.dispatch).toBeDefined();
      expect(typeof result.current.dispatch).toBe('function');
    });

    it('should provide orgCensus context and dispatch', () => {
      const { result } = renderHook(
        () => ({
          orgCensus: useOrgCensusContext(),
          dispatch: useOrgCensusDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(result.current.orgCensus).toBeUndefined();
      expect(result.current.dispatch).toBeDefined();
      expect(typeof result.current.dispatch).toBe('function');
    });

    it('should provide quadrat context and dispatch', () => {
      const { result } = renderHook(
        () => ({
          quadrat: useQuadratContext(),
          dispatch: useQuadratDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(result.current.quadrat).toBeUndefined();
      expect(result.current.dispatch).toBeDefined();
      expect(typeof result.current.dispatch).toBe('function');
    });

    it('should provide site context and dispatch', () => {
      const { result } = renderHook(
        () => ({
          site: useSiteContext(),
          dispatch: useSiteDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(result.current.site).toBeUndefined();
      expect(result.current.dispatch).toBeDefined();
      expect(typeof result.current.dispatch).toBe('function');
    });
  });

  describe('Multiple Context Access', () => {
    it('should provide all contexts simultaneously', () => {
      const { result } = renderHook(
        () => ({
          plot: usePlotContext(),
          plotDispatch: usePlotDispatch(),
          orgCensus: useOrgCensusContext(),
          orgCensusDispatch: useOrgCensusDispatch(),
          quadrat: useQuadratContext(),
          quadratDispatch: useQuadratDispatch(),
          site: useSiteContext(),
          siteDispatch: useSiteDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      // All contexts should be undefined initially
      expect(result.current.plot).toBeUndefined();
      expect(result.current.orgCensus).toBeUndefined();
      expect(result.current.quadrat).toBeUndefined();
      expect(result.current.site).toBeUndefined();

      // All dispatches should be defined
      expect(result.current.plotDispatch).toBeDefined();
      expect(result.current.orgCensusDispatch).toBeDefined();
      expect(result.current.quadratDispatch).toBeDefined();
      expect(result.current.siteDispatch).toBeDefined();
    });

    it('should have all dispatches as functions', () => {
      const { result } = renderHook(
        () => ({
          plotDispatch: usePlotDispatch(),
          orgCensusDispatch: useOrgCensusDispatch(),
          quadratDispatch: useQuadratDispatch(),
          siteDispatch: useSiteDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(typeof result.current.plotDispatch).toBe('function');
      expect(typeof result.current.orgCensusDispatch).toBe('function');
      expect(typeof result.current.quadratDispatch).toBe('function');
      expect(typeof result.current.siteDispatch).toBe('function');
    });
  });

  describe('Hook Usage Outside Provider', () => {
    it('should return undefined when usePlotContext is called outside provider', () => {
      const { result } = renderHook(() => usePlotContext());
      expect(result.current).toBeUndefined();
    });

    it('should return undefined when useOrgCensusContext is called outside provider', () => {
      const { result } = renderHook(() => useOrgCensusContext());
      expect(result.current).toBeUndefined();
    });

    it('should return undefined when useQuadratContext is called outside provider', () => {
      const { result } = renderHook(() => useQuadratContext());
      expect(result.current).toBeUndefined();
    });

    it('should return undefined when useSiteContext is called outside provider', () => {
      const { result } = renderHook(() => useSiteContext());
      expect(result.current).toBeUndefined();
    });

    it('should return undefined when dispatch hooks are called outside provider', () => {
      const { result: plotResult } = renderHook(() => usePlotDispatch());
      const { result: censusResult } = renderHook(() => useOrgCensusDispatch());
      const { result: quadratResult } = renderHook(() => useQuadratDispatch());
      const { result: siteResult } = renderHook(() => useSiteDispatch());

      expect(plotResult.current).toBeUndefined();
      expect(censusResult.current).toBeUndefined();
      expect(quadratResult.current).toBeUndefined();
      expect(siteResult.current).toBeUndefined();
    });
  });

  describe('Dispatch Actions', () => {
    it('should call plotDispatch without errors', () => {
      const { result } = renderHook(
        () => ({
          plot: usePlotContext(),
          dispatch: usePlotDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(() => {
        result.current.dispatch?.({ load: { plotID: 1, plotName: 'New Plot' } });
      }).not.toThrow();
    });

    it('should call orgCensusDispatch without errors', () => {
      const { result } = renderHook(
        () => ({
          orgCensus: useOrgCensusContext(),
          dispatch: useOrgCensusDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(() => {
        result.current.dispatch?.({
          load: {
            plotID: 1,
            plotCensusNumber: 1,
            censusIDs: [1],
            dateRanges: [{ censusID: 1, startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') }],
            description: 'Test Census'
          }
        });
      }).not.toThrow();
    });

    it('should call quadratDispatch without errors', () => {
      const { result } = renderHook(
        () => ({
          quadrat: useQuadratContext(),
          dispatch: useQuadratDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(() => {
        result.current.dispatch?.({ load: { quadratID: 1, quadratName: 'Q1' } });
      }).not.toThrow();
    });

    it('should call siteDispatch without errors', () => {
      const { result } = renderHook(
        () => ({
          site: useSiteContext(),
          dispatch: useSiteDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      expect(() => {
        result.current.dispatch?.({ load: { siteID: 1, siteName: 'Site 1' } });
      }).not.toThrow();
    });
  });

  describe('Nested Provider Structure', () => {
    it('should maintain proper provider nesting order', () => {
      // This test verifies that all contexts can be accessed simultaneously
      // The nesting order is: Site > Plot > OrgCensus > Quadrat
      const { result } = renderHook(
        () => ({
          site: useSiteContext(),
          plot: usePlotContext(),
          census: useOrgCensusContext(),
          quadrat: useQuadratContext(),
          siteDispatch: useSiteDispatch(),
          plotDispatch: usePlotDispatch(),
          censusDispatch: useOrgCensusDispatch(),
          quadratDispatch: useQuadratDispatch()
        }),
        {
          wrapper: UserSelectionProvider
        }
      );

      // Verify all contexts are accessible (undefined is expected initially)
      expect(result.current.site).toBeUndefined();
      expect(result.current.plot).toBeUndefined();
      expect(result.current.census).toBeUndefined();
      expect(result.current.quadrat).toBeUndefined();

      // Verify all dispatches are defined
      expect(result.current.siteDispatch).toBeDefined();
      expect(result.current.plotDispatch).toBeDefined();
      expect(result.current.censusDispatch).toBeDefined();
      expect(result.current.quadratDispatch).toBeDefined();
    });
  });
});
