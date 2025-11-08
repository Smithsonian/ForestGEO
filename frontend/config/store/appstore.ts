/**
 * Unified Application Store using Zustand
 * Replaces multiple Context providers with a single, performant state management solution
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { Plot, Quadrat, Site, PlotRDS, QuadratRDS, SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { UnifiedValidityFlags } from '@/config/macros';

// ============================================================================
// Types
// ============================================================================

interface LoadingOperation {
  id: string;
  message: string;
  startTime: number;
  category?: 'api' | 'upload' | 'processing' | 'general';
}

interface AppState {
  // ===== Loading State =====
  isLoading: boolean;
  loadingMessage: string;
  activeOperations: LoadingOperation[];

  // ===== User Selections =====
  currentSite: Site | undefined;
  currentPlot: Plot | undefined;
  currentCensus: OrgCensus | undefined;
  currentQuadrat: Quadrat | undefined;

  // ===== Lists =====
  siteList: SitesRDS[];
  plotList: PlotRDS[];
  censusList: OrgCensus[];
  quadratList: QuadratRDS[];
  firstLoad: boolean;

  // ===== Data Validity =====
  validity: UnifiedValidityFlags;

  // ===== UI State =====
  isPulsing: boolean;

  // ===== Loading Actions =====
  startOperation: (message: string, category?: LoadingOperation['category']) => string;
  endOperation: (operationId: string) => void;
  isOperationActive: (operationId: string) => boolean;
  setLoading: (isLoading: boolean, message?: string, operationId?: string, category?: LoadingOperation['category']) => void;

  // ===== Selection Actions =====
  setSite: (site: Site | undefined) => void;
  setPlot: (plot: Plot | undefined) => void;
  setCensus: (census: OrgCensus | undefined) => void;
  setQuadrat: (quadrat: Quadrat | undefined) => void;

  // ===== List Actions =====
  setSiteList: (sites: SitesRDS[]) => void;
  setPlotList: (plots: PlotRDS[]) => void;
  setCensusList: (censuses: OrgCensus[]) => void;
  setQuadratList: (quadrats: QuadratRDS[]) => void;
  setFirstLoad: (firstLoad: boolean) => void;

  // ===== Validity Actions =====
  setValidity: (type: keyof UnifiedValidityFlags, value: boolean) => void;
  setAllValidity: (validity: UnifiedValidityFlags) => void;
  updateValidity: (flags: Partial<UnifiedValidityFlags>) => void;
  triggerValidityRefresh: (types?: (keyof UnifiedValidityFlags)[]) => void;

  // ===== UI Actions =====
  setPulsing: (isPulsing: boolean) => void;
  triggerPulse: () => void;

  // ===== Reset Actions =====
  reset: () => void;
  clearSelections: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialValidityState: UnifiedValidityFlags = {
  attributes: false,
  personnel: false,
  species: false,
  quadrats: false
};

const initialState = {
  // Loading
  isLoading: false,
  loadingMessage: '',
  activeOperations: [] as LoadingOperation[],

  // User Selections
  currentSite: undefined,
  currentPlot: undefined,
  currentCensus: undefined,
  currentQuadrat: undefined,

  // Lists
  siteList: [] as SitesRDS[],
  plotList: [] as PlotRDS[],
  censusList: [] as OrgCensus[],
  quadratList: [] as QuadratRDS[],
  firstLoad: true,

  // Data Validity
  validity: initialValidityState,

  // UI State
  isPulsing: false
};

// ============================================================================
// Store Creation
// ============================================================================

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ===== Loading Actions =====
        startOperation: (message, category = 'general') => {
          const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const operation: LoadingOperation = {
            id: operationId,
            message,
            startTime: Date.now(),
            category
          };

          set(
            state => ({
              activeOperations: [...state.activeOperations, operation],
              isLoading: true,
              loadingMessage: message
            }),
            false,
            'startOperation'
          );

          // Auto-timeout for operations
          const timeoutDuration = category === 'upload' ? 5 * 60 * 1000 : 30 * 1000;
          setTimeout(() => {
            const state = get();
            if (state.isOperationActive(operationId)) {
              console.warn(`Operation ${operationId} timed out after ${timeoutDuration}ms`);
              state.endOperation(operationId);
            }
          }, timeoutDuration);

          return operationId;
        },

        endOperation: operationId =>
          set(
            state => {
              const activeOperations = state.activeOperations.filter(op => op.id !== operationId);
              const isLoading = activeOperations.length > 0;
              const loadingMessage = isLoading ? activeOperations[activeOperations.length - 1].message : '';

              return {
                activeOperations,
                isLoading,
                loadingMessage
              };
            },
            false,
            'endOperation'
          ),

        isOperationActive: operationId => {
          return get().activeOperations.some(op => op.id === operationId);
        },

        setLoading: (isLoading, message = '', operationId, category) => {
          const state = get();

          if (isLoading && message) {
            if (!operationId) {
              // Start new operation
              state.startOperation(message, category);
            }
          } else if (!isLoading) {
            if (operationId) {
              state.endOperation(operationId);
            } else if (message) {
              // Find operation by message and end it
              const operation = state.activeOperations.find(op => op.message === message);
              if (operation) {
                state.endOperation(operation.id);
              }
            } else {
              // End the most recent operation
              const lastOperation = state.activeOperations[state.activeOperations.length - 1];
              if (lastOperation) {
                state.endOperation(lastOperation.id);
              }
            }
          }
        },

        // ===== Selection Actions =====
        setSite: site => set({ currentSite: site }, false, 'setSite'),

        setPlot: plot => set({ currentPlot: plot }, false, 'setPlot'),

        setCensus: census => set({ currentCensus: census }, false, 'setCensus'),

        setQuadrat: quadrat => set({ currentQuadrat: quadrat }, false, 'setQuadrat'),

        // ===== List Actions =====
        setSiteList: sites => set({ siteList: sites }, false, 'setSiteList'),

        setPlotList: plots => set({ plotList: plots }, false, 'setPlotList'),

        setCensusList: censuses => set({ censusList: censuses }, false, 'setCensusList'),

        setQuadratList: quadrats => set({ quadratList: quadrats }, false, 'setQuadratList'),

        setFirstLoad: firstLoad => set({ firstLoad }, false, 'setFirstLoad'),

        // ===== Validity Actions =====
        setValidity: (type, value) =>
          set(
            state => ({
              validity: { ...state.validity, [type]: value }
            }),
            false,
            'setValidity'
          ),

        setAllValidity: validity => set({ validity }, false, 'setAllValidity'),

        updateValidity: flags =>
          set(
            state => ({
              validity: { ...state.validity, ...flags }
            }),
            false,
            'updateValidity'
          ),

        triggerValidityRefresh: types => {
          const state = get();
          if (types) {
            types.forEach(type => state.setValidity(type, false));
          } else {
            state.setAllValidity(initialValidityState);
          }
        },

        // ===== UI Actions =====
        setPulsing: isPulsing => set({ isPulsing }, false, 'setPulsing'),

        triggerPulse: () => {
          set({ isPulsing: true }, false, 'triggerPulse');
          setTimeout(() => {
            set({ isPulsing: false }, false, 'endPulse');
          }, 1000);
        },

        // ===== Reset Actions =====
        reset: () => set(initialState, false, 'reset'),

        clearSelections: () =>
          set(
            {
              currentSite: undefined,
              currentPlot: undefined,
              currentCensus: undefined,
              currentQuadrat: undefined
            },
            false,
            'clearSelections'
          )
      }),
      {
        name: 'forestgeo-storage', // localStorage key
        partialize: state => ({
          // Only persist user selections
          currentSite: state.currentSite,
          currentPlot: state.currentPlot,
          currentCensus: state.currentCensus,
          currentQuadrat: state.currentQuadrat
        })
      }
    ),
    { name: 'ForestGEO App Store' }
  )
);

// ============================================================================
// Selector Hooks (for optimized re-renders)
// ============================================================================

/**
 * Hook to get only loading state (prevents unnecessary re-renders)
 */
