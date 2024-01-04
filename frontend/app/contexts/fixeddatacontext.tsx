"use client";

import React, {createContext, Dispatch, useContext, useReducer} from "react";
import {GridValidRowModel} from "@mui/x-data-grid";

export const AttributeLoadContext = createContext<GridValidRowModel[] | null>(null);
export const CensusLoadContext = createContext<GridValidRowModel[] | null>(null);
export const PersonnelLoadContext = createContext<GridValidRowModel[] | null>(null);
export const QuadratsLoadContext = createContext<GridValidRowModel[] | null>(null);
export const SpeciesLoadContext = createContext<GridValidRowModel[] | null>(null);
export const PlotsLoadContext = createContext<GridValidRowModel[] | null>(null);
export const AttributeLoadDispatchContext = createContext<Dispatch<{
  attributeLoad: GridValidRowModel[] | null
}> | null>(null);
export const CensusLoadDispatchContext = createContext<Dispatch<{
  censusLoad: GridValidRowModel[] | null
}> | null>(null);
export const PersonnelLoadDispatchContext = createContext<Dispatch<{
  personnelLoad: GridValidRowModel[] | null
}> | null>(null);
export const QuadratsLoadDispatchContext = createContext<Dispatch<{
  quadratsLoad: GridValidRowModel[] | null
}> | null>(null);
export const SpeciesLoadDispatchContext = createContext<Dispatch<{
  speciesLoad: GridValidRowModel[] | null
}> | null>(null);
export const PlotsLoadDispatchContext = createContext<Dispatch<{ plotsLoad: GridValidRowModel[] | null }> | null>(null);

export function FixedDataProvider({children}: { children: React.ReactNode }) {
  const [attributeLoad, attributeLoadDispatch] = useReducer(
    attributeLoadReducer,
    null
  )
  
  const [censusLoad, censusLoadDispatch] = useReducer(
    censusLoadReducer,
    null
  )
  const [personnelLoad, personnelLoadDispatch] = useReducer(
    personnelLoadReducer,
    null
  )
  const [quadratsLoad, quadratsLoadDispatch] = useReducer(
    quadratsLoadReducer,
    null
  )
  const [speciesLoad, speciesLoadDispatch] = useReducer(
    speciesLoadReducer,
    null
  )
  
  const [plotsLoad, plotsLoadDispatch] = useReducer(
    plotsLoadReducer,
    null
  )
  
  return (
    <AttributeLoadContext.Provider value={attributeLoad}>
      <AttributeLoadDispatchContext.Provider value={attributeLoadDispatch}>
        <CensusLoadContext.Provider value={censusLoad}>
          <CensusLoadDispatchContext.Provider value={censusLoadDispatch}>
            <PersonnelLoadContext.Provider value={personnelLoad}>
              <PersonnelLoadDispatchContext.Provider value={personnelLoadDispatch}>
                <QuadratsLoadContext.Provider value={quadratsLoad}>
                  <QuadratsLoadDispatchContext.Provider value={quadratsLoadDispatch}>
                    <SpeciesLoadContext.Provider value={speciesLoad}>
                      <SpeciesLoadDispatchContext.Provider value={speciesLoadDispatch}>
                        <PlotsLoadContext.Provider value={plotsLoad}>
                          <PlotsLoadDispatchContext.Provider value={plotsLoadDispatch}>
                            {children}
                          </PlotsLoadDispatchContext.Provider>
                        </PlotsLoadContext.Provider>
                      </SpeciesLoadDispatchContext.Provider>
                    </SpeciesLoadContext.Provider>
                  </QuadratsLoadDispatchContext.Provider>
                </QuadratsLoadContext.Provider>
              </PersonnelLoadDispatchContext.Provider>
            </PersonnelLoadContext.Provider>
          </CensusLoadDispatchContext.Provider>
        </CensusLoadContext.Provider>
      </AttributeLoadDispatchContext.Provider>
    </AttributeLoadContext.Provider>
  );
}

function attributeLoadReducer(currentAttributeLoad: any, action: { attributeLoad: GridValidRowModel[] | null }) {
  return action.attributeLoad;
}

function censusLoadReducer(currentCensusLoad: any, action: { censusLoad: GridValidRowModel[] | null }) {
  return action.censusLoad;
}

function personnelLoadReducer(currentPersonnelLoad: any, action: { personnelLoad: GridValidRowModel[] | null }) {
  return action.personnelLoad;
}

function quadratsLoadReducer(currentQuadratsLoad: any, action: { quadratsLoad: GridValidRowModel[] | null }) {
  return action.quadratsLoad;
}

function speciesLoadReducer(currentSpeciesLoad: any, action: { speciesLoad: GridValidRowModel[] | null }) {
  return action.speciesLoad;
}

function plotsLoadReducer(currentPlotsLoad: any, action: { plotsLoad: GridValidRowModel[] | null }) {
  return action.plotsLoad;
}

export function useAttributeLoadContext() {
  return useContext(AttributeLoadContext);
}

export function useAttributeLoadDispatch() {
  return useContext(AttributeLoadDispatchContext);
}

export function useCensusLoadContext() {
  return useContext(CensusLoadContext);
}

export function useCensusLoadDispatch() {
  return useContext(CensusLoadDispatchContext);
}

export function usePersonnelLoadContext() {
  return useContext(PersonnelLoadContext);
}

export function usePersonnelLoadDispatch() {
  return useContext(PersonnelLoadDispatchContext);
}

export function useQuadratsLoadContext() {
  return useContext(QuadratsLoadContext);
}

export function useQuadratsLoadDispatch() {
  return useContext(QuadratsLoadDispatchContext);
}

export function useSpeciesLoadContext() {
  return useContext(SpeciesLoadContext);
}

export function useSpeciesLoadDispatch() {
  return useContext(SpeciesLoadDispatchContext);
}

export function usePlotsLoadContext() {
  return useContext(PlotsLoadContext);
}

export function usePlotsLoadDispatch() {
  return useContext(PlotsLoadDispatchContext);
}