"use client";

import {getData, setData} from "@/config/db";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";
import {Census, Plot, Quadrat} from "@/config/macros";
import {Box, LinearProgress, LinearProgressProps, Typography} from "@mui/material";
import React from "react";

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
        startDate: new Date(censusRDS?.startDate || 0),
        endDate: new Date(censusRDS?.endDate || 0),
        description: censusRDS?.description || ''
      });
    } else {
      existingCensus.startDate = new Date(Math.min(existingCensus.startDate.getTime(), new Date(censusRDS?.startDate || 0).getTime()));
      existingCensus.endDate = new Date(Math.max(existingCensus.endDate.getTime(), new Date(censusRDS?.endDate || 0).getTime()));
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
  const serverHash = await fetchHash(hashEndpoint);
  const localHash = await getData(localHashKey);

  if (serverHash !== localHash) {
    const data = await fetchData(dataEndpoint);
    await setData(localHashKey, serverHash);
    await setData(dataKey, data);
    return data;
  }

  return await getData(dataKey);
}

async function updateQuadratsIDB() {
  const hashEndpoint = `/api/hash/quadrats`;
  const dataEndpoint = `/api/fetchall/quadrats`;

  const quadratsRDSLoad: QuadratsRDS[] = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'quadratsHash', 'quadratsLoad');
  await createAndUpdateQuadratList(quadratsRDSLoad);
}

async function updatePlotsIDB(lastName: string, email: string) {
  const hashEndpoint = `/api/hash/plots?lastname=${lastName}&email=${email}`;
  const dataEndpoint = `/api/fetchall/plots?lastname=${lastName}&email=${email}`;
  const plotRDSLoad = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'plotsHash', 'plotsLoad');
  let quadratsRDSLoad: QuadratsRDS[] = await getData('quadratsLoad');
  if (!quadratsRDSLoad) {
    throw new Error('quadratsLoad IDB retrieval failed');
  }
  await createAndUpdatePlotList(plotRDSLoad, quadratsRDSLoad);
}

async function updateCensusIDB() {
  const hashEndpoint = `/api/hash/census`;
  const dataEndpoint = `/api/fetchall/census`;
  let censusRDSLoad = await checkHashAndUpdateData(hashEndpoint, dataEndpoint, 'censusHash', 'censusLoad');
  await createAndUpdateCensusList(censusRDSLoad);
}

export async function loadServerDataIntoIDB(dataType: string, userLastName: string, userEmail: string) {
  if (!userLastName || !userEmail) throw new Error('session user information was not provided');
  switch (dataType) {
    case 'quadrats':
      await updateQuadratsIDB();
      return;
    case 'plots':
      await updatePlotsIDB(userLastName, userEmail);
      return;
    case 'census':
      await updateCensusIDB();
      return;
    default:
      throw new Error('incorrect data type provided to loadServerDataIntoIDB, verify');
  }
}

export function LinearProgressWithLabel(props: LinearProgressProps & { value?: number, currentlyrunningmsg?: string }) {
  return (
    <Box sx={{display: 'flex', flex: 1, alignItems: 'center', flexDirection: 'column'}}>
      <Box sx={{width: '100%', mr: 1}}>
        {props.value ? (
          <LinearProgress variant="determinate" {...props} />
        ) : (
          <LinearProgress variant={"indeterminate"} {...props} />
        )}
      </Box>
      <Box sx={{minWidth: 35, display: 'flex', flex: 1, flexDirection: 'column'}}>
        {props.value ? (
          <Typography variant="body2" color="text.secondary">{`${Math.round(
            props?.value,
          )}% --> ${props?.currentlyrunningmsg}`}</Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">{`${props?.currentlyrunningmsg}`}</Typography>
        )}

      </Box>
    </Box>
  );
}