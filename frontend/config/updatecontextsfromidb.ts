// useUpdateContextsFromIDB.ts
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch} from "@/app/contexts/coredataprovider";
import {useCensusListDispatch, usePlotListDispatch, useQuadratListDispatch} from "@/app/contexts/listselectionprovider";
import {clearDataByKey, getData, setData} from "@/config/db";
import {Census, Plot, Quadrat} from "@/config/macros";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";

async function createAndUpdateQuadratList(quadratsRDSLoad: QuadratsRDS[]) {
  let quadratList: Quadrat[] = quadratsRDSLoad.map(quadratRDS => ({
    quadratID: quadratRDS.quadratID || 0,
    plotID: quadratRDS.plotID || 0,
    quadratName: quadratRDS.quadratName || '',
  }));
  await setData('quadratList', quadratList);
}

// Helper function to create and update Plot list
async function createAndUpdatePlotList(plotRDSLoad: PlotRDS[], quadratsRDSLoad: QuadratsRDS[]) {
  let plotList: Plot[] = plotRDSLoad.map(plotRDS => ({
    key: plotRDS.plotName || '',
    num: quadratsRDSLoad.filter(quadrat => quadrat.plotID === plotRDS.plotID).length,
    id: plotRDS.plotID || 0,
  }));
  await setData('plotList', plotList);
}

// Helper function to create and update Census list
async function createAndUpdateCensusList(censusRDSLoad: CensusRDS[]) {
  let uniqueCensusMap = new Map();
  censusRDSLoad.forEach(censusRDS => {
    const plotCensusNumber = censusRDS?.plotCensusNumber || 0;
    let existingCensus = uniqueCensusMap.get(plotCensusNumber);
    if (!existingCensus) {
      uniqueCensusMap.set(plotCensusNumber, {
        plotID: censusRDS?.plotID || 0,
        plotCensusNumber,
        startDate: censusRDS?.startDate || new Date(),
        endDate: censusRDS?.endDate || null,  // Handle null endDate
        description: censusRDS?.description || ''
      });
    } else {
      existingCensus.startDate = new Date(Math.min(existingCensus.startDate.getTime(), new Date(censusRDS?.startDate || 0).getTime()));
      if (censusRDS?.endDate) {
        existingCensus.endDate = existingCensus.endDate
          ? new Date(Math.max(existingCensus.endDate.getTime(), new Date(censusRDS.endDate).getTime()))
          : new Date(censusRDS.endDate);  // Update endDate only if it's not null
      }
    }
  });
  let censusList: Census[] = Array.from(uniqueCensusMap.values());
  await setData('censusList', censusList);
}

async function fetchHash(endpoint: string) {
  const response = await fetch(endpoint, {method: 'GET'});
  if (!response.ok) throw new Error(`Failed to fetch hash from ${endpoint}`);
  return await response.json();
}

async function fetchData(endpoint: string) {
  const response = await fetch(endpoint, {method: 'GET'});
  if (!response.ok) throw new Error(`Failed to fetch data from ${endpoint}`);
  return await response.json();
}

async function checkHashAndUpdateData(hashEndpoint: string, dataEndpoint: string, localHashKey: string, dataKey: string) {
  // const serverHash = await fetchHash(hashEndpoint);
  // const localHash = await getData(localHashKey);

  // if (serverHash !== localHash) {
  //   const data = await fetchData(dataEndpoint);
  //   await setData(localHashKey, serverHash);
  //   await setData(dataKey, data);
  //   return data;
  // }

  // return await getData(dataKey);
  const data = await fetchData(dataEndpoint);
  await setData(dataKey, data);
  return data;
}

export async function clearAllHashes() {
  await clearDataByKey('quadratsHash');
  await clearDataByKey('plotsHash');
  await clearDataByKey('censusHash');
}

