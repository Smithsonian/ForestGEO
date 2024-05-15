"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRefreshFixedData } from "./refreshfixeddataprovider";
import { useCensusContext, usePlotContext, useSiteContext } from "./userselectionprovider";

export type DataValidity = {
  attributes: boolean;
  personnel: boolean;
  species: boolean;
  quadrats: boolean;
  subquadrats: boolean;
};

const initialDataValidity: DataValidity = {
  attributes: false,
  personnel: false,
  species: false,
  quadrats: false,
  subquadrats: false,
};

const DataValidityContext = createContext<{
  validity: DataValidity;
  setValidity: (type: keyof DataValidity, value: boolean) => void;
}>({
  validity: initialDataValidity,
  setValidity: () => {
  },
});

export const DataValidityProvider = ({ children }: { children: React.ReactNode }) => {
  const [validity, setValidityState] = useState<DataValidity>(initialDataValidity);
  const { refreshFixedDataFlags, setRefreshFixedDataFlag } = useRefreshFixedData();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();

  const setValidity = useCallback((type: keyof DataValidity, value: boolean) => {
    setValidityState(prev => ({ ...prev, [type]: value }));
  }, []);

  const checkDataValidity = useCallback(async (type?: keyof DataValidity) => {
    const checklist: (keyof DataValidity)[] = type ? [type] : ['attributes', 'personnel', 'species', 'quadrats', 'subquadrats'];
    for (let item of checklist) {
      if (!currentSite || !currentPlot || !currentCensus) break;
      else {
        let url = `/api/cmprevalidation/${item}/${currentSite?.schemaName}/${currentPlot?.id}/${currentCensus?.censusID}`;
        let response = await fetch(url, { method: 'GET' });
        setValidity(item, response.ok);
      }
    }
  }, [currentSite, currentPlot, currentCensus, setValidity]);

  // Initial load of data validity on component mount
  useEffect(() => {
    checkDataValidity().catch(console.error);
  }, [checkDataValidity]);

  // React to changes in refresh flags
  useEffect(() => {
    const recheckValidityIfNeeded = async () => {
      if (Object.values(refreshFixedDataFlags).some(flag => flag) && currentSite && currentPlot && currentCensus) {
        const typesToRefresh = Object.entries(refreshFixedDataFlags)
          .filter(([_, value]) => value)
          .map(([key]) => key as keyof DataValidity);

        await Promise.all(typesToRefresh.map(item => checkDataValidity(item)));
        typesToRefresh.forEach(key => setRefreshFixedDataFlag(key, false));
      }
    };
    recheckValidityIfNeeded().catch(console.error);
  }, [refreshFixedDataFlags, checkDataValidity, currentSite, currentPlot, currentCensus, setRefreshFixedDataFlag]);

  return (
    <DataValidityContext.Provider value={{ validity, setValidity }}>
      {children}
    </DataValidityContext.Provider>
  );
};

export const useDataValidity = () => useContext(DataValidityContext);
