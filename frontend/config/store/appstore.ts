/**
 * Unified Application Store using Zustand
 * Replaces multiple Context providers with a single, performant state management solution
 */

import { create } from 'zustand';
import { createJSONStorage, devtools, persist, PersistStorage, StorageValue } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { Plot, Quadrat, Site, PlotRDS, QuadratRDS, SitesRDS } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';
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

  // ===== Background Validation =====
  validationRunID: number | null;
  validationStatus: 'idle' | 'running' | 'completed' | 'failed';
  validationProgress: { completed: number; total: number; current: string | null };
  validationErrors: string[];

  // ===== UI State =====
  isPulsing: boolean;

  // ===== Hydration State =====
  hasHydrated: boolean;

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

  // ===== Background Validation Actions =====
  startValidationRun: (runID: number | null, totalSteps: number) => void;
  updateValidationProgress: (update: { completed?: number; total?: number; current?: string | null; errors?: string[] }) => void;
  completeValidationRun: (status: 'completed' | 'failed', errors?: string[]) => void;
  clearValidationRun: () => void;

  // ===== UI Actions =====
  setPulsing: (isPulsing: boolean) => void;
  triggerPulse: () => void;

  // ===== Reset Actions =====
  reset: () => void;
  clearSelections: () => void;

  // ===== Hydration Actions =====
  setHasHydrated: (state: boolean) => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialValidityState: UnifiedValidityFlags = {
  attributes: false,
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

  // Background Validation
  validationRunID: null,
  validationStatus: 'idle' as const,
  validationProgress: { completed: 0, total: 0, current: null },
  validationErrors: [] as string[],

  // UI State
  isPulsing: false,

  // Hydration State
  hasHydrated: false
};

// ============================================================================
// Persisted Selection Storage (guarded)
// ============================================================================

const SELECTION_STORAGE_KEY = 'forestgeo-storage';

const SELECTION_KEYS = ['currentSite', 'currentPlot', 'currentCensus', 'currentQuadrat'] as const;

type PersistedSelections = Partial<Pick<AppState, (typeof SELECTION_KEYS)[number]>>;

const hasAnySelection = (state: PersistedSelections | undefined): boolean => SELECTION_KEYS.some(key => state?.[key] !== undefined && state?.[key] !== null);

let explicitSelectionClear = false;

/**
 * Signals that the next empty-selection persist write is an intentional clear
 * (user deselection, error-boundary reset) and must be allowed through the
 * guarded storage below.
 */
export const markExplicitSelectionClear = () => {
  explicitSelectionClear = true;
};

const MAX_RETAINED_WIPE_TRACES = 5;

const traceBlockedSelectionWipe = () => {
  if (process.env.NODE_ENV !== 'production') {
    // Regression alarm: some writer tried to clobber a persisted selection
    // with an empty one without going through clearSelections()/reset().
    console.trace(`[${SELECTION_STORAGE_KEY}] BLOCKED: empty selection state attempted to overwrite a persisted selection`);
    const diagnosticWindow = window as typeof window & { __selectionWipeTraces?: string[] };
    diagnosticWindow.__selectionWipeTraces = [...(diagnosticWindow.__selectionWipeTraces ?? []), new Error().stack ?? 'no stack available'].slice(
      -MAX_RETAINED_WIPE_TRACES
    );
  }
};

/**
 * Wraps the default JSON localStorage so that an all-empty selection state can
 * never silently overwrite a persisted non-empty one. zustand's persist
 * middleware rewrites the whole partialized state on ANY set(), so a single
 * misbehaving writer (e.g. a UI control firing a spurious deselect during
 * boot) used to wipe the user's site/plot/census and bounce them to
 * /dashboard on every reload (bug F7).
 */
