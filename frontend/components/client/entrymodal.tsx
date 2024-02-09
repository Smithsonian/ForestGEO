"use client";
import React, {useEffect, useState} from 'react';
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch,} from '@/app/contexts/coredataprovider';
import {
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotListDispatch,
  useQuadratListDispatch,
} from '@/app/contexts/listselectionprovider';
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Modal,
  ModalDialog,
  Stack,
  Typography,
} from '@mui/joy';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import Divider from '@mui/joy/Divider';
import {redirect} from 'next/navigation';
import {CensusRDS, PlotRDS, QuadratRDS} from '@/config/sqlmacros';
import {getData, setData} from "@/config/db";
import {Plot, Quadrat} from "@/config/macros";
import {useCensusDispatch, usePlotDispatch} from "@/app/contexts/userselectionprovider";
import {useSession} from "next-auth/react";
import HeaderSkeleton from "@/components/skeletons/headerskeleton";
import SidebarSkeleton from "@/components/skeletons/sidebarskeleton";
import MainContentSkeleton from "@/components/skeletons/maincontentskeleton";

export default function EntryModal() {
  const {data: _session, status} = useSession();
  const [loading, setLoading] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const plotDispatch = usePlotDispatch();
  const censusDispatch = useCensusDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const firstLoad = useFirstLoadContext();
  const firstLoadDispatch = useFirstLoadDispatch();
  const [coreDataLoading, setCoreDataLoading] = useState(true);

  const fetchAndDispatchCoreData = async () => {
    setCoreDataLoading(true);
    setLoadingMsg('Retrieving Quadrats...');

    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData = await getData('quadratsLoad');
    let quadratsRDSLoad: QuadratRDS[];
    setLoading(10);
    if (quadratsLoadData && quadratsLoadData.length > 0) {
      quadratsRDSLoad = quadratsLoadData;
    } else {
      const response = await fetch('/api/fetchall/quadrats', {method: 'GET'});
      quadratsRDSLoad = await response.json();
    }
    await setData('quadratsLoad', quadratsRDSLoad); // Save to IndexedDB
    setLoading(20);
    if (quadratsLoadDispatch) {
      quadratsLoadDispatch({quadratsLoad: quadratsRDSLoad});
    }
    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');
    setLoading(30);
    if (!quadratList || quadratList.length === 0) {
      // Generate quadratList from quadratsRDSLoad if not in IndexedDB
      quadratList = quadratsRDSLoad.map((quadratRDS) => ({
        quadratID: quadratRDS.quadratID ? quadratRDS.quadratID : 0,
        plotID: quadratRDS.plotID ? quadratRDS.plotID : 0,
        quadratName: quadratRDS.quadratName ? quadratRDS.quadratName : '',
      }));
      await setData('quadratList', quadratList); // Save to IndexedDB
    }
    setLoadingMsg('Dispatching Quadrat List...');
    setLoading(40)
    if (quadratListDispatch) {
      quadratListDispatch({quadratList: quadratList});
    }
    setLoading(50);
    setLoadingMsg('Retrieving Census...');

    // Check if censusLoad data is available in IndexedDB
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad || censusRDSLoad.length === 0) {
      // Fetch data from the server if not in IndexedDB
      const response = await fetch('/api/fetchall/census', {method: 'GET'});
      censusRDSLoad = await response.json();
    }
    await setData('censusLoad', censusRDSLoad); // Save to IndexedDB
    setLoading(60);
    if (censusLoadDispatch) {
      censusLoadDispatch({censusLoad: censusRDSLoad});
    }
    setLoading(70);
    setLoadingMsg('Retrieving Plots...');

    // Check if plotsLoad data is available in localStorage
    const plotsLoadData = await getData('plotsLoad');
    let plotRDSLoad: PlotRDS[];
    if (plotsLoadData && plotsLoadData.length > 0) {
      // Use data from localStorage if available
      plotRDSLoad = plotsLoadData;
    } else {
      // Fetch data from the server if not in localStorage
      const response = await fetch('/api/fetchall/plots', {method: 'GET'});
      plotRDSLoad = await response.json();
    }
    await setData('plotsLoad', plotRDSLoad);
    setLoading(80);
    if (plotsLoadDispatch) {
      plotsLoadDispatch({plotsLoad: plotRDSLoad});
    }
    // Check if plotList data is available in localStorage
    const plotListData = await getData('plotList');
    let plotList: Plot[];
    if (plotListData && plotListData.length > 0) {
      // Use data from localStorage if available
      plotList = plotListData;
    } else {
      // Generate plotList from plotRDSLoad if not in localStorage
      plotList = plotRDSLoad.map((plotRDS) => ({
        key: plotRDS.plotName ? plotRDS.plotName : '',
        num: quadratsRDSLoad.filter((quadrat) => quadrat.plotID === plotRDS.plotID).length,
        id: plotRDS.plotID ? plotRDS.plotID : 0,
      }));
    }
    await setData('plotList', plotList);
    setLoading(90);
    setLoadingMsg('Dispatching Plot List...');
    if (plotsListDispatch) {
      plotsListDispatch({plotList: plotList});
    }
    setCoreDataLoading(false);
  };

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        await fetchAndDispatchCoreData();
        setLoading(100);
      } catch (error) {
        console.error(error);
      }
    };
    console.log(`firstLoad state: ${firstLoad}`);
    console.log(`entrymodal session state: ${status}`);
    fetchDataEffect().catch(console.error);
  }, []);

  if (coreDataLoading) {
    return (
      <>
        <HeaderSkeleton/>
        <SidebarSkeleton/>
        <MainContentSkeleton/>
      </>
    );
  }

  return (
    <>
      {firstLoad ? <Modal open={firstLoad}
                          sx={{display: 'flex', flex: 1}}
                          onClose={(_event: React.MouseEvent<HTMLButtonElement>, reason: string) => {
                            if (reason !== 'backdropClick' && reason !== 'escapeKeyDown') {
                              return firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : undefined;
                            }
                          }}>
        <ModalDialog variant="outlined" role="alertdialog">
          <DialogTitle>
            <WarningRoundedIcon/>
            <Typography level={"title-lg"}>Welcome to the Application!</Typography>
          </DialogTitle>
          <Divider/>
          <DialogContent>
            <Stack direction={"column"} sx={{display: 'flex', flex: 1}}>
              {loading != 100 ?
                <>
                  <LinearProgress sx={{display: 'flex', flex: 1}} determinate size={"lg"} value={loading}/>
                  <Typography level="body-sm" color="neutral"><b>{loadingMsg}</b></Typography>
                </> :
                <>
                  <Typography level={"body-sm"}>Select <b>Core Measurements Hub</b> to view existing core
                    measurement data for a given plot, census, and quadrat</Typography>
                  <Typography level={"body-sm"}>Select <b>CSV & ArcGIS File Upload Hub</b> to upload core
                    measurements in either CSV format or in collected ArcGIS format</Typography>
                  <Typography level={"body-sm"}>Select <b>Measurement Properties Hub</b> to view and edit
                    measurement properties used in data collection</Typography>
                </>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="plain" color="neutral" disabled={loading != 100}
                    onClick={() => firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null}>
              Continue
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal> : redirect('/dashboard')}
    </>
  );
}