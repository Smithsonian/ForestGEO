"use client";
import React, {createContext, Dispatch, useContext, useEffect, useReducer} from "react";
import {
  createEnhancedDispatch,
  EnhancedDispatch,
  genericLoadContextReducer,
  LoadAction,
  Plot,
  PlotRaw,
  Quadrat
} from "@/config/macros";
import {usePlotListContext, useQuadratListContext} from "@/app/contexts/listselectionprovider";
import {getData} from "@/config/db";
import {useCensusLoadContext} from "@/app/contexts/coredataprovider";
import {CensusRDS} from "@/config/sqlmacros";

export const PlotContext = createContext<Plot>(null);
export const CensusContext = createContext<CensusRDS>(null);
export const QuadratContext = createContext<Quadrat>(null);
export const PlotDispatchContext = createContext<EnhancedDispatch<Plot> | null>(null);
export const CensusDispatchContext = createContext<EnhancedDispatch<CensusRDS> | null>(null);
export const QuadratDispatchContext = createContext<EnhancedDispatch<Quadrat> | null>(null);

export default function UserSelectionProvider({children}: Readonly<{ children: React.ReactNode }>) {
  const plotListContext = usePlotListContext();
  const censusLoadContext = useCensusLoadContext();
  const quadratListContext = useQuadratListContext();
  if (!plotListContext) throw new Error('plot list context is not populated');
  if (!censusLoadContext) throw new Error('census load context is not populated');
  if (!quadratListContext) throw new Error('quadratList context is not populated');

  const [plot, plotDispatch] = useReducer(
    (state: Plot, action: LoadAction<Plot>) => genericLoadContextReducer(state, action, plotListContext),
    null
  );
  const [census, censusDispatch] = useReducer(
    (state: CensusRDS, action: LoadAction<CensusRDS>) => genericLoadContextReducer(state, action, censusLoadContext),
    null
  );
  const [quadrat, quadratDispatch] = useReducer(
    (state: Quadrat, action: LoadAction<Quadrat>) => genericLoadContextReducer(state, action, quadratListContext),
    null
  );

  const enhancedPlotDispatch = createEnhancedDispatch(plotDispatch, 'plot');
  const enhancedCensusDispatch = createEnhancedDispatch(censusDispatch, 'census');
  const enhancedQuadratDispatch = createEnhancedDispatch(quadratDispatch, 'quadrat');


  useEffect(() => {
    const fetchData = async () => {
      const plotData = await getData('plot');
      if (plotData) plotDispatch({type: 'plot', payload: plotData});

      const quadratData = await getData('quadrat');
      if (quadratData) quadratDispatch({type: "quadrat", payload: quadratData});

      const censusData = await getData('census');
      if (censusData) censusDispatch({type: "census", payload: censusData});
    };
    fetchData().catch(console.error);
    // Set up polling
    // const interval = setInterval(fetchData, 10000); // Poll every 10 seconds
    //
    // return () => clearInterval(interval);
  }, []);

  return (
    <PlotContext.Provider value={plot}>
      <PlotDispatchContext.Provider value={enhancedPlotDispatch}>
        <CensusContext.Provider value={census}>
          <CensusDispatchContext.Provider value={enhancedCensusDispatch}>
            <QuadratContext.Provider value={quadrat}>
              <QuadratDispatchContext.Provider value={enhancedQuadratDispatch}>
                {children}
              </QuadratDispatchContext.Provider>
            </QuadratContext.Provider>
          </CensusDispatchContext.Provider>
        </CensusContext.Provider>
      </PlotDispatchContext.Provider>
    </PlotContext.Provider>
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