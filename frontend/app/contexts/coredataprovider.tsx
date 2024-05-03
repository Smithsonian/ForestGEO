"use client";

import React, { createContext, useContext, useEffect, useReducer } from "react";
import { SpeciesRDS } from '@/config/sqlrdsdefinitions/tables/speciesrds';
import { QuadratsRDS } from '@/config/sqlrdsdefinitions/tables/quadratrds';
import { PlotRDS } from '@/config/sqlrdsdefinitions/tables/plotrds';
import { PersonnelRDS } from '@/config/sqlrdsdefinitions/tables/personnelrds';
import { CoreMeasurementsRDS } from '@/config/sqlrdsdefinitions/tables/coremeasurementsrds';
import { CensusRDS } from '@/config/sqlrdsdefinitions/tables/censusrds';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/tables/attributerds';
import { getData } from "@/config/db";
import {
  createEnhancedDispatch,
  EnhancedDispatch,
  genericLoadReducer,
  LoadAction
} from "@/config/macros/contextreducers";

export const CoreMeasurementLoadContext = createContext<CoreMeasurementsRDS[] | null>(null);
export const AttributeLoadContext = createContext<AttributesRDS[] | null>(null);
export const CensusLoadContext = createContext<CensusRDS[] | null>(null);
export const PersonnelLoadContext = createContext<PersonnelRDS[] | null>(null);
export const QuadratsLoadContext = createContext<QuadratsRDS[] | null>(null);
export const SpeciesLoadContext = createContext<SpeciesRDS[] | null>(null);
export const PlotsLoadContext = createContext<PlotRDS[] | null>(null);
export const CoreMeasurementLoadDispatchContext = createContext<EnhancedDispatch<CoreMeasurementsRDS[]> | null>(null);
export const AttributeLoadDispatchContext = createContext<EnhancedDispatch<AttributesRDS[]> | null>(null);
export const CensusLoadDispatchContext = createContext<EnhancedDispatch<CensusRDS[]> | null>(null);
export const PersonnelLoadDispatchContext = createContext<EnhancedDispatch<PersonnelRDS[]> | null>(null);
export const QuadratsLoadDispatchContext = createContext<EnhancedDispatch<QuadratsRDS[]> | null>(null);
export const SpeciesLoadDispatchContext = createContext<EnhancedDispatch<SpeciesRDS[]> | null>(null);
export const PlotsLoadDispatchContext = createContext<EnhancedDispatch<PlotRDS[]> | null>(null);

export function CoreDataProvider({ children }: Readonly<{ children: React.ReactNode }>) {

  const [coreMeasurementLoad, coreMeasurementLoadDispatch] =
    useReducer<React.Reducer<CoreMeasurementsRDS[] | null, LoadAction<CoreMeasurementsRDS[]>>>(genericLoadReducer, []);

  const [attributeLoad, attributeLoadDispatch] =
    useReducer<React.Reducer<AttributesRDS[] | null, LoadAction<AttributesRDS[]>>>(genericLoadReducer, []);

  const [censusLoad, censusLoadDispatch] =
    useReducer<React.Reducer<CensusRDS[] | null, LoadAction<CensusRDS[]>>>(genericLoadReducer, []);

  const [personnelLoad, personnelLoadDispatch] =
    useReducer<React.Reducer<PersonnelRDS[] | null, LoadAction<PersonnelRDS[]>>>(genericLoadReducer, []);

  const [quadratsLoad, quadratsLoadDispatch] =
    useReducer<React.Reducer<QuadratsRDS[] | null, LoadAction<QuadratsRDS[]>>>(genericLoadReducer, []);

  const [speciesLoad, speciesLoadDispatch] =
    useReducer<React.Reducer<SpeciesRDS[] | null, LoadAction<SpeciesRDS[]>>>(genericLoadReducer, []);

  const [plotsLoad, plotsLoadDispatch] =
    useReducer<React.Reducer<PlotRDS[] | null, LoadAction<PlotRDS[]>>>(genericLoadReducer, []);

  const enhancedCoreMeasurementLoadDispatch = createEnhancedDispatch(coreMeasurementLoadDispatch, 'coreMeasurementLoad');
  const enhancedAttributeLoadDispatch = createEnhancedDispatch(attributeLoadDispatch, 'attributeLoad');
  const enhancedCensusLoadDispatch = createEnhancedDispatch(censusLoadDispatch, 'censusLoad');
  const enhancedPersonnelLoadDispatch = createEnhancedDispatch(personnelLoadDispatch, 'personnelLoad');
  const enhancedQuadratsLoadDispatch = createEnhancedDispatch(quadratsLoadDispatch, 'quadratsLoad');
  const enhancedSpeciesLoadDispatch = createEnhancedDispatch(speciesLoadDispatch, 'speciesLoad');
  const enhancedPlotsLoadDispatch = createEnhancedDispatch(plotsLoadDispatch, 'plotsLoad');

  useEffect(() => {
    const fetchData = async () => {
      const coreMeasurementLoad = await getData('coreMeasurementLoad');
      coreMeasurementLoadDispatch({ type: 'coreMeasurementLoad', payload: coreMeasurementLoad });

      const attributeLoad = await getData('attributeLoad');
      attributeLoadDispatch({ type: 'attributeLoad', payload: attributeLoad });

      const censusLoad = await getData('censusLoad');
      censusLoadDispatch({ type: 'censusLoad', payload: censusLoad });

      const personnelLoad = await getData('personnelLoad');
      personnelLoadDispatch({ type: 'personnelLoad', payload: personnelLoad });

      const quadratsLoad = await getData('quadratsLoad');
      quadratsLoadDispatch({ type: 'quadratsLoad', payload: quadratsLoad });

      const speciesLoad = await getData('speciesLoad');
      speciesLoadDispatch({ type: 'speciesLoad', payload: speciesLoad });

      const plotsLoad = await getData('plotsLoad');
      plotsLoadDispatch({ type: 'plotsLoad', payload: plotsLoad });
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
                            <PlotsLoadContext.Provider value={plotsLoad}>
                              <PlotsLoadDispatchContext.Provider value={enhancedPlotsLoadDispatch}>
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
      </CoreMeasurementLoadDispatchContext.Provider>
    </CoreMeasurementLoadContext.Provider>
  );
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

export function usePlotsLoadContext() {
  return useContext(PlotsLoadContext);
}

export function usePlotsLoadDispatch() {
  return useContext(PlotsLoadDispatchContext);
}