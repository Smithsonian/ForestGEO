// useUpdateContextsFromIDB.ts
import { useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch } from "@/app/contexts/coredataprovider";
import { useCensusListDispatch, usePlotListDispatch, useQuadratListDispatch } from "@/app/contexts/listselectionprovider";
import { getData } from "@/config/db";
import {loadServerDataIntoIDB} from "@/components/client/clientmacros";
import {Census, Plot, Quadrat} from "@/config/macros";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";

const UpdateContextsFromIDB = () => {
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const censusListDispatch = useCensusListDispatch();

  const updateQuadratsContext = async () => {
    // IDB load stored separately: QUADRATS
    await loadServerDataIntoIDB('quadrats');
    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData: QuadratsRDS[] = await getData('quadratsLoad');
    if (!quadratsLoadData || quadratsLoadData.length === 0) throw new Error('quadratsLoad data failed');
    if (quadratsLoadDispatch) quadratsLoadDispatch({quadratsLoad: quadratsLoadData});
    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');
    if (!quadratList || quadratList.length === 0) throw new Error('quadratsList data failed');
    if (quadratListDispatch) quadratListDispatch({quadratList: quadratList});
  };

  const updateCensusContext = async () => {
    // IDB load stored separately: CENSUS
    await loadServerDataIntoIDB('census');
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad || censusRDSLoad.length === 0) throw new Error('censusLoad data failed');
    if (censusLoadDispatch) censusLoadDispatch({censusLoad: censusRDSLoad});
    const censusListData: Census[] = await getData('censusList');
    if (!censusListData || censusListData.length === 0) throw new Error('censusList data failed');
    if (censusListDispatch) censusListDispatch({censusList: censusListData});
  }

  const updatePlotsContext = async () => {
    // IDB load stored separately: PLOTS
    await loadServerDataIntoIDB('plots');
    // Check if plotsLoad data is available in localStorage
    const plotsLoadData: PlotRDS[] = await getData('plotsLoad');
    if (!plotsLoadData || plotsLoadData.length === 0) throw new Error('plotsLoad data failed');
    if (plotsLoadDispatch) plotsLoadDispatch({plotsLoad: plotsLoadData});
    // Check if plotList data is available in localStorage
    const plotListData: Plot[] = await getData('plotList');
    if (!plotListData || plotListData.length === 0) throw new Error('plotList data failed');
    if (plotsListDispatch) plotsListDispatch({plotList: plotListData});
  }

  return { updateQuadratsContext, updateCensusContext, updatePlotsContext };
};

export default UpdateContextsFromIDB;
