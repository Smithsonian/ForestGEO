"use client";
import React, {createContext, Dispatch, useContext, useReducer} from "react";
import {Plot, plots} from "@/config/macros";
import {usePlotListContext} from "@/app/contexts/generalcontext";

export const PlotsContext = createContext<Plot | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plotKey: string | null }> | null>(null);

export default function PlotProvider({children}: { children: React.ReactNode }) {
  const [plot, plotDispatch] = useReducer(
    plotsReducer,
    null
  );
  return (
    <>
      <PlotsContext.Provider value={plot}>
        <PlotsDispatchContext.Provider value={plotDispatch}>
          {children}
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

export function usePlotContext() {
  return useContext(PlotsContext);
}

export function usePlotDispatch() {
  return useContext(PlotsDispatchContext);
}