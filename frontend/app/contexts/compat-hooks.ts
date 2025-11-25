/**
 * Compatibility Hooks for Gradual Migration
 *
 * These hooks provide backward compatibility with the old Context API patterns
 * while using the new Zustand store under the hood. This allows for gradual
 * migration without breaking existing components.
 *
 * Usage:
 * - Existing components can continue using these hooks without changes
 * - New components should use the Zustand hooks directly from appstore.ts
 * - Once all components are migrated, these hooks can be removed
 */

import { useCallback } from 'react';
import { useAppStore } from '@/config/store/appstore';
import { Plot, Quadrat, Site, PlotRDS, QuadratRDS, SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { UnifiedValidityFlags } from '@/config/macros';
import { submitCookie } from '@/app/actions/cookiemanager';

// ============================================================================
// Loading Context Compatibility
// ============================================================================

interface LoadingOperation {
  id: string;
  message: string;
  startTime: number;
  category?: 'api' | 'upload' | 'processing' | 'general';
}

interface LoadingContextType {
  isLoading: boolean;
  loadingMessage: string;
  activeOperations: LoadingOperation[];
  setLoading: (isLoading: boolean, loadingMessage?: string, operationId?: string, category?: LoadingOperation['category']) => void;
  startOperation: (message: string, category?: LoadingOperation['category']) => string;
  endOperation: (operationId: string) => void;
  isOperationActive: (operationId: string) => boolean;
}

/**
 * Compatibility hook for useLoading()
 * Replaces: import { useLoading } from '@/app/contexts/loadingprovider'
 */
export function useLoading(): LoadingContextType {
  return useAppStore(state => ({
    isLoading: state.isLoading,
    loadingMessage: state.loadingMessage,
    activeOperations: state.activeOperations,
    setLoading: state.setLoading,
    startOperation: state.startOperation,
    endOperation: state.endOperation,
    isOperationActive: state.isOperationActive
  }));
}

// ============================================================================
// User Selection Context Compatibility
// ============================================================================

/**
 * Compatibility hook for useSiteContext()
 * Replaces: import { useSiteContext } from '@/app/contexts/userselectionprovider'
 */
export function useSiteContext(): Site | undefined {
  return useAppStore(state => state.currentSite);
}

/**
 * Compatibility hook for usePlotContext()
 * Replaces: import { usePlotContext } from '@/app/contexts/userselectionprovider'
 */
export function usePlotContext(): Plot | undefined {
  return useAppStore(state => state.currentPlot);
}

/**
 * Compatibility hook for useOrgCensusContext()
 * Replaces: import { useOrgCensusContext } from '@/app/contexts/userselectionprovider'
 */
export function useOrgCensusContext(): OrgCensus | undefined {
  return useAppStore(state => state.currentCensus);
}

/**
 * Compatibility hook for useQuadratContext()
 * Replaces: import { useQuadratContext } from '@/app/contexts/userselectionprovider'
 */
export function useQuadratContext(): Quadrat | undefined {
  return useAppStore(state => state.currentQuadrat);
}

// ============================================================================
// Dispatch Context Compatibility
// ============================================================================

/**
 * Enhanced dispatch type matching old API
 */
export interface EnhancedDispatch<T> {
  (action: { [key: string]: T }): Promise<void>;
}

/**
 * Compatibility hook for useSiteDispatch()
 * Replaces: import { useSiteDispatch } from '@/app/contexts/userselectionprovider'
 */
export function useSiteDispatch(): EnhancedDispatch<Site | undefined> | undefined {
  const setSite = useAppStore(state => state.setSite);

  return useCallback(
    async (action: { site?: Site }) => {
      await submitCookie('schema', action.site?.schemaName ?? '');
      setSite(action.site);
    },
    [setSite]
  );
}

/**
 * Compatibility hook for usePlotDispatch()
 * Replaces: import { usePlotDispatch } from '@/app/contexts/userselectionprovider'
 */
export function usePlotDispatch(): EnhancedDispatch<Plot | undefined> | undefined {
  const setPlot = useAppStore(state => state.setPlot);

  return useCallback(
    async (action: { plot?: Plot }) => {
      await submitCookie('plotID', action.plot?.plotID?.toString() ?? '');
      setPlot(action.plot);
    },
    [setPlot]
  );
}

/**
 * Compatibility hook for useOrgCensusDispatch()
 * Replaces: import { useOrgCensusDispatch } from '@/app/contexts/userselectionprovider'
 */
export function useOrgCensusDispatch(): EnhancedDispatch<OrgCensus | undefined> | undefined {
  const setCensus = useAppStore(state => state.setCensus);

  return useCallback(
    async (action: { census?: OrgCensus }) => {
      await submitCookie('censusID', action.census?.dateRanges?.[0]?.censusID?.toString() ?? '');
      setCensus(action.census);
    },
    [setCensus]
  );
}

/**
 * Compatibility hook for useQuadratDispatch()
 * Replaces: import { useQuadratDispatch } from '@/app/contexts/userselectionprovider'
 */
export function useQuadratDispatch(): EnhancedDispatch<Quadrat | undefined> | undefined {
  const setQuadrat = useAppStore(state => state.setQuadrat);

  return useCallback(
    async (action: { quadrat?: Quadrat }) => {
      await submitCookie('quadratID', action.quadrat?.quadratID?.toString() ?? '');
      setQuadrat(action.quadrat);
    },
    [setQuadrat]
  );
}

// ============================================================================
// List Selection Context Compatibility
// ============================================================================

/**
 * Compatibility hook for useSiteListContext()
 * Replaces: import { useSiteListContext } from '@/app/contexts/listselectionprovider'
 */
export function useSiteListContext(): SitesRDS[] | undefined {
  return useAppStore(state => state.siteList);
}

/**
 * Compatibility hook for usePlotListContext()
 * Replaces: import { usePlotListContext } from '@/app/contexts/listselectionprovider'
 */
export function usePlotListContext(): PlotRDS[] | undefined {
  return useAppStore(state => state.plotList);
}

/**
 * Compatibility hook for useOrgCensusListContext()
 * Replaces: import { useOrgCensusListContext } from '@/app/contexts/listselectionprovider'
 */
export function useOrgCensusListContext(): OrgCensus[] | undefined {
  return useAppStore(state => state.censusList);
}

/**
 * Compatibility hook for useQuadratListContext()
 * Replaces: import { useQuadratListContext } from '@/app/contexts/listselectionprovider'
 */
export function useQuadratListContext(): QuadratRDS[] | undefined {
  return useAppStore(state => state.quadratList);
}

/**
 * Compatibility hook for useFirstLoadContext()
 * Replaces: import { useFirstLoadContext } from '@/app/contexts/listselectionprovider'
 */
export function useFirstLoadContext(): boolean | undefined {
  return useAppStore(state => state.firstLoad);
}

// ============================================================================
// List Dispatch Context Compatibility
// ============================================================================

/**
 * Compatibility hook for useSiteListDispatch()
 */
export function useSiteListDispatch(): EnhancedDispatch<SitesRDS[] | undefined> | undefined {
  const setSiteList = useAppStore(state => state.setSiteList);

  return useCallback(
    async (action: { siteList?: SitesRDS[] }) => {
      setSiteList(action.siteList ?? []);
    },
    [setSiteList]
  );
}

/**
 * Compatibility hook for usePlotListDispatch()
 */
export function usePlotListDispatch(): EnhancedDispatch<PlotRDS[] | undefined> | undefined {
  const setPlotList = useAppStore(state => state.setPlotList);

  return useCallback(
    async (action: { plotList?: PlotRDS[] }) => {
      setPlotList(action.plotList ?? []);
    },
    [setPlotList]
  );
}

/**
 * Compatibility hook for useOrgCensusListDispatch()
 */
export function useOrgCensusListDispatch(): EnhancedDispatch<OrgCensus[] | undefined> | undefined {
  const setCensusList = useAppStore(state => state.setCensusList);

  return useCallback(
    async (action: { censusList?: OrgCensus[] }) => {
      setCensusList(action.censusList ?? []);
    },
    [setCensusList]
  );
}

/**
 * Compatibility hook for useQuadratListDispatch()
 */
export function useQuadratListDispatch(): EnhancedDispatch<QuadratRDS[] | undefined> | undefined {
  const setQuadratList = useAppStore(state => state.setQuadratList);

  return useCallback(
    async (action: { quadratList?: QuadratRDS[] }) => {
      setQuadratList(action.quadratList ?? []);
    },
    [setQuadratList]
  );
}

/**
 * Compatibility hook for useFirstLoadDispatch()
 */
export function useFirstLoadDispatch(): ((action: { firstLoad: boolean }) => void) | undefined {
  const setFirstLoad = useAppStore(state => state.setFirstLoad);

  return useCallback(
    (action: { firstLoad: boolean }) => {
      setFirstLoad(action.firstLoad);
    },
    [setFirstLoad]
  );
}

// ============================================================================
// Data Validity Context Compatibility
// ============================================================================

interface DataValidityContextType {
  validity: UnifiedValidityFlags;
  setValidity: (type: keyof UnifiedValidityFlags, value: boolean) => void;
  triggerRefresh: (types?: (keyof UnifiedValidityFlags)[]) => void;
  recheckValidityIfNeeded: () => Promise<void>;
}

/**
 * Compatibility hook for useDataValidityContext()
 * Replaces: import { useDataValidityContext } from '@/app/contexts/datavalidityprovider'
 *
 * Note: recheckValidityIfNeeded still needs to be implemented with API logic
 */
export function useDataValidityContext(): DataValidityContextType {
  const validity = useAppStore(state => state.validity);
  const setValidity = useAppStore(state => state.setValidity);
  const triggerValidityRefresh = useAppStore(state => state.triggerValidityRefresh);

  // Placeholder for recheckValidityIfNeeded - implement API logic as needed
  const recheckValidityIfNeeded = async () => {
    // This would need to call the validation API
    // For now, just trigger a refresh
    triggerValidityRefresh();
  };

  return {
    validity,
    setValidity,
    triggerRefresh: triggerValidityRefresh,
    recheckValidityIfNeeded
  };
}

// ============================================================================
// Lock Animation Context Compatibility
// ============================================================================

interface LockAnimationContextType {
  isPulsing: boolean;
  triggerPulse: () => void;
}

/**
 * Compatibility hook for useLockAnimation()
 * Replaces: import { useLockAnimation } from '@/app/contexts/lockanimationcontext'
 */
export function useLockAnimation(): LockAnimationContextType {
  return useAppStore(state => ({
    isPulsing: state.isPulsing,
    triggerPulse: state.triggerPulse
  }));
}

// ============================================================================
// Migration Guide
// ============================================================================

/**
 * MIGRATION GUIDE:
 *
 * 1. Update imports in existing components:
 *
 *    BEFORE:
 *    import { useSiteContext } from '@/app/contexts/userselectionprovider';
 *    import { useLoading } from '@/app/contexts/loadingprovider';
 *
 *    AFTER:
 *    import { useSiteContext, useLoading } from '@/app/contexts/compat-hooks';
 *
 * 2. Component code remains the same:
 *    const currentSite = useSiteContext();
 *    const { setLoading } = useLoading();
 *
 * 3. For new components, use Zustand directly:
 *    import { useCurrentSite, useLoadingState } from '@/config/store/appstore';
 *    const currentSite = useCurrentSite();
 *    const { setLoading } = useLoadingState();
 *
 * 4. Once all components migrated, remove this file and old context providers
 */