export const useLoadingState = () =>
  useAppStore(state => ({
    isLoading: state.isLoading,
    loadingMessage: state.loadingMessage,
    setLoading: state.setLoading,
    startOperation: state.startOperation,
    endOperation: state.endOperation
  }));

/**
 * Hook to get current site (only re-renders when site changes)
 */
export const useCurrentSite = () => useAppStore(state => state.currentSite);

/**
 * Hook to get current plot (only re-renders when plot changes)
 */
export const useCurrentPlot = () => useAppStore(state => state.currentPlot);

/**
 * Hook to get current census (only re-renders when census changes)
 */
export const useCurrentCensus = () => useAppStore(state => state.currentCensus);

/**
 * Hook to get current quadrat (only re-renders when quadrat changes)
 */
export const useCurrentQuadrat = () => useAppStore(state => state.currentQuadrat);

/**
 * Hook to get all current selections at once
 */
export const useCurrentSelections = () =>
  useAppStore(state => ({
    site: state.currentSite,
    plot: state.currentPlot,
    census: state.currentCensus,
    quadrat: state.currentQuadrat
  }));

/**
 * Hook to get site list
 */
export const useSiteList = () => useAppStore(state => state.siteList);

/**
 * Hook to get plot list
 */
export const usePlotList = () => useAppStore(state => state.plotList);

/**
 * Hook to get census list
 */
export const useCensusList = () => useAppStore(state => state.censusList);

/**
 * Hook to get quadrat list
 */
export const useQuadratList = () => useAppStore(state => state.quadratList);

/**
 * Hook to get validity flags
 */
export const useValidity = () =>
  useAppStore(state => ({
    validity: state.validity,
    setValidity: state.setValidity,
    updateValidity: state.updateValidity,
    triggerValidityRefresh: state.triggerValidityRefresh
  }));

/**
 * Hook to get UI state (pulsing animations, etc.)
 */
export const useUIState = () =>
  useAppStore(state => ({
    isPulsing: state.isPulsing,
    setPulsing: state.setPulsing,
    triggerPulse: state.triggerPulse
  }));
