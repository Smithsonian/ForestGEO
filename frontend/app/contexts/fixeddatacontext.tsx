"use client";

import React, {createContext, Dispatch, SetStateAction, useContext, useEffect, useReducer} from "react";
import {
  AttributesRDS,
  CensusRDS,
  CoreMeasurementsRDS,
  PersonnelRDS,
  PlotRDS,
  QuadratsRDS,
  SpeciesRDS,
  SubSpeciesRDS
} from "@/config/sqlmacros";
import {getData, setData} from "@/config/db";
import {createEnhancedDispatch, genericLoadReducer, LoadAction} from "@/config/macros";


export const CoreMeasurementLoadContext = createContext<CoreMeasurementsRDS[] | null>(null);
export const AttributeLoadContext = createContext<AttributesRDS[] | null>(null);
export const CensusLoadContext = createContext<CensusRDS[] | null>(null);
export const PersonnelLoadContext = createContext<PersonnelRDS[] | null>(null);
export const QuadratsLoadContext = createContext<QuadratsRDS[] | null>(null);
export const SpeciesLoadContext = createContext<SpeciesRDS[] | null>(null);
export const SubSpeciesLoadContext = createContext<SubSpeciesRDS[] | null>(null);
export const PlotsLoadContext = createContext<PlotRDS[] | null>(null);
export const CoreMeasurementLoadDispatchContext = createContext<Dispatch<{
  coreMeasurementLoad: CoreMeasurementsRDS[] | null
}> | null>(null);
export const AttributeLoadDispatchContext = createContext<Dispatch<{
  attributeLoad: AttributesRDS[] | null
}> | null>(null);
export const CensusLoadDispatchContext = createContext<Dispatch<{
  censusLoad: CensusRDS[] | null
}> | null>(null);
export const PersonnelLoadDispatchContext = createContext<Dispatch<{
  personnelLoad: PersonnelRDS[] | null
}> | null>(null);
export const QuadratsLoadDispatchContext = createContext<Dispatch<{
  quadratsLoad: QuadratsRDS[] | null
}> | null>(null);
export const SpeciesLoadDispatchContext = createContext<Dispatch<{
  speciesLoad: SpeciesRDS[] | null
}> | null>(null);
export const SubSpeciesLoadDispatchContext = createContext<Dispatch<{
  subSpeciesLoad: SubSpeciesRDS[] | null
}> | null>(null);
export const PlotsLoadDispatchContext = createContext<Dispatch<{ plotsLoad: PlotRDS[] | null }> | null>(null);

