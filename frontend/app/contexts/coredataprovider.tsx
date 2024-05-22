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

export const CoreMeasurementLoadContext = createContext<CoreMeasurementsRDS[] | undefined>(undefined);
export const AttributeLoadContext = createContext<AttributesRDS[] | undefined>(undefined);
export const CensusLoadContext = createContext<CensusRDS[] | undefined>(undefined);
export const PersonnelLoadContext = createContext<PersonnelRDS[] | undefined>(undefined);
export const QuadratsLoadContext = createContext<QuadratsRDS[] | undefined>(undefined);
export const SpeciesLoadContext = createContext<SpeciesRDS[] | undefined>(undefined);
export const PlotsLoadContext = createContext<PlotRDS[] | undefined>(undefined);
export const CoreMeasurementLoadDispatchContext = createContext<EnhancedDispatch<CoreMeasurementsRDS[]> | undefined>(undefined);
export const AttributeLoadDispatchContext = createContext<EnhancedDispatch<AttributesRDS[]> | undefined>(undefined);
export const CensusLoadDispatchContext = createContext<EnhancedDispatch<CensusRDS[]> | undefined>(undefined);
export const PersonnelLoadDispatchContext = createContext<EnhancedDispatch<PersonnelRDS[]> | undefined>(undefined);
export const QuadratsLoadDispatchContext = createContext<EnhancedDispatch<QuadratsRDS[]> | undefined>(undefined);
export const SpeciesLoadDispatchContext = createContext<EnhancedDispatch<SpeciesRDS[]> | undefined>(undefined);
export const PlotsLoadDispatchContext = createContext<EnhancedDispatch<PlotRDS[]> | undefined>(undefined);

export function CoreDataProvider({ children }: Readonly<{ children: React.ReactNode }>) {

  const [coreMeasurementLoad, coreMeasurementLoadDispatch] =
    useReducer<React.Reducer<CoreMeasurementsRDS[] | undefined, LoadAction<CoreMeasurementsRDS[]>>>(genericLoadReducer, []);

  const [attributeLoad, attributeLoadDispatch] =
    useReducer<React.Reducer<AttributesRDS[] | undefined, LoadAction<AttributesRDS[]>>>(genericLoadReducer, []);

  const [censusLoad, censusLoadDispatch] =
    useReducer<React.Reducer<CensusRDS[] | undefined, LoadAction<CensusRDS[]>>>(genericLoadReducer, []);

  const [personnelLoad, personnelLoadDispatch] =
    useReducer<React.Reducer<PersonnelRDS[] | undefined, LoadAction<PersonnelRDS[]>>>(genericLoadReducer, []);

  const [quadratsLoad, quadratsLoadDispatch] =
    useReducer<React.Reducer<QuadratsRDS[] | undefined, LoadAction<QuadratsRDS[]>>>(genericLoadReducer, []);

  const [speciesLoad, speciesLoadDispatch] =
    useReducer<React.Reducer<SpeciesRDS[] | undefined, LoadAction<SpeciesRDS[]>>>(genericLoadReducer, []);

  const [plotsLoad, plotsLoadDispatch] =
    useReducer<React.Reducer<PlotRDS[] | undefined, LoadAction<PlotRDS[]>>>(genericLoadReducer, []);

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