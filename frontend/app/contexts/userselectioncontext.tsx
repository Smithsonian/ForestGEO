"use client";
import React, {createContext, Dispatch, useContext, useReducer} from "react";
import {
  allQuadrats,
  Census,
  CensusAction,
  containsPlotCensusNumber,
  Plot,
  PlotAction,
  plots, Quadrat,
  QuadratsAction
} from "@/config/macros";
import {useCensusListContext, usePlotListContext, useQuadratListContext} from "@/app/contexts/generalcontext";

export const PlotsContext = createContext<Plot | null>(null);
export const CensusContext = createContext<Census | null>(null);
export const QuadratContext = createContext<Quadrat | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plot: Plot | null }> | null>(null);
export const CensusDispatchContext = createContext<Dispatch<{ census: Census | null }> | null>(null);
export const QuadratDispatchContext = createContext<Dispatch<{ quadrat: Quadrat | null }> | null>(null);

export default function PlotProvider({children}: { children: React.ReactNode }) {
  const plotListContext = (usePlotListContext() ?? JSON.parse(localStorage.getItem('plotList') ?? '[]'));
  const censusListContext = useCensusListContext() ?? JSON.parse(localStorage.getItem('censusList') ?? '[]');
  const quadratListContext = useQuadratListContext() ?? JSON.parse(localStorage.getItem('quadratList') ?? '[]');
  const [plot, plotDispatch] = useReducer(
    (state: Plot | null, action: PlotAction) => plotsReducer(state, action, plotListContext),
    null
  );
  const [census, censusDispatch] = useReducer(
    (state: Census | null, action: CensusAction) => censusReducer(state, action, censusListContext),
    null
  );

  const [quadrat, quadratDispatch] = useReducer(
    (state: Quadrat | null, action: QuadratsAction) => quadratReducer(state, action, quadratListContext),
    null
  );

  return (
    <PlotsContext.Provider value={plot}>
      <PlotsDispatchContext.Provider value={plotDispatch}>
        <CensusContext.Provider value={census}>
          <CensusDispatchContext.Provider value={censusDispatch}>
            <QuadratContext.Provider value={quadrat}>
              <QuadratDispatchContext.Provider value={quadratDispatch}>
                {children}
              </QuadratDispatchContext.Provider>
            </QuadratContext.Provider>
          </CensusDispatchContext.Provider>
        </CensusContext.Provider>
      </PlotsDispatchContext.Provider>
    </PlotsContext.Provider>
  );
}

function plotsReducer(currentPlot: any, action: { plot: Plot | null }, plotListContext: Plot[]) {
  if (action.plot == null) return null;
  return plotListContext.includes(action.plot) ? action.plot : currentPlot;
}

function censusReducer(currentCensus: any, action: { census: Census | null }, censusListContext: Census[]) {
  if (action.census == null) return null;
  else if (containsPlotCensusNumber(censusListContext, action.census.plotCensusNumber)) return action.census;
  else return currentCensus;
}


function quadratReducer(currentQuadrat: any, action: {
  quadrat: Quadrat | null
}, quadratListContext: Quadrat[]) {
  if (action.quadrat == null) return null;
  else if (quadratListContext.includes(action.quadrat)) return action.quadrat;
  else return currentQuadrat;
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