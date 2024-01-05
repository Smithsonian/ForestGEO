"use client";
import React, {createContext, Dispatch, useContext, useReducer} from 'react';
import {allCensus, allQuadrats, Plot, plots} from "@/config/macros";
import PlotProvider, {PlotsContext} from "@/app/contexts/userselectioncontext";

export const PlotListContext = createContext<Plot[] | null>(null);
export const QuadratListContext = createContext<number[] | null>(null);
export const CensusListContext = createContext<number[] | null>(null);
export const FirstLoadContext = createContext<boolean | null>(null);
export const PlotListDispatchContext = createContext<Dispatch<{ plotList: Plot[] | null }> | null>(null);
export const QuadratListDispatchContext = createContext<Dispatch<{ quadratList: number[] | null }> | null>(null);
export const CensusListDispatchContext = createContext<Dispatch<{ censusList: number[] | null }> | null>(null);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | null>(null);

export function ContextsProvider({children}: { children: React.ReactNode }) {
  const [plotList, plotListDispatch] = useReducer(
    plotListReducer,
    plots
  )
  
  const [quadratList, quadratListDispatch] = useReducer(
    quadratListReducer,
    []
  )
  
  const [censusList, censusListDispatch] = useReducer(
    censusListReducer,
    []
  )
  
  const [firstLoad, firstLoadDispatch] = useReducer(
    firstLoadReducer,
    true
  )
  
  
  return (
    <>
      <PlotListContext.Provider value={plotList}>
        <PlotListDispatchContext.Provider value={plotListDispatch}>
          <QuadratListContext.Provider value={quadratList}>
            <QuadratListDispatchContext.Provider value={quadratListDispatch}>
              <CensusListContext.Provider value={censusList}>
                <CensusListDispatchContext.Provider value={censusListDispatch}>
                  <FirstLoadContext.Provider value={firstLoad}>
                    <FirstLoadDispatchContext.Provider value={firstLoadDispatch}>
                      <PlotProvider>
                        {children}
                      </PlotProvider>
                    </FirstLoadDispatchContext.Provider>
                  </FirstLoadContext.Provider>
                </CensusListDispatchContext.Provider>
              </CensusListContext.Provider>
            </QuadratListDispatchContext.Provider>
          </QuadratListContext.Provider>
        </PlotListDispatchContext.Provider>
      </PlotListContext.Provider>
    </>
  );
}

function firstLoadReducer(currentState: any, action: { firstLoad: boolean | null }) {
  if (action.firstLoad == false && currentState) return action.firstLoad;
  else return currentState;
}
function plotListReducer(_currentPlotList: any, action: {plotList: Plot[] | null}) {
  return action.plotList;
}
function quadratListReducer(_currentQuadratList: any, action: { quadratList: number[] | null}) {
  return action.quadratList;
}
function censusListReducer(_currentCensusList: any, action: { censusList: number[] | null}) {
  return action.censusList;
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
export function useQuadratListContext() {
  return useContext(QuadratListContext);
}
export function useQuadratListDispatch() {
  return useContext(QuadratListDispatchContext);
}
export function useCensusListContext() {
  return useContext(CensusListContext);
}
export function useCensusListDispatch() {
  return useContext(CensusListDispatchContext);
}