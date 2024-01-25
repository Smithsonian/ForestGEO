"use client";

import {useState} from "react";
import {
  useAttributeLoadDispatch,
  useCensusLoadDispatch,
  useCoreMeasurementLoadDispatch,
  usePersonnelLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch,
  useSpeciesLoadDispatch,
  useSubSpeciesLoadDispatch
} from "@/app/contexts/coredataprovider";
import {usePlotListDispatch, useQuadratListDispatch} from "@/app/contexts/listselectionprovider";
import {clearAllIDBData, getData, setData} from "@/config/db";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";
import {Plot, Quadrat} from "@/config/macros";
import {LoadingButton} from "@mui/lab";
import {usePlotContext} from "@/app/contexts/userselectionprovider";

interface FetchAllDataButtonProps {
  onStartFetching: () => void;
  onEndFetching: () => void;
  isFetchingData: boolean;
}

export default function FetchAllDataButton({isFetchingData, onStartFetching, onEndFetching}: FetchAllDataButtonProps) {
  const coreMeasurementLoadDispatch = useCoreMeasurementLoadDispatch();
  const attributeLoadDispatch = useAttributeLoadDispatch();
  const censusLoadDispatch = useCensusLoadDispatch();
  const personnelLoadDispatch = usePersonnelLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const speciesLoadDispatch = useSpeciesLoadDispatch();
  const subSpeciesLoadDispatch = useSubSpeciesLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const [loading, setLoading] = useState(0);
  const currentPlot = usePlotContext();

  async function fetchData(url: string, dispatch: Function | null, actionType: string) {
    const response = await fetch(url, {method: 'GET'});
    if (dispatch) {
      const responseData = await response.json();
      dispatch({[actionType]: responseData});
    }
  }

  async function fetchAndDispatchQuadrats() {
    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData = await getData('quadratsLoad');
    let quadratsRDSLoad: QuadratsRDS[];

    if (quadratsLoadData) {
      quadratsRDSLoad = quadratsLoadData;
    } else {
      const response = await fetch('/api/fetchall/quadrats', {method: 'GET'});
      quadratsRDSLoad = await response.json();
      await setData('quadratsLoad', quadratsRDSLoad); // Save to IndexedDB
    }

    if (quadratsLoadDispatch) {
      quadratsLoadDispatch({quadratsLoad: quadratsRDSLoad});
    }

    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');

    if (!quadratList) {
      // Generate quadratList from quadratsRDSLoad if not in IndexedDB
      quadratList = quadratsRDSLoad.map((quadratRDS) => ({
        quadratID: quadratRDS.quadratID ? quadratRDS.quadratID : 0,
        plotID: quadratRDS.plotID ? quadratRDS.plotID : 0,
        quadratName: quadratRDS.quadratName ? quadratRDS.quadratName : '',
      }));
      await setData('quadratList', quadratList); // Save to IndexedDB
    }
    if (quadratListDispatch) {
      quadratListDispatch({quadratList: quadratList});
    }
  }

  async function fetchAndDispatchCensus() {
    // Check if censusLoad data is available in IndexedDB
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad) {
      // Fetch data from the server if not in IndexedDB
      const response = await fetch('/api/fixeddata/census', {method: 'GET'});
      censusRDSLoad = await response.json();
      await setData('censusLoad', censusRDSLoad); // Save to IndexedDB
    }

    if (censusLoadDispatch) {
      censusLoadDispatch({censusLoad: censusRDSLoad});
    }
  }

  async function fetchAndDispatchPlots() {
    // Check if plotsLoad data is available in localStorage
    const plotsLoadData = await getData('plotsLoad');
    let plotRDSLoad: PlotRDS[];
    if (plotsLoadData) {
      // Use data from localStorage if available
      plotRDSLoad = plotsLoadData;
    } else {
      // Fetch data from the server if not in localStorage
      const response = await fetch('/api/fetchall/plots', {method: 'GET'});
      plotRDSLoad = await response.json();
      await setData('plotsLoad', plotRDSLoad);
    }

    if (plotsLoadDispatch) {
      plotsLoadDispatch({plotsLoad: plotRDSLoad});
    }

    // Check if plotList data is available in localStorage
    const plotListData = await getData('plotList');
    let plotList: Plot[];
    if (plotListData) {
      // Use data from localStorage if available
      plotList = plotListData;
    } else {
      // Generate plotList from plotRDSLoad if not in localStorage
      plotList = plotRDSLoad.map((plotRDS) => ({
        key: plotRDS.plotName ? plotRDS.plotName : '',
        num: quadratsLoadDispatch ? quadratsLoadDispatch.length : 0,
        id: plotRDS.plotID ? plotRDS.plotID : 0,
      }));
      await setData('plotList', plotList);
    }

    if (plotsListDispatch) {
      plotsListDispatch({plotList: plotList});
    }
  }

  async function fetchDataEffect() {
    try {
      onStartFetching();
      await clearAllIDBData();
      setLoading(10);
      const coreMeasurementLoadData = await getData('coreMeasurementLoad');
      if (coreMeasurementLoadData && coreMeasurementLoadDispatch) {
        coreMeasurementLoadDispatch({coreMeasurementLoad: coreMeasurementLoadData});
      } else {
        await fetchData('/api/coremeasurements', coreMeasurementLoadDispatch, 'coreMeasurementLoad');
      }
      setLoading(20);
      const attributeLoadData = await getData('attributeLoad');
      if (attributeLoadData && attributeLoadDispatch) {
        attributeLoadDispatch({attributeLoad: attributeLoadData});
      } else {
        await fetchData('/api/fixeddata/attributes', attributeLoadDispatch, 'attributeLoad');
      }
      setLoading(30);
      const personnelLoadData = await getData('personnelLoad');
      if (personnelLoadData && personnelLoadDispatch) {
        personnelLoadDispatch({personnelLoad: personnelLoadData});
      } else {
        await fetchData('/api/fixeddata/personnel', personnelLoadDispatch, 'personnelLoad');
      }
      setLoading(40);
      const speciesLoadData = await getData('speciesLoad');
      if (speciesLoadData && speciesLoadDispatch) {
        speciesLoadDispatch({speciesLoad: speciesLoadData});
      } else {
        await fetchData('/api/fixeddata/species', speciesLoadDispatch, 'speciesLoad');
      }
      setLoading(50);
      const subSpeciesLoadData = await getData('subSpeciesLoad');
      if (subSpeciesLoadData && subSpeciesLoadDispatch) {
        subSpeciesLoadDispatch({subSpeciesLoad: subSpeciesLoadData});
      } else {
        await fetchData('/api/fixeddata/subspecies', subSpeciesLoadDispatch, 'subSpeciesLoad');
      }
      setLoading(60);
      await fetchAndDispatchPlots();
      setLoading(75);
      await fetchAndDispatchCensus();
      setLoading(90);
      await fetchAndDispatchQuadrats();
      setLoading(100);
    } catch (error) {
      console.error(error);
    } finally {
      onEndFetching();
    }
  }

  return (
    <LoadingButton disabled={!currentPlot} loading={isFetchingData} onClick={fetchDataEffect} loadingPosition={"start"}>
      Synchronize From Server
    </LoadingButton>
  );

}