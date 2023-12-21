"use client";
import React, {createContext, Dispatch, useContext, useReducer} from "react";
import {allCensus, allQuadrats, Plot, plots} from "@/config/macros";
import {useCensusListContext, usePlotListContext, useQuadratListContext} from "@/app/contexts/generalcontext";

export const PlotsContext = createContext<Plot | null>(null);
export const CensusContext = createContext<number | null>(null);
export const QuadratContext = createContext<number | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plotKey: string | null }> | null>(null);
export const CensusDispatchContext = createContext<Dispatch<{ census: number | null }> | null>(null);
export const QuadratDispatchContext = createContext<Dispatch<{ quadrat: number | null }> | null>(null);

export default function PlotProvider({children}: { children: React.ReactNode }) {
  const [plot, plotDispatch] = useReducer(
    plotsReducer,
    null
  );
  const [census, censusDispatch] = useReducer(
    censusReducer,
    null
  );
  const [quadrat, quadratDispatch] = useReducer(
    quadratReducer,
    null
  );
  return (
    <>
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
    </>
  );
}

function plotsReducer(currentPlot: any, action: { plotKey: string | null }) {
  let plotListContext = usePlotListContext();
  if (plotListContext) {
    if (action.plotKey == null) return null;
    else if (plotListContext.find((p) => p.key == action.plotKey)) return plotListContext.find((p) => p.key == action.plotKey);
    else return currentPlot;
  } else {
    if (action.plotKey == null) return null;
    else if (plots.find((p) => p.key == action.plotKey)) return plots.find((p) => p.key == action.plotKey);
    else return currentPlot;
  }
}
function censusReducer(currentCensus: any, action: { census: number | null }) {
  let censusListContext = useCensusListContext();
  if (censusListContext) {
    if (action.census == null) return null;
    else if (censusListContext.includes(action.census)) return action.census;
    else return currentCensus;
  } else {
    if (action.census == null) return null;
    else if (allCensus.includes(action.census)) return action.census;
    else return currentCensus;
  }
}

function quadratReducer(currentQuadrat: any, action: { quadrat: number | null }) {
  let quadratListContext = useQuadratListContext();
  if (quadratListContext) {
    if (action.quadrat == null) return null;
    else if (quadratListContext.includes(action.quadrat)) return action.quadrat;
    else return currentQuadrat;
  } else {
    if (action.quadrat == null) return null;
    else if (allQuadrats.includes(action.quadrat)) return action.quadrat;
    else return currentQuadrat;
  }
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