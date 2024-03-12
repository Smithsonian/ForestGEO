"use client";
import React, {createContext, Dispatch, useContext, useEffect, useReducer} from 'react';
import {
  Census,
  createEnhancedDispatch,
  EnhancedDispatch,
  genericLoadReducer,
  LoadAction,
  Plot,
  Quadrat
} from "@/config/macros";
import {getData} from "@/config/db";

export const PlotListContext = createContext<Plot[] | null>(null);
export const QuadratListContext = createContext<Quadrat[] | null>(null);
export const CensusListContext = createContext<Census[] | null>(null);
export const FirstLoadContext = createContext<boolean | null>(null);
export const PlotListDispatchContext = createContext<EnhancedDispatch<Plot[]> | null>(null);
export const QuadratListDispatchContext = createContext<EnhancedDispatch<Quadrat[]> | null>(null);
export const CensusListDispatchContext = createContext<EnhancedDispatch<Census[]> | null>(null);
export const FirstLoadDispatchContext = createContext<Dispatch<{ firstLoad: boolean }> | null>(null);

export function ListSelectionProvider({children}: Readonly<{ children: React.ReactNode }>) {
  const [plotList, plotListDispatch] =
    useReducer<React.Reducer<Plot[] | null, LoadAction<Plot[]>>>(genericLoadReducer, []);

  const [quadratList, quadratListDispatch] =
    useReducer<React.Reducer<Quadrat[] | null, LoadAction<Quadrat[]>>>(genericLoadReducer, []);

  const [censusList, censusListDispatch] =
    useReducer<React.Reducer<Census[] | null, LoadAction<Census[]>>>(genericLoadReducer, []);

  const [firstLoad, firstLoadDispatch] = useReducer(
    firstLoadReducer,
    true
  )

  const enhancedPlotListDispatch = createEnhancedDispatch(plotListDispatch, 'plotList');
  const enhancedQuadratListDispatch = createEnhancedDispatch(quadratListDispatch, 'quadratList');
  const enhancedCensusListDispatch = createEnhancedDispatch(censusListDispatch, 'censusList');


  useEffect(() => {
    const fetchData = async () => {
      const plotListData: Plot[] | undefined = await getData('plotList');
      if (plotListData) await enhancedPlotListDispatch({plotList: plotListData});

      const quadratListData: Quadrat[] | undefined = await getData('quadratList');
      if (quadratListData) await enhancedQuadratListDispatch({quadratList: quadratListData});

      const censusListData: Census[] | undefined = await getData('censusList');
      if (censusListData) await enhancedCensusListDispatch({censusList: censusListData});
    };

    fetchData().catch(console.error);

    // // Set up polling
    // const interval = setInterval(fetchData, 10000); // Poll every 10 seconds
    //
    // return () => clearInterval(interval);
  }, []);


  return (
    <PlotListContext.Provider value={plotList}>
      <PlotListDispatchContext.Provider value={enhancedPlotListDispatch}>
        <QuadratListContext.Provider value={quadratList}>
          <QuadratListDispatchContext.Provider value={enhancedQuadratListDispatch}>
            <CensusListContext.Provider value={censusList}>
              <CensusListDispatchContext.Provider value={enhancedCensusListDispatch}>
                <FirstLoadContext.Provider value={firstLoad}>
                  <FirstLoadDispatchContext.Provider value={firstLoadDispatch}>
                    {children}
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