const createGuardedSelectionStorage = (): PersistStorage<PersistedSelections> | undefined => {
  const baseStorage = createJSONStorage<PersistedSelections>(() => localStorage);
  if (!baseStorage) return undefined;

  const readPersistedSelections = (name: string): PersistedSelections | undefined => {
    const raw = localStorage.getItem(name);
    if (!raw) return undefined;
    try {
      return (JSON.parse(raw) as StorageValue<PersistedSelections>).state;
    } catch (error) {
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  };

  return {
    getItem: name => baseStorage.getItem(name),
    setItem: (name, value) => {
      if (!hasAnySelection(value.state)) {
        if (!explicitSelectionClear && hasAnySelection(readPersistedSelections(name))) {
          traceBlockedSelectionWipe();
          return;
        }
        explicitSelectionClear = false;
      }
      baseStorage.setItem(name, value);
    },
    removeItem: name => baseStorage.removeItem(name)
  };
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

        // ===== Background Validation Actions =====
        startValidationRun: (runID, totalSteps) =>
          set(
            {
              validationRunID: runID,
              validationStatus: 'running',
              validationProgress: { completed: 0, total: totalSteps, current: null },
              validationErrors: []
            },
            false,
            'startValidationRun'
          ),

        updateValidationProgress: update =>
          set(
            state => ({
              validationProgress: {
                completed: update.completed ?? state.validationProgress.completed,
                total: update.total ?? state.validationProgress.total,
                current: update.current !== undefined ? update.current : state.validationProgress.current
              },
              validationErrors: update.errors ?? state.validationErrors
            }),
            false,
            'updateValidationProgress'
          ),

        completeValidationRun: (status, errors) =>
          set(
            state => ({
              validationStatus: status,
              validationProgress: { ...state.validationProgress, current: null },
              validationErrors: errors ?? state.validationErrors
            }),
            false,
            'completeValidationRun'
          ),

        clearValidationRun: () =>
          set(
            {
              validationRunID: null,
              validationStatus: 'idle',
              validationProgress: { completed: 0, total: 0, current: null },
              validationErrors: []
            },
            false,
            'clearValidationRun'
          ),

        // ===== UI Actions =====
        setPulsing: isPulsing => set({ isPulsing }, false, 'setPulsing'),

        triggerPulse: () => {
          set({ isPulsing: true }, false, 'triggerPulse');
          setTimeout(() => {
            set({ isPulsing: false }, false, 'endPulse');
          }, 1000);
        },

        // ===== Reset Actions =====
        reset: () => {
          markExplicitSelectionClear();
          set(initialState, false, 'reset');
        },

        clearSelections: () => {
          markExplicitSelectionClear();
          set(
            {
              currentSite: undefined,
              currentPlot: undefined,
              currentCensus: undefined,
              currentQuadrat: undefined
            },
            false,
            'clearSelections'
          );
        },

        // ===== Hydration Actions =====
        setHasHydrated: (state: boolean) => set({ hasHydrated: state }, false, 'setHasHydrated')
      }),
      {
        name: SELECTION_STORAGE_KEY, // localStorage key
        storage: createGuardedSelectionStorage(),
        partialize: state => ({
          // Only persist user selections
          currentSite: state.currentSite,
          currentPlot: state.currentPlot,
          currentCensus: state.currentCensus,
          currentQuadrat: state.currentQuadrat
        }),
        onRehydrateStorage: () => state => {
          // Called when the store has been hydrated from storage
          state?.setHasHydrated(true);
        }
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
  useAppStore(
    useShallow(state => ({
      isLoading: state.isLoading,
      loadingMessage: state.loadingMessage,
      setLoading: state.setLoading,
      startOperation: state.startOperation,
      endOperation: state.endOperation
    }))
  );

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
  useAppStore(
    useShallow(state => ({
      site: state.currentSite,
      plot: state.currentPlot,
      census: state.currentCensus,
      quadrat: state.currentQuadrat
    }))
  );

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
  useAppStore(
    useShallow(state => ({
      validity: state.validity,
      setValidity: state.setValidity,
      updateValidity: state.updateValidity,
      triggerValidityRefresh: state.triggerValidityRefresh
    }))
  );

/**
 * Hook to get UI state (pulsing animations, etc.)
 */
export const useUIState = () =>
  useAppStore(
    useShallow(state => ({
      isPulsing: state.isPulsing,
      setPulsing: state.setPulsing,
      triggerPulse: state.triggerPulse
    }))
  );

/**
 * Hook to check if the store has been hydrated from localStorage
 * Use this to prevent actions that depend on persisted state
 * until the store has finished hydrating
 */
export const useHasHydrated = () => useAppStore(state => state.hasHydrated);

/**
 * Hook to get background validation state
 */
export const useBackgroundValidationState = () =>
  useAppStore(
    useShallow(state => ({
      runID: state.validationRunID,
      status: state.validationStatus,
      progress: state.validationProgress,
      errors: state.validationErrors,
      startValidationRun: state.startValidationRun,
      updateValidationProgress: state.updateValidationProgress,
      completeValidationRun: state.completeValidationRun,
      clearValidationRun: state.clearValidationRun
    }))
  );
