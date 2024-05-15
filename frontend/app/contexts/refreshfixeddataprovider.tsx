"use client";
import React, {createContext, useContext, useState} from 'react';

export type RefreshFixedDataFlags = {
  attributes: boolean;
  personnel: boolean;
  species: boolean;
  quadrats: boolean;
  subquadrats: boolean;
};

const initialRefreshFlags: RefreshFixedDataFlags = {
  attributes: false,
  personnel: false,
  species: false,
  quadrats: false,
  subquadrats: false,
};

const RefreshFixedDataContext = createContext<{
  refreshFixedDataFlags: RefreshFixedDataFlags;
  setRefreshFixedDataFlag: (type: keyof RefreshFixedDataFlags, value: boolean) => void;
  triggerRefresh: (types?: (keyof RefreshFixedDataFlags)[]) => void;
}>({
  refreshFixedDataFlags: initialRefreshFlags,
  setRefreshFixedDataFlag: () => {
  },
  triggerRefresh: () => {
  },
});

export const RefreshFixedDataProvider = ({children}: { children: React.ReactNode }) => {
  const [refreshFixedDataFlags, setRefreshFixedDataFlags] = useState<RefreshFixedDataFlags>(initialRefreshFlags);

  const setRefreshFixedDataFlag = (type: keyof RefreshFixedDataFlags, value: boolean) => {
    setRefreshFixedDataFlags(prev => ({...prev, [type]: value}));
  };

  const triggerRefresh = (types?: (keyof RefreshFixedDataFlags)[]) => {
    if (types) {
      types.forEach(type => setRefreshFixedDataFlag(type, true));
    } else {
      Object.keys(initialRefreshFlags).forEach(key => setRefreshFixedDataFlag(key as keyof RefreshFixedDataFlags, true));
    }
  };

  return (
    <RefreshFixedDataContext.Provider value={{refreshFixedDataFlags, setRefreshFixedDataFlag, triggerRefresh}}>
      {children}
    </RefreshFixedDataContext.Provider>
  );
};

export const useRefreshFixedData = () => useContext(RefreshFixedDataContext);
