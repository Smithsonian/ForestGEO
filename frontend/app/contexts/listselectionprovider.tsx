// ListSelectionProvider.tsx
"use client";
import React, { createContext, Dispatch, useContext, useEffect, useReducer } from 'react';
import {
  createEnhancedDispatch,
  EnhancedDispatch,
  genericLoadReducer,
  LoadAction
} from "@/config/macros/contextreducers";
import { Quadrat } from "@/config/sqlrdsdefinitions/tables/quadratrds";
import { Plot } from "@/config/sqlrdsdefinitions/tables/plotrds";
import { Subquadrat } from '@/config/sqlrdsdefinitions/tables/subquadratrds';
import { getData } from "@/config/db";
import { SitesRDS } from '@/config/sqlrdsdefinitions/tables/sitesrds';
import { CensusRDS } from '@/config/sqlrdsdefinitions/tables/censusrds';

export const CensusListContext = createContext<CensusRDS[] | undefined>(undefined);
export const QuadratListContext = createContext<Quadrat[] | undefined>(undefined);
export const SubquadratListContext = createContext<Subquadrat[] | undefined>(undefined);
export const FirstLoadContext = createContext<boolean | undefined>(undefined);
export const SiteListContext = createContext<SitesRDS[] | undefined>(undefined);
export const CensusListDispatchContext = createContext<EnhancedDispatch<CensusRDS[]> | undefined>(undefined);
export const QuadratListDispatchContext = createContext<EnhancedDispatch<Quadrat[]> | undefined>(undefined);
export const SubquadratListDispatchContext = createContext<EnhancedDispatch<Subquadrat[]> | undefined>(undefined);
export const SiteListDispatchContext = createContext<EnhancedDispatch<SitesRDS[]> | undefined>(undefined);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | undefined>(undefined);

export function ListSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [censusList, censusListDispatch] =
    useReducer<React.Reducer<CensusRDS[] | undefined, LoadAction<CensusRDS[]>>>(genericLoadReducer, []);

  const [quadratList, quadratListDispatch] =
    useReducer<React.Reducer<Quadrat[] | undefined, LoadAction<Quadrat[]>>>(genericLoadReducer, []);

  const [subquadratList, subquadratListDispatch] =
    useReducer<React.Reducer<Subquadrat[] | undefined, LoadAction<Subquadrat[]>>>(genericLoadReducer, []);

  const [siteList, siteListDispatch] =
    useReducer<React.Reducer<SitesRDS[] | undefined, LoadAction<SitesRDS[]>>>(genericLoadReducer, []);

  const [firstLoad, firstLoadDispatch] = useReducer(
    firstLoadReducer,
    true
  );

  const enhancedCensusListDispatch = createEnhancedDispatch(censusListDispatch, 'censusList');
  const enhancedQuadratListDispatch = createEnhancedDispatch(quadratListDispatch, 'quadratList');
  const enhancedSubquadratListDispatch = createEnhancedDispatch(subquadratListDispatch, 'subquadratList');
  const enhancedSiteListDispatch = createEnhancedDispatch(siteListDispatch, 'siteList');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const quadratListData: Quadrat[] | undefined = await getData('quadratList');
        if (quadratListData) await enhancedQuadratListDispatch({ quadratList: quadratListData });

        const subquadratListData: Subquadrat[] | undefined = await getData('subquadratList');
        if (subquadratListData) await enhancedSubquadratListDispatch({ subquadratList: subquadratListData });

        const censusListData: CensusRDS[] | undefined = await getData('censusList');
        if (censusListData) await enhancedCensusListDispatch({ censusList: censusListData });

        const siteListData: SitesRDS[] | undefined = await getData('siteList');
        if (siteListData) await enhancedSiteListDispatch({ siteList: siteListData });
      } catch (err) {
        console.error('Failed to fetch data', err);
      }
    };

    fetchData();
  }, []);

  return (
    <SiteListContext.Provider value={siteList}>
      <SiteListDispatchContext.Provider value={enhancedSiteListDispatch}>
        <QuadratListContext.Provider value={quadratList}>
          <QuadratListDispatchContext.Provider value={enhancedQuadratListDispatch}>
            <SubquadratListContext.Provider value={subquadratList}>
              <SubquadratListDispatchContext.Provider value={enhancedSubquadratListDispatch}>
                <CensusListContext.Provider value={censusList}>
                  <CensusListDispatchContext.Provider value={enhancedCensusListDispatch}>
                    <FirstLoadContext.Provider value={firstLoad}>
                      <FirstLoadDispatchContext.Provider value={firstLoadDispatch}>
                        {children}
                      </FirstLoadDispatchContext.Provider>
                    </FirstLoadContext.Provider>
                  </CensusListDispatchContext.Provider>
                </CensusListContext.Provider>
              </SubquadratListDispatchContext.Provider>
            </SubquadratListContext.Provider>
          </QuadratListDispatchContext.Provider>
        </QuadratListContext.Provider>
      </SiteListDispatchContext.Provider>
    </SiteListContext.Provider>
  );
}

function firstLoadReducer(currentState: any, action: { firstLoad: boolean | null }) {
  if (!action.firstLoad && currentState) return action.firstLoad;
  else return currentState;
}

export function useFirstLoadContext() {
  return useContext(FirstLoadContext);
}

export function useFirstLoadDispatch() {
  return useContext(FirstLoadDispatchContext);
}

export function useQuadratListContext() {
  return useContext(QuadratListContext);
}

export function useQuadratListDispatch() {
  return useContext(QuadratListDispatchContext);
}

export function useSubquadratListContext() {
  return useContext(SubquadratListContext);
}

export function useSubquadratListDispatch() {
  return useContext(SubquadratListDispatchContext);
}

export function useCensusListContext() {
  return useContext(CensusListContext);
}

export function useCensusListDispatch() {
  return useContext(CensusListDispatchContext);
}

export function useSiteListContext() {
  return useContext(SiteListContext);
}

export function useSiteListDispatch() {
  return useContext(SiteListDispatchContext);
}
