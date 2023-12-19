"use client";
import React, {createContext, Dispatch, useContext, useReducer} from 'react';
import {allCensus, allQuadrats, Plot, plots} from "@/config/macros";

export const PlotListContext = createContext<Plot[] | null>(null);
export const PlotsContext = createContext<Plot | null>(null);
export const CensusContext = createContext<number | null>(null);
export const QuadratContext = createContext<number | null>(null);
export const FirstLoadContext = createContext<boolean | null>(null);
export const PlotListDispatchContext = createContext<Dispatch<{ plotList: Plot[] | null }> | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{ plotKey: string | null }> | null>(null);
export const CensusDispatchContext = createContext<Dispatch<{ census: number | null }> | null>(null);
export const QuadratDispatchContext = createContext<Dispatch<{ quadrat: number | null }> | null>(null);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | null>(null);

export function ContextsProvider({children}: { children: React.ReactNode }) {
  const [plotList, plotListDispatch] = useReducer(
    plotListReducer,
    plots
  )
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
  )
  const [firstLoad, firstLoadDispatch] = useReducer(
    firstLoadReducer,
    true
  )
  
  
  return (
    <>
      <PlotListContext.Provider value={plotList}>
        <PlotListDispatchContext.Provider value={plotListDispatch}>
          <PlotsContext.Provider value={plot}>
            <PlotsDispatchContext.Provider value={plotDispatch}>
              <CensusContext.Provider value={census}>
                <CensusDispatchContext.Provider value={censusDispatch}>
                  <QuadratContext.Provider value={quadrat}>
                    <QuadratDispatchContext.Provider value={quadratDispatch}>
                      <FirstLoadContext.Provider value={firstLoad}>
                        <FirstLoadDispatchContext.Provider value={firstLoadDispatch}>
                          {children}
                        </FirstLoadDispatchContext.Provider>
                      </FirstLoadContext.Provider>
                    </QuadratDispatchContext.Provider>
                  </QuadratContext.Provider>
                </CensusDispatchContext.Provider>
              </CensusContext.Provider>
            </PlotsDispatchContext.Provider>
          </PlotsContext.Provider>
        </PlotListDispatchContext.Provider>
      </PlotListContext.Provider>
    </>
  );
}

function plotsReducer(currentPlot: any, action: { plotKey: string | null }) {
  const plotListContext = usePlotListContext();
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
  if (action.census == null) return null;
  else if (allCensus.includes(action.census)) return action.census;
  else return currentCensus;
}

function quadratReducer(currentQuadrat: any, action: { quadrat: number | null }) {
  if (action.quadrat == null) return null;
  else if (allQuadrats.includes(action.quadrat)) return action.quadrat;
  else return currentQuadrat;
}

function firstLoadReducer(currentState: any, action: { firstLoad: boolean | null }) {
  if (action.firstLoad == false && currentState) return action.firstLoad;
  else return currentState;
}

function plotListReducer(_currentPlotList: any, action: {plotList: Plot[] | null}) {
  return action.plotList;
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

export function useFirstLoadContext() {
  return useContext(FirstLoadContext);
}

export function useFirstLoadDispatch() {
  return useContext(FirstLoadDispatchContext);
}

export function usePlotListContext() {
  return useContext(PlotListContext);
}

export function usePlotListDispatch() {
  return useContext(PlotListDispatchContext);
}