async function updateQuadratsIDB(schema: string) {
  const hashEndpoint = `/api/hash/quadrats?schema=${schema}`;
  const dataEndpoint = `/api/fetchall/quadrats?schema=${schema}`;

  const quadratsRDSLoad: QuadratsRDS[] = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'quadratsHash', 'quadratsLoad');
  await createAndUpdateQuadratList(quadratsRDSLoad);
}

async function updatePlotsIDB(schema: string) {
  const hashEndpoint = `/api/hash/plots?schema=${schema}`;
  const dataEndpoint = `/api/fetchall/plots?schema=${schema}`;
  const plotRDSLoad = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'plotsHash', 'plotsLoad');
  let quadratsRDSLoad: QuadratsRDS[] = await getData('quadratsLoad');
  if (!quadratsRDSLoad) {
    throw new Error('quadratsLoad IDB retrieval failed');
  }
  await createAndUpdatePlotList(plotRDSLoad, quadratsRDSLoad);
}

async function updateCensusIDB(schema: string) {
  const hashEndpoint = `/api/hash/census?schema=${schema}`;
  const dataEndpoint = `/api/fetchall/census?schema=${schema}`;
  let censusRDSLoad = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'censusHash', 'censusLoad');
  await createAndUpdateCensusList(censusRDSLoad);
}

export async function loadServerDataIntoIDB(dataType: string, schema: string) {
  switch (dataType) {
    case 'quadrats':
      return await updateQuadratsIDB(schema);
    case 'plots':
      return await updatePlotsIDB(schema);
    case 'census':
      return await updateCensusIDB(schema);
    default:
      throw new Error('incorrect data type provided to loadServerDataIntoIDB, verify');
  }
}

interface UpdateContextsIDBProps {
  email: string;
  schema: string;
}

const UpdateContextsFromIDB = ({email, schema}: UpdateContextsIDBProps) => {
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const censusListDispatch = useCensusListDispatch();

  const updateQuadratsContext = async () => {
    // IDB load stored separately: QUADRATS
    await loadServerDataIntoIDB('quadrats', schema);
    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData: QuadratsRDS[] = await getData('quadratsLoad');
    if (!quadratsLoadData || quadratsLoadData.length === 0) throw new Error('quadratsLoad data failed');
    if (quadratsLoadDispatch) await quadratsLoadDispatch({quadratsLoad: quadratsLoadData});
    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');
    if (!quadratList || quadratList.length === 0) throw new Error('quadratsList data failed');
    if (quadratListDispatch) await quadratListDispatch({quadratList: quadratList});
  };

  const updateCensusContext = async () => {
    // IDB load stored separately: CENSUS
    await loadServerDataIntoIDB('census', schema);
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad || censusRDSLoad.length === 0) throw new Error('censusLoad data failed');
    if (censusLoadDispatch) await censusLoadDispatch({censusLoad: censusRDSLoad});
    const censusListData: Census[] = await getData('censusList');
    if (!censusListData || censusListData.length === 0) throw new Error('censusList data failed');
    if (censusListDispatch) await censusListDispatch({censusList: censusListData});
  }

  const updatePlotsContext = async () => {
    // IDB load stored separately: PLOTS
    await loadServerDataIntoIDB('plots', schema);
    // Check if plotsLoad data is available in localStorage
    const plotsLoadData: PlotRDS[] = await getData('plotsLoad');
    if (!plotsLoadData || plotsLoadData.length === 0) throw new Error('plotsLoad data failed');
    if (plotsLoadDispatch) await plotsLoadDispatch({plotsLoad: plotsLoadData});
    // Check if plotList data is available in localStorage
    const plotListData: Plot[] = await getData('plotList');
    if (!plotListData || plotListData.length === 0) throw new Error('plotList data failed');
    if (plotsListDispatch) await plotsListDispatch({plotList: plotListData});
  }

  return {updateQuadratsContext, updateCensusContext, updatePlotsContext};
};

export default UpdateContextsFromIDB;
