"use client";
import React, {createContext, Dispatch, useContext, useReducer} from 'react';
import {allCensus, allQuadrats, Plot, plots} from "@/config/macros";

const initialState: Plot = {key: 'none', num: 0};
const initialCensus = 1;
const initialQuadrat = 1;
export const PlotsContext = createContext<Plot | null>(null);
export const CensusContext = createContext<number | null>(null);
export const QuadratContext = createContext<number | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plotKey: string }> | null>(null);
export const CensusDispatchContext = createContext<Dispatch<{census: number}> | null>(null);
export const QuadratDispatchContext = createContext<Dispatch<{quadrat: number}> | null>(null);

export function ContextsProvider({children}: { children: React.ReactNode }) {
  const [plot, plotDispatch] = useReducer(
    plotsReducer,
    initialState
  );
  const [census, censusDispatch] = useReducer(
    censusReducer,
    initialCensus
  );
  const [quadrat, quadratDispatch] = useReducer(
    quadratReducer,
    initialQuadrat
  )
  
  
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

function plotsReducer(currentPlot: any, action: { plotKey: string }) {
  if (plots.find((p) => p.key == action.plotKey)) return plots.find((p) => p.key == action.plotKey);
  else if (action.plotKey == "") return null;
  else return currentPlot;
}

function censusReducer(currentCensus: any, action: { census: number} ) {
  if (allCensus.includes(action.census)) return action.census;
  else if (action.census < 0) return null;
  else return currentCensus;
}

function quadratReducer(currentQuadrat: any, action: { quadrat: number } ) {
  if (allQuadrats.includes(action.quadrat)) return action.quadrat;
  else if (action.quadrat < 0) return null;
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