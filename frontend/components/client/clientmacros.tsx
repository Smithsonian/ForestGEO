"use client";

import {clearDataByKey, getData, setData} from "@/config/db";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";
import {Census, Plot, Quadrat} from "@/config/macros";
import {Box, LinearProgress, LinearProgressProps, Typography} from "@mui/material";
import React from "react";

async function updateQuadratsIDB(userLastName: string, userEmail: string) {
  const quadratRDSResponse = await fetch(`/api/fetchall/quadrats`, {method: 'GET'});
  if (!quadratRDSResponse.ok) throw new Error('fetchall quadrats failure.');
  const jsonResponse = await quadratRDSResponse.json();
  await clearDataByKey('quadratsLoad');
  await clearDataByKey('quadratList');
  await clearDataByKey('plotsLoad');
  await clearDataByKey('plotList');
  let quadratsRDSLoad: QuadratsRDS[] = jsonResponse;
  let quadratList: Quadrat[] = [];
  quadratList = quadratsRDSLoad.map((quadratRDS) => ({
    quadratID: quadratRDS.quadratID ? quadratRDS.quadratID : 0,
    plotID: quadratRDS.plotID ? quadratRDS.plotID : 0,
    quadratName: quadratRDS.quadratName ? quadratRDS.quadratName : '',
  }));
  await setData('quadratsLoad', quadratsRDSLoad);
  await setData('quadratList', quadratList);
  const plotRDSResponse = await fetch(`/api/fetchall/plots?lastname=${userLastName}&email=${userEmail}`, {method: 'GET'});
  if (!plotRDSResponse.ok) throw new Error('fetchall plots failure');
  let plotRDSLoad = await plotRDSResponse.json();
  let plotList: Plot[] = [];
  plotList = plotRDSLoad.map((plotRDS: PlotRDS) => ({
    key: plotRDS.plotName ? plotRDS.plotName : '',
    num: quadratsRDSLoad.filter((quadrat) => quadrat.plotID === plotRDS.plotID).length,
    id: plotRDS.plotID ? plotRDS.plotID : 0,
  }));
  await setData('plotsLoad', plotRDSLoad);
  await setData('plotList', plotList);
}

async function updatePlotsIDB(userLastName: string, userEmail: string) {
  const plotRDSResponse = await fetch(`/api/fetchall/plots?lastname=${userLastName}&email=${userEmail}`, {method: 'GET'});
  if (!plotRDSResponse.ok) throw new Error('fetchall plots failure');
  const jsonResponse = await plotRDSResponse.json();
  await clearDataByKey('plotsLoad');
  await clearDataByKey('plotList');
  let plotRDSLoad: PlotRDS[] = jsonResponse;
  let quadratsRDSLoad = await getData('quadratsLoad');
  if (!quadratsRDSLoad) throw new Error('quadratsLoad IDB instance undefined');
  let plotList: Plot[] = [];
  plotList = plotRDSLoad.map((plotRDS: PlotRDS) => ({
    key: plotRDS.plotName ? plotRDS.plotName : '',
    num: quadratsRDSLoad.filter((quadrat: QuadratsRDS) => quadrat.plotID === plotRDS.plotID).length,
    id: plotRDS.plotID ? plotRDS.plotID : 0,
  }));
  await setData('plotsLoad', plotRDSLoad);
  await setData('plotList', plotList);
}

async function updateCensusIDB() {
  const censusRDSResponse = await fetch(`/api/fetchall/census`, {method: 'GET'});
  if (!censusRDSResponse.ok) throw new Error('fetchall census failure');
  const jsonResponse = await censusRDSResponse.json();
  await clearDataByKey('censusLoad');
  await clearDataByKey('censusList');
  let censusRDSLoad: CensusRDS[] = jsonResponse;
  let censusList: Census[];
  const uniqueCensusMap = new Map<number, Census>();
  censusRDSLoad.forEach((censusRDS) => {
    const plotCensusNumber = censusRDS?.plotCensusNumber ? censusRDS.plotCensusNumber : 0;
    if (!uniqueCensusMap.has(plotCensusNumber)) {
      // First occurrence of this plotCensusNumber
      uniqueCensusMap.set(plotCensusNumber, {
        plotID: censusRDS?.plotID ? censusRDS.plotID : 0,
        plotCensusNumber,
        startDate: new Date(censusRDS?.startDate!),
        endDate: new Date(censusRDS?.endDate!),
        description: censusRDS?.description ? censusRDS.description : ''
      });
    } else {
      // Update existing entry with earliest startDate and latest endDate
      const existingCensus = uniqueCensusMap.get(plotCensusNumber);
      if (existingCensus) {
        existingCensus.startDate = new Date(Math.min(existingCensus.startDate.getTime(), new Date(censusRDS?.startDate!).getTime()));
        existingCensus.endDate = new Date(Math.max(existingCensus.endDate.getTime(), new Date(censusRDS?.endDate!).getTime()));
      }
    }
  });
  censusList = Array.from(uniqueCensusMap.values());
  await setData('censusLoad', censusRDSLoad);
  await setData('censusList', censusList);
}

export async function loadServerDataIntoIDB(dataType: string, userLastName: string, userEmail: string) {
  if (!userLastName || !userEmail) throw new Error('session user informaiton was not provided');
  switch(dataType) {
    case 'quadrats':
      await updateQuadratsIDB(userLastName, userEmail);
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