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
  const [refreshNeeded, setRefreshNeeded] = useState<boolean>(false);

  const ApiWrapper = useApiWrapper();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  // Use ref to track debounce timeout to avoid recreating debounced function
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const setValidity = useCallback((type: keyof UnifiedValidityFlags, value: boolean) => {
    setValidityState(prev => ({ ...prev, [type]: value }));
  }, []);

  const checkDataValidity = useCallback(
    async (types: (keyof UnifiedValidityFlags)[]) => {
      if (!currentSite || !currentPlot || !currentCensus) return;

      try {
        const results = await Promise.all(
          types.map(async type => {
            const url = `/api/cmprevalidation/${type}/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.plotCensusNumber}`;
            try {
              const response = await ApiWrapper.get(url, {
                loadingMessage: `Validating ${type}...`,
                category: 'api',
                showErrorAlert: false, // Don't show alert for 412 - we handle it gracefully
                acceptedStatuses: [412] // 412 means no data exists, which is a valid state for validation
              });
              // 200 = data exists, 412 = no data exists (both are valid states)
              // For validation purposes, having no failed measurements (412) is actually good
              const isValid = response.status === 200 || response.status === 412;
              return { type, isValid };
            } catch (error: any) {
              ailogger.error(error);
              return { type, isValid: false };
            }
          })
        );

        results.forEach(({ type, isValid }) => {
          setValidity(type, isValid);
        });
      } catch (error: any) {
        ailogger.error(error);
      }
    },
    [currentSite, currentPlot, currentCensus, setValidity, ApiWrapper]
  );

  // Stable function that doesn't depend on validity state directly
  const recheckValidityIfNeeded = useCallback(async () => {
    // Use functional state update to get current validity without depending on it
    setValidityState(currentValidity => {
      const hasInvalidFlags = Object.values(currentValidity).some(flag => !flag);

      if (hasInvalidFlags || refreshNeeded) {
        const typesToRefresh = Object.entries(currentValidity)
          .filter(([_, value]) => !value)
          .map(([key]) => key as keyof UnifiedValidityFlags);

        // Execute async validation in microtask to avoid state update during render
        Promise.resolve().then(() => {
          checkDataValidity(typesToRefresh);
          setRefreshNeeded(false);
        });
      }

      return currentValidity; // Return unchanged state
    });
  }, [checkDataValidity, refreshNeeded]);

  // Stable triggerRefresh that uses functional updates
  const triggerRefresh = useCallback((types?: (keyof UnifiedValidityFlags)[]) => {
    setValidityState(prev => {
      if (types) {
        const updates = types.reduce((acc, type) => ({ ...acc, [type]: false }), {});
        return { ...prev, ...updates };
      } else {
        return Object.keys(prev).reduce((acc, key) => ({ ...acc, [key]: false }), {} as UnifiedValidityFlags);
      }
    });
    setRefreshNeeded(true);
  }, []);

  // Effect with stable debouncing using ref
  useEffect(() => {
    if (refreshNeeded) {
      // Clear existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Set new timeout
      debounceTimeoutRef.current = setTimeout(() => {
        recheckValidityIfNeeded();
      }, 300);
    }

    // Cleanup on unmount
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [refreshNeeded, recheckValidityIfNeeded]);

  // Stable initial trigger - only runs once per site/plot/census change
  const initialTriggerRef = useRef<string>('');
  useEffect(() => {
    if (currentSite && currentPlot && currentCensus) {
      const key = `${currentSite.schemaName}-${currentPlot.plotID}-${currentCensus.plotCensusNumber}`;
      if (initialTriggerRef.current !== key) {
        initialTriggerRef.current = key;
        triggerRefresh();
      }
    }
  }, [currentSite, currentPlot, currentCensus, triggerRefresh]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(
    () => ({ validity, setValidity, triggerRefresh, recheckValidityIfNeeded }),
    [validity, setValidity, triggerRefresh, recheckValidityIfNeeded]
  );

  return <DataValidityContext.Provider value={contextValue}>{children}</DataValidityContext.Provider>;
};

export const useDataValidityContext = () => useContext(DataValidityContext);
