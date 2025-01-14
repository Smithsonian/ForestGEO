// useUpdateContextsFromIDB.ts
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch } from '@/app/contexts/listselectionprovider';
import { getData, setData } from '@/config/db';
import { PlotRDS, QuadratRDS } from '@/config/sqlrdsdefinitions/zones';
import { CensusRDS, createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';

async function fetchData(endpoint: string): Promise<any> {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Network response was not ok');
  return await response.json();
}

async function updateData(endpoint: string, idbKey: string, processFunc?: (data: any) => any): Promise<any> {
  let data = await fetchData(endpoint);
  if (processFunc) {
    data = processFunc(data);
  }
  await setData(idbKey, data);
  return data;
}

export async function loadServerDataIntoIDB(dataType: string, schema: string): Promise<any> {
  const endpoint = `/api/fetchall/${dataType}?schema=${schema}`;
  const idbKey = `${dataType}List`;
  return await updateData(endpoint, idbKey);
}

interface UpdateContextsIDBProps {
  schema: string;
}

const UpdateContextsFromIDB = ({ schema }: UpdateContextsIDBProps) => {
  const plotListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const orgCensusListDispatch = useOrgCensusListDispatch();

  const updateQuadratsContext = async () => {
    await loadServerDataIntoIDB('quadrats', schema);
    await loadServerDataIntoIDB('subquadrats', schema);

    const quadratList: QuadratRDS[] = await getData('quadratList', `/api/fetchall/quadrats?schema=${schema}`);
    if (quadratListDispatch) await quadratListDispatch({ quadratList });
  };

  const updateCensusContext = async () => {
    const censusRDSLoad: CensusRDS[] = await getData('censusList', `/api/fetchall/census?schema=${schema}`);
    const orgCensusListData = await createAndUpdateCensusList(censusRDSLoad);
    await setData('censusList', orgCensusListData);
    if (orgCensusListDispatch) await orgCensusListDispatch({ censusList: orgCensusListData });
  };

  const updatePlotsContext = async () => {
    await loadServerDataIntoIDB('plot', schema);
    const plotsListData: PlotRDS[] = await getData('plotList', `/api/fetchall/plots?schema=${schema}`);
    if (plotListDispatch) await plotListDispatch({ plotList: plotsListData });
  };

  // return { updateQuadratsContext, updateCensusContext, updatePlotsContext };
  return;
};

export default UpdateContextsFromIDB;
