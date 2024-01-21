"use client";
import React, {createContext, Dispatch, useContext, useEffect, useReducer} from 'react';
import {Census, Plot, Quadrat} from "@/config/macros";
import PlotProvider from "@/app/contexts/userselectioncontext";
import {getData} from "@/config/db";

export const PlotListContext = createContext<Plot[] | null>(null);
export const QuadratListContext = createContext<Quadrat[] | null>(null);
export const CensusListContext = createContext<Census[] | null>(null);
export const FirstLoadContext = createContext<boolean | null>(null);
export const PlotListDispatchContext = createContext<Dispatch<{ plotList: Plot[] | null }> | null>(null);
export const QuadratListDispatchContext = createContext<Dispatch<{ quadratList: Quadrat[] | null }> | null>(null);
export const CensusListDispatchContext = createContext<Dispatch<{ censusList: Census[] | null }> | null>(null);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | null>(null);

export function ContextsProvider({children}: { children: React.ReactNode }) {
  const [plotList, plotListDispatch] = useReducer(
    plotListReducer,
    []
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

  useEffect(() => {
    const fetchData = async () => {
      const plotListData = await getData('plotList');
      plotListDispatch({ plotList: plotListData });

      const quadratListData = await getData('quadratList');
      quadratListDispatch({ quadratList: quadratListData });

      const censusListData = await getData('censusList');
      censusListDispatch({ censusList: censusListData });
    };

    fetchData().catch(console.error);
  }, []);


  return (
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
  );
}

function firstLoadReducer(currentState: any, action: { firstLoad: boolean | null }) {
  if (!action.firstLoad && currentState) return action.firstLoad;
  else return currentState;
}

function plotListReducer(_currentPlotList: any, action: { plotList: Plot[] | null }) {
  return action.plotList;
}

function quadratListReducer(_currentQuadratList: any, action: { quadratList: Quadrat[] | null }) {
  return action.quadratList;
}

function censusListReducer(_currentCensusList: any, action: { censusList: Census[] | null }) {
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