'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UnifiedValidityFlags } from '@/config/macros';

import { useOrgCensusContext, usePlotContext, useSiteContext } from './compat-hooks';
import { useApiWrapper } from '@/utils/apiWrapper';
import ailogger from '@/ailogger';

const initialValidityState: UnifiedValidityFlags = {
  attributes: false,
  personnel: false,
  species: false,
  quadrats: false
};

const ALL_VALIDITY_TYPES: (keyof UnifiedValidityFlags)[] = ['attributes', 'species', 'quadrats', 'personnel'];

const DataValidityContext = createContext<{
  validity: UnifiedValidityFlags;
  setValidity: (type: keyof UnifiedValidityFlags, value: boolean) => void;
  triggerRefresh: (types?: (keyof UnifiedValidityFlags)[]) => void;
  recheckValidityIfNeeded: () => Promise<void>;
}>({
  validity: initialValidityState,
  setValidity: () => {},
  triggerRefresh: () => {},
  recheckValidityIfNeeded: async () => {}
});

export const DataValidityProvider = ({ children }: { children: React.ReactNode }) => {
  const [validity, setValidityState] = useState<UnifiedValidityFlags>(initialValidityState);

  const ApiWrapper = useApiWrapper();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  // Extract primitive values for stable effect dependencies
  const schemaName = currentSite?.schemaName;
  const plotID = currentPlot?.plotID;
  const plotCensusNumber = currentCensus?.plotCensusNumber;

  // Counter to force re-checks from external triggers (triggerRefresh / recheckValidityIfNeeded)
  const [refreshCounter, setRefreshCounter] = useState(0);

  const setValidity = useCallback((type: keyof UnifiedValidityFlags, value: boolean) => {
    setValidityState(prev => ({ ...prev, [type]: value }));
  }, []);

  // Keep validation logic in a ref so the effect always calls the latest version
  // without needing it as a dependency (prevents effect re-runs from callback recreation)
  const runValidationRef = useRef<(types: (keyof UnifiedValidityFlags)[], signal?: AbortSignal) => Promise<void>>();
  runValidationRef.current = async (types, signal) => {
    if (!schemaName || !plotID || plotCensusNumber == null) return;

    try {
      const results = await Promise.all(
        types.map(async type => {
          if (signal?.aborted) return { type, isValid: false };

          const url = `/api/cmprevalidation/${type}/${schemaName}/${plotID}/${plotCensusNumber}`;
          try {
            const response = await ApiWrapper.get(url, {
              loadingMessage: `Validating ${type}...`,
              category: 'api',
              showErrorAlert: false,
              acceptedStatuses: [412]
            });
            // 200 = data exists, 412 = no data exists (both are valid states)
            const isValid = response.status === 200 || response.status === 412;
            return { type, isValid };
          } catch (error: any) {
            ailogger.error(error);
            return { type, isValid: false };
          }
        })
      );

      if (!signal?.aborted) {
        results.forEach(({ type, isValid }) => {
          setValidity(type, isValid);
        });
      }
    } catch (error: any) {
      ailogger.error(error);
    }
  };

  // Primary effect: run validation when context primitives change or refresh is requested.
  // Uses only primitive deps + counter so it cannot be starved by unstable object references.
  useEffect(() => {
    if (!schemaName || !plotID || plotCensusNumber == null) return;

    // Reset validity before re-checking
    setValidityState(initialValidityState);

    const abortController = new AbortController();
    const timer = setTimeout(() => {
      runValidationRef.current?.(ALL_VALIDITY_TYPES, abortController.signal);
    }, 300);

    return () => {
      abortController.abort();
      clearTimeout(timer);
    };
  }, [schemaName, plotID, plotCensusNumber, refreshCounter]);

  // Safety net: if all flags are still false 5s after contexts are available, retry once.
  // Catches edge cases where the initial check silently failed (HMR, network blip, etc.)
  useEffect(() => {
    if (!schemaName || !plotID || plotCensusNumber == null) return;

    const safetyTimer = setTimeout(() => {
      setValidityState(current => {
        const allFalse = Object.values(current).every(v => !v);
        if (allFalse) {
          setRefreshCounter(c => c + 1);
        }
        return current;
      });
    }, 5000);

    return () => clearTimeout(safetyTimer);
  }, [schemaName, plotID, plotCensusNumber]);

  // External trigger for consumers (sidebar upload-complete, etc.)
  const triggerRefresh = useCallback((types?: (keyof UnifiedValidityFlags)[]) => {
    if (types) {
      setValidityState(prev => {
        const updates = types.reduce((acc, type) => ({ ...acc, [type]: false }), {});
        return { ...prev, ...updates };
      });
    } else {
      setValidityState(initialValidityState);
    }
    setRefreshCounter(c => c + 1);
  }, []);

  const recheckValidityIfNeeded = useCallback(async () => {
    setRefreshCounter(c => c + 1);
  }, []);

  const contextValue = useMemo(
    () => ({ validity, setValidity, triggerRefresh, recheckValidityIfNeeded }),
    [validity, setValidity, triggerRefresh, recheckValidityIfNeeded]
  );

  return <DataValidityContext.Provider value={contextValue}>{children}</DataValidityContext.Provider>;
};

export const useDataValidityContext = () => useContext(DataValidityContext);
