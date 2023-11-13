"use client";
import React, {createContext, Dispatch, useContext, useReducer} from 'react';
import {allCensus, Plot, plots} from "@/config/macros";

const initialState: Plot = {key: 'none', num: 0};
const initialCensus = 1;
export const PlotsContext = createContext<Plot | null>(null);
export const CensusContext = createContext<number | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plotKey: string }> | null>(null);
export const CensusDispatchContext = createContext<Dispatch<{census: number}> | null>(null);

export function ContextsProvider({children}: { children: React.ReactNode }) {
  const [plot, plotDispatch] = useReducer(
    plotsReducer,
    initialState
  );
  const [census, censusDispatch] = useReducer(
    censusReducer,
    initialCensus
  );
  
  
  return (
    <PlotsContext.Provider value={plot}>
      <PlotsDispatchContext.Provider value={plotDispatch}>
        <CensusContext.Provider value={census}>
          <CensusDispatchContext.Provider value={censusDispatch}>
            {children}
          </CensusDispatchContext.Provider>
        </CensusContext.Provider>
      </PlotsDispatchContext.Provider>
    </PlotsContext.Provider>
  );
}

function plotsReducer(currentPlot: any, action: { plotKey: string }) {
  if (plots.find((p) => p.key == action.plotKey)) return plots.find((p) => p.key == action.plotKey);
  else if (action.plotKey == "") return initialState;
  else return currentPlot;
}

function censusReducer(currentCensus: any, action: { census: number} ) {
  if (allCensus.includes(action.census)) return action.census;
  else return currentCensus;
}


export function usePlotContext() {
  return useContext(PlotsContext);
}

export function usePlotDispatch() {
  return useContext(PlotsDispatchContext);
}