export function FixedDataProvider({children}: { children: React.ReactNode }) {

  const [coreMeasurementLoad, coreMeasurementLoadDispatch] =
    useReducer<React.Reducer<CoreMeasurementsRDS[] | null, LoadAction<CoreMeasurementsRDS[]>>>(genericLoadReducer, null);

  const [attributeLoad, attributeLoadDispatch] =
    useReducer<React.Reducer<AttributesRDS[] | null, LoadAction<AttributesRDS[]>>>(genericLoadReducer, null);

  const [censusLoad, censusLoadDispatch] =
    useReducer<React.Reducer<CensusRDS[] | null, LoadAction<CensusRDS[]>>>(genericLoadReducer, null);

  const [personnelLoad, personnelLoadDispatch] =
    useReducer<React.Reducer<PersonnelRDS[] | null, LoadAction<PersonnelRDS[]>>>(genericLoadReducer, null);

  const [quadratsLoad, quadratsLoadDispatch] =
    useReducer<React.Reducer<QuadratsRDS[] | null, LoadAction<QuadratsRDS[]>>>(genericLoadReducer, null);

  const [speciesLoad, speciesLoadDispatch] =
    useReducer<React.Reducer<SpeciesRDS[] | null, LoadAction<SpeciesRDS[]>>>(genericLoadReducer, null);

  const [subSpeciesLoad, subSpeciesLoadDispatch] =
    useReducer<React.Reducer<SubSpeciesRDS[] | null, LoadAction<SubSpeciesRDS[]>>>(genericLoadReducer, null);

  const [plotsLoad, plotsLoadDispatch] =
    useReducer<React.Reducer<PlotRDS[] | null, LoadAction<PlotRDS[]>>>(genericLoadReducer, null);

  const enhancedCoreMeasurementLoadDispatch = createEnhancedDispatch(coreMeasurementLoadDispatch, 'coreMeasurementLoad');
  const enhancedAttributeLoadDispatch = createEnhancedDispatch(attributeLoadDispatch, 'attributeLoad');
  const enhancedCensusLoadDispatch = createEnhancedDispatch(censusLoadDispatch, 'censusLoad');
  const enhancedPersonnelLoadDispatch = createEnhancedDispatch(personnelLoadDispatch, 'personnelLoad');
  const enhancedQuadratsLoadDispatch = createEnhancedDispatch(quadratsLoadDispatch, 'quadratsLoad');
  const enhancedSpeciesLoadDispatch = createEnhancedDispatch(speciesLoadDispatch, 'speciesLoad');
  const enhancedSubSpeciesLoadDispatch = createEnhancedDispatch(subSpeciesLoadDispatch, 'subSpeciesLoad');
  const enhancedPlotsLoadDispatch = createEnhancedDispatch(plotsLoadDispatch, 'plotsLoad');

  useEffect(() => {
    const fetchData = async () => {
      const coreMeasurementLoad = await getData('coreMeasurementLoad');
      coreMeasurementLoadDispatch({type: 'coreMeasurementLoad', payload: coreMeasurementLoad});

      const attributeLoad = await getData('attributeLoad');
      attributeLoadDispatch({ type: 'attributeLoad', payload: attributeLoad });

      const censusLoad = await getData('censusLoad');
      censusLoadDispatch({type: 'censusLoad', payload: censusLoad});

      const personnelLoad = await getData('personnelLoad');
      personnelLoadDispatch({ type: 'personnelLoad', payload: personnelLoad });

      const quadratsLoad = await getData('quadratsLoad');
      quadratsLoadDispatch({type: 'quadratsLoad', payload: quadratsLoad});

      const speciesLoad = await getData('speciesLoad');
      speciesLoadDispatch({type: 'speciesLoad', payload: speciesLoad});

      const subSpeciesLoad = await getData('subSpeciesLoad');
      subSpeciesLoadDispatch({type: 'subSpeciesLoad', payload: subSpeciesLoad});

      const plotsLoad = await getData('plotsLoad');
      plotsLoadDispatch({type: 'plotsLoad', payload: plotsLoad});
    };

    fetchData().catch(console.error);
  }, []);

  return (
    <CoreMeasurementLoadContext.Provider value={coreMeasurementLoad}>
      <CoreMeasurementLoadDispatchContext.Provider value={enhancedCoreMeasurementLoadDispatch}>
        <AttributeLoadContext.Provider value={attributeLoad}>
          <AttributeLoadDispatchContext.Provider value={enhancedAttributeLoadDispatch}>
            <CensusLoadContext.Provider value={censusLoad}>
              <CensusLoadDispatchContext.Provider value={enhancedCensusLoadDispatch}>
                <PersonnelLoadContext.Provider value={personnelLoad}>
                  <PersonnelLoadDispatchContext.Provider value={enhancedPersonnelLoadDispatch}>
                    <QuadratsLoadContext.Provider value={quadratsLoad}>
                      <QuadratsLoadDispatchContext.Provider value={enhancedQuadratsLoadDispatch}>
                        <SpeciesLoadContext.Provider value={speciesLoad}>
                          <SpeciesLoadDispatchContext.Provider value={enhancedSpeciesLoadDispatch}>
                            <SubSpeciesLoadContext.Provider value={subSpeciesLoad}>
                              <SubSpeciesLoadDispatchContext.Provider value={enhancedSubSpeciesLoadDispatch}>
                                <PlotsLoadContext.Provider value={plotsLoad}>
                                  <PlotsLoadDispatchContext.Provider value={enhancedPlotsLoadDispatch}>
                                    {children}
                                  </PlotsLoadDispatchContext.Provider>
                                </PlotsLoadContext.Provider>
                              </SubSpeciesLoadDispatchContext.Provider>
                            </SubSpeciesLoadContext.Provider>
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
      </CoreMeasurementLoadDispatchContext.Provider>
    </CoreMeasurementLoadContext.Provider>
  );
}

function coreMeasurementLoadReducer(currentCoreMeasurementLoad: any, action: {
  coreMeasurementLoad: CoreMeasurementsRDS[] | null
}) {
  return action.coreMeasurementLoad;
}

function attributeLoadReducer(currentAttributeLoad: any, action: { attributeLoad: AttributesRDS[] | null }) {

  return action.attributeLoad;
}

function censusLoadReducer(currentCensusLoad: any, action: { censusLoad: CensusRDS[] | null }) {
  return action.censusLoad;
}

function personnelLoadReducer(currentPersonnelLoad: any, action: { personnelLoad: PersonnelRDS[] | null }) {
  return action.personnelLoad;
}

function quadratsLoadReducer(currentQuadratsLoad: any, action: { quadratsLoad: QuadratsRDS[] | null }) {
  return action.quadratsLoad;
}

function speciesLoadReducer(currentSpeciesLoad: any, action: { speciesLoad: SpeciesRDS[] | null }) {
  return action.speciesLoad;
}

function subSpeciesLoadReducer(currentSpeciesLoad: any, action: { subSpeciesLoad: SubSpeciesRDS[] | null }) {
  return action.subSpeciesLoad;
}

function plotsLoadReducer(currentPlotsLoad: any, action: { plotsLoad: PlotRDS[] | null }) {
  return action.plotsLoad;
}


export function useCoreMeasurementLoadContext() {
  return useContext(CoreMeasurementLoadContext);
}

export function useCoreMeasurementLoadDispatch() {
  return useContext(CoreMeasurementLoadDispatchContext);
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

export function useSubSpeciesLoadContext() {
  return useContext(SubSpeciesLoadContext);
}

export function useSubSpeciesLoadDispatch() {
  return useContext(SubSpeciesLoadDispatchContext);
}

export function usePlotsLoadContext() {
  return useContext(PlotsLoadContext);
}

export function usePlotsLoadDispatch() {
  return useContext(PlotsLoadDispatchContext);
}