"use client";
import React, {createContext, useCallback, useContext, useEffect, useState} from "react";
import {useOrgCensusContext, usePlotContext, useSiteContext} from "./userselectionprovider";
import {UnifiedValidityFlags} from "@/config/macros";
import {useLoading} from "./loadingprovider";

const initialValidityState: UnifiedValidityFlags = {
  attributes: false,
  personnel: false,
  species: false,
  quadrats: false,
  subquadrats: false,
  quadratpersonnel: false,
};

const DataValidityContext = createContext<{
  validity: UnifiedValidityFlags;
  setValidity: (type: keyof UnifiedValidityFlags, value: boolean) => void;
  triggerRefresh: (types?: (keyof UnifiedValidityFlags)[]) => void;
  recheckValidityIfNeeded: () => Promise<void>;
}>({
  validity: initialValidityState,
  setValidity: () => {
  },
  triggerRefresh: () => {
  },
  recheckValidityIfNeeded: async () => {
  },
});

const debounce = (func: (...args: any[]) => void, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const DataValidityProvider = ({children}: { children: React.ReactNode }) => {
  const [validity, setValidityState] = useState<UnifiedValidityFlags>(initialValidityState);
  const [refreshNeeded, setRefreshNeeded] = useState<boolean>(false);

  const {setLoading} = useLoading();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const setValidity = useCallback((type: keyof UnifiedValidityFlags, value: boolean) => {
    setValidityState(prev => ({...prev, [type]: value}));
  }, []);

  const checkDataValidity = useCallback(async (type?: keyof UnifiedValidityFlags) => {
    if (!currentSite || !currentPlot || !currentCensus) return;
    setLoading(true, 'Pre-validation in progress...');
    const url = `/api/cmprevalidation/${type}/${currentSite.schemaName}/${currentPlot.id}/${currentCensus.plotCensusNumber}`;
    let response;
    try {
      response = await fetch(url, {method: 'GET'});
    } catch (error) {
      console.error(error);
      response = {ok: false};
    }
    setValidity(type as keyof UnifiedValidityFlags, response.ok);
    setLoading(false);
  }, [currentSite, currentPlot, currentCensus, setValidity]);

  const recheckValidityIfNeeded = useCallback(async () => {
    if ((Object.values(validity).some(flag => !flag)) || refreshNeeded) {
      const typesToRefresh = Object.entries(validity)
        .filter(([_, value]) => !value)
        .map(([key]) => key as keyof UnifiedValidityFlags);

      await Promise.all(typesToRefresh.map(item => checkDataValidity(item)));
      setRefreshNeeded(false); // Reset the refresh flag after rechecking
    } else {
      console.log('No flags set for rechecking, or missing site/plot/census data');
    }
  }, [validity, checkDataValidity, refreshNeeded]);

  const debouncedRecheckValidityIfNeeded = useCallback(debounce(recheckValidityIfNeeded, 300), [recheckValidityIfNeeded]);

  useEffect(() => {
    if (refreshNeeded) {
      debouncedRecheckValidityIfNeeded();
    }
  }, [refreshNeeded, debouncedRecheckValidityIfNeeded]);

  useEffect(() => {
    if (currentSite && currentPlot && currentCensus) {
      triggerRefresh(); // Trigger initial refresh when user logs in
    }
  }, [currentSite, currentPlot, currentCensus]);

  const triggerRefresh = useCallback((types?: (keyof UnifiedValidityFlags)[]) => {
    if (types) {
      types.forEach(type => setValidity(type, false));
    } else {
      Object.keys(validity).forEach(key => setValidity(key as keyof UnifiedValidityFlags, false));
    }
    setRefreshNeeded(true); // Trigger a refresh
  }, [setValidity]);

  return (
    <DataValidityContext.Provider value={{validity, setValidity, triggerRefresh, recheckValidityIfNeeded}}>
      {children}
    </DataValidityContext.Provider>
  );
};

export const useDataValidityContext = () => useContext(DataValidityContext);
