"use client";
import React, {createContext, Dispatch, useContext, useReducer} from 'react';
import {Plot, plots} from "@/config/macros";

const initialState: Plot = {key: 'none', num: 0};
const initialCarousel = true;
export const PlotsContext = createContext<Plot | null>(null);
export const PlotsDispatchContext = createContext<Dispatch<{plotKey: string}> | null>(null);

export const CarouselContext = createContext<boolean | null>(null);
export const CarouselDispatchContext = createContext<Dispatch<{toggle: string}> | null>(null);

export function PlotsProvider({ children }: {children: React.ReactNode}) {
  const [tasks, dispatch] = useReducer(
    plotsReducer,
    initialState
  );
  
  const [carousel, dispatchCarousel] = useReducer(
    carouselReducer,
    initialCarousel
  );
  
  return (
    <PlotsContext.Provider value={tasks}>
      <PlotsDispatchContext.Provider value={dispatch}>
        <CarouselContext.Provider value={carousel}>
          <CarouselDispatchContext.Provider value={dispatchCarousel}>
            {children}
          </CarouselDispatchContext.Provider>
        </CarouselContext.Provider>
      </PlotsDispatchContext.Provider>
    </PlotsContext.Provider>
  );
}

function plotsReducer(currentPlot: any, action: {plotKey: string}) {
  if (plots.find((p) => p.key === action.plotKey)) return plots.find((p) => p.key === action.plotKey);
  else return currentPlot;
}

function carouselReducer(currentCarouselState: boolean, action: {toggle: string}) {
  return (action.toggle === "toggle") ? !currentCarouselState : currentCarouselState;
}

export function usePlotContext() {
  return useContext(PlotsContext);
}

export function usePlotDispatch() {
  return useContext(PlotsDispatchContext);
}

export function useCarouselContext() {
  return useContext(CarouselContext);
}

export function useCarouselDispatchContext() {
  return useContext(CarouselDispatchContext);
}