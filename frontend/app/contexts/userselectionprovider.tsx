// userselectionprovider.tsx
'use client';
import React, { createContext, useContext, useReducer } from 'react';
import { createEnhancedDispatch, EnhancedDispatch, genericLoadContextReducer, LoadAction } from '@/config/macros/contextreducers';
import { useOrgCensusListContext, usePlotListContext, useQuadratListContext, useSiteListContext } from '@/app/contexts/listselectionprovider';
import { Plot, Quadrat, Site } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

export const PlotContext = createContext<Plot>(undefined);
export const OrgCensusContext = createContext<OrgCensus>(undefined);
export const QuadratContext = createContext<Quadrat>(undefined);
export const SiteContext = createContext<Site>(undefined);
export const PlotDispatchContext = createContext<EnhancedDispatch<Plot> | undefined>(undefined);
export const OrgCensusDispatchContext = createContext<EnhancedDispatch<OrgCensus> | undefined>(undefined);
export const QuadratDispatchContext = createContext<EnhancedDispatch<Quadrat> | undefined>(undefined);
export const SiteDispatchContext = createContext<EnhancedDispatch<Site> | undefined>(undefined);

export default function UserSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const plotListContext = usePlotListContext();
  const orgCensusListContext = useOrgCensusListContext();
  const quadratListContext = useQuadratListContext();
  const siteListContext = useSiteListContext();

  const [plot, plotDispatch] = useReducer(
    (state: Plot, action: LoadAction<Plot>) => genericLoadContextReducer(state, action, plotListContext ?? []),
    undefined
  );
  const [orgCensus, orgCensusDispatch] = useReducer(
    (state: OrgCensus, action: LoadAction<OrgCensus>) => genericLoadContextReducer(state, action, orgCensusListContext ?? []),
    undefined
  );
  const [quadrat, quadratDispatch] = useReducer(
    (state: Quadrat, action: LoadAction<Quadrat>) => genericLoadContextReducer(state, action, quadratListContext ?? []),
    undefined
  );

  const [site, siteDispatch] = useReducer(
    (state: Site, action: LoadAction<Site>) => genericLoadContextReducer(state, action, siteListContext ?? []),
    undefined
  );

  const enhancedPlotDispatch = createEnhancedDispatch(plotDispatch, 'plot');
  const enhancedOrgCensusDispatch = createEnhancedDispatch(orgCensusDispatch, 'census');
  const enhancedQuadratDispatch = createEnhancedDispatch(quadratDispatch, 'quadrat');
  const enhancedSiteDispatch = createEnhancedDispatch(siteDispatch, 'site');

  return (
    <SiteContext.Provider value={site}>
      <SiteDispatchContext.Provider value={enhancedSiteDispatch}>
        <PlotContext.Provider value={plot}>
          <PlotDispatchContext.Provider value={enhancedPlotDispatch}>
            <OrgCensusContext.Provider value={orgCensus}>
              <OrgCensusDispatchContext.Provider value={enhancedOrgCensusDispatch}>
                <QuadratContext.Provider value={quadrat}>
                  <QuadratDispatchContext.Provider value={enhancedQuadratDispatch}>{children}</QuadratDispatchContext.Provider>
                </QuadratContext.Provider>
              </OrgCensusDispatchContext.Provider>
            </OrgCensusContext.Provider>
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

export function useOrgCensusContext() {
  return useContext(OrgCensusContext);
}

export function useOrgCensusDispatch() {
  return useContext(OrgCensusDispatchContext);
}

export function useQuadratContext() {
  return useContext(QuadratContext);
}

export function useQuadratDispatch() {
  return useContext(QuadratDispatchContext);
}

export function useSiteContext() {
  return useContext(SiteContext);
}

export function useSiteDispatch() {
  return useContext(SiteDispatchContext);
}
