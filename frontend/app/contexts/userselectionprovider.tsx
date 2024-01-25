"use client";
import React, {createContext, Dispatch, useContext, useEffect, useReducer} from "react";
import {createEnhancedDispatch, genericLoadContextReducer, LoadAction, Plot, Quadrat} from "@/config/macros";
import {
  usePlotListContext,
  usePlotListDispatch,
  useQuadratListContext,
  useQuadratListDispatch
} from "@/app/contexts/listselectionprovider";
import {getData} from "@/config/db";
import {useCensusLoadContext, useCensusLoadDispatch} from "@/app/contexts/coredataprovider";
import {CensusRDS} from "@/config/sqlmacros";

export const PlotsContext = createContext<Plot | null>(null);
export const CensusContext = createContext<CensusRDS | null>(null);
export const QuadratContext = createContext<Quadrat | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plot: Plot | null }> | null>(null);
export const CensusDispatchContext = createContext<Dispatch<{ census: CensusRDS | null }> | null>(null);
export const QuadratDispatchContext = createContext<Dispatch<{ quadrat: Quadrat | null }> | null>(null);

function isValidPlot(plotListContext: Plot[], plot: Plot): boolean {
  return plotListContext.includes(plot);
}

function isValidQuadrat(quadratListContext: Quadrat[], quadrat: Quadrat): boolean {
  return quadratListContext.includes(quadrat);
}

function containsCensusID(censusArray: CensusRDS[], censusToCheck: CensusRDS): boolean {
  return censusArray.some(census => census.censusID === censusToCheck.censusID);
}

export default function UserSelectionProvider({children}: { children: React.ReactNode }) {
  let initPlot: Plot = {key: '', num: 0, id: 0};
  let initCensus: CensusRDS = {
    id: 0,
    censusID: 0,
    plotID: null,
    plotCensusNumber: null,
    startDate: null,
    endDate: null,
    description: null
  };
  let initQuadrat: Quadrat = {quadratID: 0, plotID: 0, quadratName: ''}
  const plotListContext = usePlotListContext();
  const censusLoadContext = useCensusLoadContext();
  const quadratListContext = useQuadratListContext();
  const plotListDispatch = usePlotListDispatch();
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratListDispatch = useQuadratListDispatch();

  const [plot, plotDispatch] = useReducer(
    (state: Plot | null, action: LoadAction<Plot>) => genericLoadContextReducer(state, action, plotListContext!, isValidPlot),
    initPlot
  );
  const [census, censusDispatch] = useReducer(
    (state: CensusRDS | null, action: LoadAction<CensusRDS>) => genericLoadContextReducer(state, action, censusLoadContext!, containsCensusID),
    initCensus
  );
  const [quadrat, quadratDispatch] = useReducer(
    (state: Quadrat | null, action: LoadAction<Quadrat>) => genericLoadContextReducer(state, action, quadratListContext!, isValidQuadrat),
    initQuadrat
  );

  const enhancedPlotDispatch = createEnhancedDispatch(plotDispatch, 'plot');
  const enhancedCensusDispatch = createEnhancedDispatch(censusDispatch, 'census');
  const enhancedQuadratDispatch = createEnhancedDispatch(quadratDispatch, 'quadrat');


  useEffect(() => {
    const fetchData = async () => {
      const plotListData = await getData('plotList');
      if (plotListDispatch) plotListDispatch({plotList: plotListData});

      const censusLoadData = await getData('censusLoad');
      if (censusLoadDispatch) censusLoadDispatch({censusLoad: censusLoadData});

      const quadratListData = await getData('quadratList');
      if (quadratListDispatch) quadratListDispatch({quadratList: quadratListData});

      const plotData = await getData('plot');
      plotDispatch({type: 'plot', payload: plotData});

      const quadratData = await getData('quadrat');
      quadratDispatch({type: "quadrat", payload: quadratData});

      const censusData = await getData('census');
      censusDispatch({type: "census", payload: censusData});
    };

    fetchData().catch(console.error);
  }, []);

  return (
    <PlotsContext.Provider value={plot}>
      <PlotsDispatchContext.Provider value={enhancedPlotDispatch}>
        <CensusContext.Provider value={census}>
          <CensusDispatchContext.Provider value={enhancedCensusDispatch}>
            <QuadratContext.Provider value={quadrat}>
              <QuadratDispatchContext.Provider value={enhancedQuadratDispatch}>
                {children}
              </QuadratDispatchContext.Provider>
            </QuadratContext.Provider>
          </CensusDispatchContext.Provider>
        </CensusContext.Provider>
      </PlotsDispatchContext.Provider>
    </PlotsContext.Provider>
  );
}


export function usePlotContext() {
  return useContext(PlotsContext);
}

export function usePlotDispatch() {
  return useContext(PlotsDispatchContext);
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