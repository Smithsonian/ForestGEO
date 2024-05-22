"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useCensusContext, usePlotContext, useSiteContext } from "./userselectionprovider";
import { UnifiedValidityFlags } from "@/config/macros";

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
  setValidity: () => { },
  triggerRefresh: () => { },
  recheckValidityIfNeeded: async () => { },
});
 
export const DataValidityProvider = ({ children }: { children: React.ReactNode }) => {
  const [validity, setValidityState] = useState<UnifiedValidityFlags>(initialValidityState);
  const [refreshNeeded, setRefreshNeeded] = useState<boolean>(false);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();

  const setValidity = useCallback((type: keyof UnifiedValidityFlags, value: boolean) => {
    setValidityState(prev => ({ ...prev, [type]: value }));
  }, []);

  const checkDataValidity = useCallback(async (type?: keyof UnifiedValidityFlags) => {
    if (!currentSite || !currentPlot || !currentCensus) return;
    let url = `/api/cmprevalidation/${type}/${currentSite.schemaName}/${currentPlot.id}/${currentCensus.censusID}`;
    let response = await fetch(url, { method: 'GET' });
    setValidity(type as keyof UnifiedValidityFlags, response.ok);
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

  useEffect(() => {
    if (refreshNeeded) {
      recheckValidityIfNeeded().catch(console.error);
    }
  }, [refreshNeeded, recheckValidityIfNeeded]);

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
    <DataValidityContext.Provider value={{ validity, setValidity, triggerRefresh, recheckValidityIfNeeded }}>
      {children}
    </DataValidityContext.Provider>
  );
};

export const useDataValidityContext = () => useContext(DataValidityContext);
