// ListSelectionProvider.tsx
'use client';
import React, { createContext, Dispatch, useContext, useReducer } from 'react';
import { createEnhancedDispatch, EnhancedDispatch, genericLoadReducer, LoadAction } from '@/config/macros/contextreducers';
import { PlotRDS, QuadratRDS, SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

// contexts
export const PlotListContext = createContext<PlotRDS[] | undefined>([]);
export const OrgCensusListContext = createContext<OrgCensus[] | undefined>([]);
export const QuadratListContext = createContext<QuadratRDS[] | undefined>([]);
export const SiteListContext = createContext<SitesRDS[] | undefined>([]);
export const FirstLoadContext = createContext<boolean | undefined>(false);
// dispatches
export const PlotListDispatchContext = createContext<EnhancedDispatch<PlotRDS[]> | undefined>(undefined);
export const OrgCensusListDispatchContext = createContext<EnhancedDispatch<OrgCensus[]> | undefined>(undefined);
export const QuadratListDispatchContext = createContext<EnhancedDispatch<QuadratRDS[]> | undefined>(undefined);
export const SiteListDispatchContext = createContext<EnhancedDispatch<SitesRDS[]> | undefined>(undefined);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | undefined>(undefined);

export function ListSelectionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [plotList, plotListDispatch] = useReducer<React.Reducer<PlotRDS[] | undefined, LoadAction<PlotRDS[]>>>(genericLoadReducer, []);

  const [orgCensusList, orgCensusListDispatch] = useReducer<React.Reducer<OrgCensus[] | undefined, LoadAction<OrgCensus[]>>>(genericLoadReducer, []);

  const [quadratList, quadratListDispatch] = useReducer<React.Reducer<QuadratRDS[] | undefined, LoadAction<QuadratRDS[]>>>(genericLoadReducer, []);

  const [siteList, siteListDispatch] = useReducer<React.Reducer<SitesRDS[] | undefined, LoadAction<SitesRDS[]>>>(genericLoadReducer, []);

  const [firstLoad, firstLoadDispatch] = useReducer(firstLoadReducer, true);

  const enhancedPlotListDispatch = createEnhancedDispatch(plotListDispatch, 'plotList');
  const enhancedOrgCensusListDispatch = createEnhancedDispatch(orgCensusListDispatch, 'censusList');
  const enhancedQuadratListDispatch = createEnhancedDispatch(quadratListDispatch, 'quadratList');
  const enhancedSiteListDispatch = createEnhancedDispatch(siteListDispatch, 'siteList');

  return (
    <SiteListContext.Provider value={siteList}>
      <SiteListDispatchContext.Provider value={enhancedSiteListDispatch}>
        <PlotListContext.Provider value={plotList}>
          <PlotListDispatchContext.Provider value={enhancedPlotListDispatch}>
            <QuadratListContext.Provider value={quadratList}>
              <QuadratListDispatchContext.Provider value={enhancedQuadratListDispatch}>
                <OrgCensusListContext.Provider value={orgCensusList}>
                  <OrgCensusListDispatchContext.Provider value={enhancedOrgCensusListDispatch}>
                    <FirstLoadContext.Provider value={firstLoad}>
                      <FirstLoadDispatchContext.Provider value={firstLoadDispatch}>{children}</FirstLoadDispatchContext.Provider>
                    </FirstLoadContext.Provider>
                  </OrgCensusListDispatchContext.Provider>
                </OrgCensusListContext.Provider>
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

export function useQuadratListContext() {
  return useContext(QuadratListContext);
}

export function useQuadratListDispatch() {
  return useContext(QuadratListDispatchContext);
}

export function useOrgCensusListContext() {
  return useContext(OrgCensusListContext);
}

export function useOrgCensusListDispatch() {
  return useContext(OrgCensusListDispatchContext);
}

export function useSiteListContext() {
  return useContext(SiteListContext);
}

export function useSiteListDispatch() {
  return useContext(SiteListDispatchContext);
}

export function usePlotListContext() {
  return useContext(PlotListContext);
}

export function usePlotListDispatch() {
  return useContext(PlotListDispatchContext);
}
