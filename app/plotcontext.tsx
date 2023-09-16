"use client";
import React, {createContext, Dispatch, useContext, useReducer} from 'react';
import {Plot, plots} from "@/config/macros";

const initialState: Plot = {key: 'none', num: 0};
export const PlotsContext = createContext<Plot | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{plotKey: string}> | null>(null);

export function PlotsProvider({ children }: {children: React.ReactNode}) {
  const [tasks, dispatch] = useReducer(
    plotsReducer,
    initialState
  );
  
  return (
    <PlotsContext.Provider value={tasks}>
      <PlotsDispatchContext.Provider value={dispatch}>
        {children}
      </PlotsDispatchContext.Provider>
    </PlotsContext.Provider>
  );
}

function plotsReducer(currentPlot: any, action: {plotKey: string}) {
  if (plots.find((p) => p.key === action.plotKey)) return plots.find((p) => p.key === action.plotKey);
  else return currentPlot;
}
export function usePlotContext() {
  return useContext(PlotsContext);
}

export function usePlotDispatch() {
  return useContext(PlotsDispatchContext);
}