// useUpdateContextsFromIDB.ts
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch} from "@/app/contexts/coredataprovider";
import {
  useCensusListDispatch,
  useQuadratListDispatch,
  useSubquadratListDispatch
} from "@/app/contexts/listselectionprovider";
import {clearDataByKey, getData, setData} from "@/config/db";
import {CensusRDS} from "./sqlrdsdefinitions/tables/censusrds";
import {Quadrat, QuadratsRDS} from "./sqlrdsdefinitions/tables/quadratrds";
import {Plot, PlotRDS} from "./sqlrdsdefinitions/tables/plotrds";
import {Subquadrat} from "./sqlrdsdefinitions/tables/subquadratrds";

// Helper function to create and update Census list
async function createAndUpdateCensusList(censusRDSLoad: CensusRDS[]) {
  let uniqueCensusMap = new Map();

  censusRDSLoad.forEach((censusRDS) => {
    const plotCensusNumber = censusRDS?.plotCensusNumber || 0;
    let existingCensus = uniqueCensusMap.get(plotCensusNumber);

    if (!existingCensus) {
      // Initialize the new census entry with properly handled date conversions
      uniqueCensusMap.set(plotCensusNumber, {
        plotID: censusRDS?.plotID || 0,
        plotCensusNumber,
        startDate: censusRDS?.startDate ? new Date(censusRDS.startDate) : null,
        endDate: censusRDS?.endDate ? new Date(censusRDS.endDate) : null,
        description: censusRDS?.description || ''
      });
    } else {
      // Safely update the start date if it exists
      if (censusRDS?.startDate) {
        const newStartDate = new Date(censusRDS.startDate);
        existingCensus.startDate = existingCensus.startDate
          ? new Date(Math.min(existingCensus.startDate.getTime(), newStartDate.getTime()))
          : newStartDate;
      }

      // Safely update the end date if it exists
      if (censusRDS?.endDate) {
        const newEndDate = new Date(censusRDS.endDate);
        existingCensus.endDate = existingCensus.endDate
          ? new Date(Math.max(existingCensus.endDate.getTime(), newEndDate.getTime()))
          : newEndDate;
      }
    }
  });

  // Convert map to array and save data
  let censusList: CensusRDS[] = Array.from(uniqueCensusMap.values());
  await setData('censusList', censusList);
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

  await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'quadratsHash', 'quadratsLoad');
}

async function updatePlotsIDB(schema: string) {
  const hashEndpoint = `/api/hash/plots?schema=${schema}`;
  const dataEndpoint = `/api/fetchall/plots?schema=${schema}`;
  await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'plotsHash', 'plotsLoad');
}

async function updateCensusIDB(schema: string) {
  const hashEndpoint = `/api/hash/census?schema=${schema}`;
  const dataEndpoint = `/api/fetchall/census?schema=${schema}`;
  let censusRDSLoad = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'censusHash', 'censusLoad');
  await createAndUpdateCensusList(censusRDSLoad);
}

async function updateSubquadratsIDB(schema: string) {
  const hashEndpoint = `/api/hash/subquadrats?schema=${schema}`;
  const dataEndpoint = `/api/fetchall/subquadrats?schema=${schema}`;
  await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'subquadratsHash', 'subquadratList'); // don't need to do additional processing so can send directly to IDB and exit
}



export async function loadServerDataIntoIDB(dataType: string, schema: string) {
  switch (dataType) {
    case 'quadrats':
      return await updateQuadratsIDB(schema);
    case 'plots':
      return await updatePlotsIDB(schema);
    case 'census':
      return await updateCensusIDB(schema);
    case 'subquadrats':
      return await updateSubquadratsIDB(schema);
    default:
      throw new Error('incorrect data type provided to loadServerDataIntoIDB, verify');
  }
}

interface UpdateContextsIDBProps {
  schema: string;
}

const UpdateContextsFromIDB = ({schema}: UpdateContextsIDBProps) => {
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const censusListDispatch = useCensusListDispatch();
  const subquadratListDispatch = useSubquadratListDispatch();

  const updateQuadratsContext = async () => {
    // IDB load stored separately: QUADRATS
    await loadServerDataIntoIDB('quadrats', schema);
    await loadServerDataIntoIDB('subquadrats', schema);
    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData: QuadratsRDS[] = await getData('quadratsLoad');
    if (!quadratsLoadData || quadratsLoadData.length === 0) throw new Error('quadratsLoad data failed');
    if (quadratsLoadDispatch) await quadratsLoadDispatch({quadratsLoad: quadratsLoadData});
    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');
    if (!quadratList || quadratList.length === 0) throw new Error('quadratsList data failed');
    if (quadratListDispatch) await quadratListDispatch({quadratList: quadratList});
    // gonna roll subquadrats upload into this function too, don't need to customize that far
    let subquadratList: Subquadrat[] = await getData('subquadratList');
    if (!subquadratList || subquadratList.length === 0) throw new Error('subquadratList data failed');
    if (subquadratListDispatch) await subquadratListDispatch({subquadratList: subquadratList});
  };

  const updateCensusContext = async () => {
    // IDB load stored separately: CENSUS
    await loadServerDataIntoIDB('census', schema);
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad || censusRDSLoad.length === 0) throw new Error('censusLoad data failed');
    if (censusLoadDispatch) await censusLoadDispatch({censusLoad: censusRDSLoad});
    const censusListData: CensusRDS[] = await getData('censusList');
    if (!censusListData || censusListData.length === 0) throw new Error('censusList data failed');
    if (censusListDispatch) await censusListDispatch({censusList: censusListData});
  };

  const updatePlotsContext = async () => {
    console.log('updatePlotsContext');
    // IDB load stored separately: PLOTS
    await loadServerDataIntoIDB('plots', schema);
    // Check if plotsLoad data is available in localStorage
    const plotsLoadData: PlotRDS[] = await getData('plotsLoad');
    if (!plotsLoadData || plotsLoadData.length === 0) throw new Error('plotsLoad data failed');
    if (plotsLoadDispatch) await plotsLoadDispatch({plotsLoad: plotsLoadData});
  };

  return {updateQuadratsContext, updateCensusContext, updatePlotsContext};
};

export default UpdateContextsFromIDB;
