"use client";
import React, { createContext, useContext, useEffect, useReducer } from "react";
import {
  createEnhancedDispatch,
  EnhancedDispatch,
  genericLoadContextReducer,
  LoadAction
} from "@/config/macros/contextreducers";
import { Site } from "@/config/sqlrdsdefinitions/tables/sitesrds";
import { Quadrat } from "@/config/sqlrdsdefinitions/tables/quadratrds";
import { Plot } from "@/config/sqlrdsdefinitions/tables/plotrds";
import { usePlotListContext, useQuadratListContext, useSiteListContext, useSubquadratListContext } from "@/app/contexts/listselectionprovider";
import { getData } from "@/config/db";
import { useCensusLoadContext } from "@/app/contexts/coredataprovider";
import { CensusRDS } from '@/config/sqlrdsdefinitions/tables/censusrds';
import { Subquadrat } from "@/config/sqlrdsdefinitions/tables/subquadratrds";

export const PlotContext = createContext<Plot>(null);
export const CensusContext = createContext<CensusRDS>(null);
export const QuadratContext = createContext<Quadrat>(null);
export const SubquadratContext = createContext<Subquadrat>(null);
export const SiteContext = createContext<Site>(null);
export const PlotDispatchContext = createContext<EnhancedDispatch<Plot> | null>(null);
export const CensusDispatchContext = createContext<EnhancedDispatch<CensusRDS> | null>(null);
export const QuadratDispatchContext = createContext<EnhancedDispatch<Quadrat> | null>(null);
export const SubquadratDispatchContext = createContext<EnhancedDispatch<Subquadrat> | null>(null);
export const SiteDispatchContext = createContext<EnhancedDispatch<Site> | null>(null);

export default function UserSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const plotListContext = usePlotListContext();
  const censusLoadContext = useCensusLoadContext();
  const quadratListContext = useQuadratListContext();
  const subquadratListContext = useSubquadratListContext();
  const siteListContext = useSiteListContext();
  if (!plotListContext) console.error('plot list context is not populated');
  if (!censusLoadContext) console.error('census load context is not populated');
  if (!quadratListContext) console.error('quadratList context is not populated');
  if (!subquadratListContext) console.error('subquadratList context is not populated');
  if (!siteListContext) console.error('sites context is not populated');

  const [plot, plotDispatch] = useReducer(
    (state: Plot, action: LoadAction<Plot>) => genericLoadContextReducer(state, action, plotListContext ?? []),
    null
  );
  const [census, censusDispatch] = useReducer(
    (state: CensusRDS, action: LoadAction<CensusRDS>) => genericLoadContextReducer(state, action, censusLoadContext ?? []),
    null
  );
  const [quadrat, quadratDispatch] = useReducer(
    (state: Quadrat, action: LoadAction<Quadrat>) => genericLoadContextReducer(state, action, quadratListContext ?? []),
    null
  );

  const [subquadrat, subquadratDispatch] = useReducer(
    (state: Subquadrat, action: LoadAction<Subquadrat>) => genericLoadContextReducer(state, action, subquadratListContext ?? []),
    null
  );
  const [site, siteDispatch] = useReducer(
    (state: Site, action: LoadAction<Site>) => genericLoadContextReducer(state, action, siteListContext ?? []),
    null
  );

  const enhancedPlotDispatch = createEnhancedDispatch(plotDispatch, 'plot');
  const enhancedCensusDispatch = createEnhancedDispatch(censusDispatch, 'census');
  const enhancedQuadratDispatch = createEnhancedDispatch(quadratDispatch, 'quadrat');
  const enhancedSubquadratDispatch = createEnhancedDispatch(subquadratDispatch, 'subquadrat');
  const enhancedSiteDispatch = createEnhancedDispatch(siteDispatch, 'site');

  useEffect(() => {
    const fetchData = async () => {
      const plotData = await getData('plot');
      if (plotData) plotDispatch({ type: 'plot', payload: plotData });

      const quadratData = await getData('quadrat');
      if (quadratData) quadratDispatch({ type: "quadrat", payload: quadratData });

      const subquadratData = await getData('subquadrat');
      if (subquadratData) subquadratDispatch({ type: 'subquadrat', payload: subquadratData });

      const censusData = await getData('census');
      if (censusData) censusDispatch({ type: "census", payload: censusData });

      const siteData = await getData('site');
      if (siteData) siteDispatch({ type: 'site', payload: siteData });
    };
    fetchData().catch(console.error);
    // Set up polling
    // const interval = setInterval(fetchData, 10000); // Poll every 10 seconds
    //
    // return () => clearInterval(interval);
  }, []);

  return (
    <SiteContext.Provider value={site}>
      <SiteDispatchContext.Provider value={enhancedSiteDispatch}>
        <PlotContext.Provider value={plot}>
          <PlotDispatchContext.Provider value={enhancedPlotDispatch}>
            <CensusContext.Provider value={census}>
              <CensusDispatchContext.Provider value={enhancedCensusDispatch}>
                <QuadratContext.Provider value={quadrat}>
                  <QuadratDispatchContext.Provider value={enhancedQuadratDispatch}>
                    <SubquadratContext.Provider value={subquadrat}>
                      <SubquadratDispatchContext.Provider value={enhancedSubquadratDispatch}>
                        {children}
                      </SubquadratDispatchContext.Provider>
                    </SubquadratContext.Provider>
                  </QuadratDispatchContext.Provider>
                </QuadratContext.Provider>
              </CensusDispatchContext.Provider>
            </CensusContext.Provider>
          </PlotDispatchContext.Provider>
        </PlotContext.Provider>
      </SiteDispatchContext.Provider>
    </SiteContext.Provider>
  );
}

export function usePlotContext() {
  return useContext(PlotContext);
}

export function usePlotDispatch() {
  return useContext(PlotDispatchContext);
}

export function useCensusContext() {
  return useContext(CensusContext);
}

export function useCensusDispatch() {
  return useContext(CensusDispatchContext);
}

export function useQuadratContext() {
  return useContext(QuadratContext);
}

export function useQuadratDispatch() {
  return useContext(QuadratDispatchContext);
}

export function useSubquadratContext() {
  return useContext(SubquadratContext);
}

export function useSubquadratListDispatch() {
  return useContext(SubquadratDispatchContext);
}

export function useSiteContext() {
  return useContext(SiteContext);
}

export function useSiteDispatch() {
  return useContext(SiteDispatchContext);
}