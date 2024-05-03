"use client";
import React, { createContext, Dispatch, useContext, useEffect, useReducer } from 'react';
import {
  createEnhancedDispatch,
  EnhancedDispatch,
  genericLoadReducer,
  LoadAction
} from "@/config/macros/contextreducers";
import { Census } from "@/config/sqlrdsdefinitions/tables/censusrds";
import { Quadrat } from "@/config/sqlrdsdefinitions/tables/quadratrds";
import { Plot } from "@/config/sqlrdsdefinitions/tables/plotrds";
import { Subquadrat } from '@/config/sqlrdsdefinitions/tables/subquadratrds';
import { getData } from "@/config/db";
import { SitesRDS } from '@/config/sqlrdsdefinitions/tables/sitesrds';

export const PlotListContext = createContext<Plot[] | null>(null);
export const CensusListContext = createContext<Census[] | null>(null);
export const QuadratListContext = createContext<Quadrat[] | null>(null);
export const SubquadratListContext = createContext<Subquadrat[] | null>(null);
export const FirstLoadContext = createContext<boolean | null>(null);
export const SiteListContext = createContext<SitesRDS[] | null>(null);
export const PlotListDispatchContext = createContext<EnhancedDispatch<Plot[]> | null>(null);
export const CensusListDispatchContext = createContext<EnhancedDispatch<Census[]> | null>(null);
export const QuadratListDispatchContext = createContext<EnhancedDispatch<Quadrat[]> | null>(null);
export const SubquadratListDispatchContext = createContext<EnhancedDispatch<Subquadrat[]> | null>(null);
export const SiteListDispatchContext = createContext<EnhancedDispatch<SitesRDS[]> | null>(null);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | null>(null);

export function ListSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [plotList, plotListDispatch] =
    useReducer<React.Reducer<Plot[] | null, LoadAction<Plot[]>>>(genericLoadReducer, []);

  const [censusList, censusListDispatch] =
    useReducer<React.Reducer<Census[] | null, LoadAction<Census[]>>>(genericLoadReducer, []);

  const [quadratList, quadratListDispatch] =
    useReducer<React.Reducer<Quadrat[] | null, LoadAction<Quadrat[]>>>(genericLoadReducer, []);

  const [subquadratList, subquadratListDispatch] =
    useReducer<React.Reducer<Subquadrat[] | null, LoadAction<Subquadrat[]>>>(genericLoadReducer, []);

  const [siteList, siteListDispatch] =
    useReducer<React.Reducer<SitesRDS[] | null, LoadAction<SitesRDS[]>>>(genericLoadReducer, []);

  const [firstLoad, firstLoadDispatch] = useReducer(
    firstLoadReducer,
    true
  );

  const enhancedPlotListDispatch = createEnhancedDispatch(plotListDispatch, 'plotList');
  const enhancedCensusListDispatch = createEnhancedDispatch(censusListDispatch, 'censusList');
  const enhancedQuadratListDispatch = createEnhancedDispatch(quadratListDispatch, 'quadratList');
  const enhancedSubquadratListDispatch = createEnhancedDispatch(subquadratListDispatch, 'subquadratList');
  const enhancedSiteListDispatch = createEnhancedDispatch(siteListDispatch, 'siteList');


  useEffect(() => {
    const fetchData = async () => {
      const plotListData: Plot[] | undefined = await getData('plotList');
      if (plotListData) await enhancedPlotListDispatch({ plotList: plotListData });

      const quadratListData: Quadrat[] | undefined = await getData('quadratList');
      if (quadratListData) await enhancedQuadratListDispatch({ quadratList: quadratListData });

      const subquadratListData: Subquadrat[] | undefined = await getData('subquadratList');
      if (subquadratListData) await enhancedSubquadratListDispatch({ subquadratList: subquadratListData });

      const censusListData: Census[] | undefined = await getData('censusList');
      if (censusListData) await enhancedCensusListDispatch({ censusList: censusListData });

      const siteListData: SitesRDS[] | undefined = await getData('siteList');
      if (siteListData) await enhancedSiteListDispatch({ siteList: siteListData });
    };

    fetchData().catch(console.error);

    // // Set up polling
    // const interval = setInterval(fetchData, 10000); // Poll every 10 seconds
    //
    // return () => clearInterval(interval);
  }, []);


  return (
    <SiteListContext.Provider value={siteList}>
      <SiteListDispatchContext.Provider value={enhancedSiteListDispatch}>
        <PlotListContext.Provider value={plotList}>
          <PlotListDispatchContext.Provider value={enhancedPlotListDispatch}>
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
          </PlotListDispatchContext.Provider>
        </PlotListContext.Provider>
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

export function usePlotListContext() {
  return useContext(PlotListContext);
}

export function usePlotListDispatch() {
  return useContext(PlotListDispatchContext);
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