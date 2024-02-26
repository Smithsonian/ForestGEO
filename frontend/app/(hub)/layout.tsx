"use client";
import React, {useCallback, useEffect, useState} from "react";
import {subtitle, title} from "@/config/primitives";
import {useSession} from "next-auth/react";
import {usePathname, useRouter} from "next/navigation";
import {
  useCensusContext,
  useCensusDispatch,
  usePlotContext,
  usePlotDispatch
} from "@/app/contexts/userselectionprovider";
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch} from "@/app/contexts/coredataprovider";
import {useCensusListDispatch, usePlotListDispatch, useQuadratListDispatch} from "@/app/contexts/listselectionprovider";
import {getData, setData} from "@/config/db";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";
import {Census, Plot, Quadrat, siteConfig} from "@/config/macros";
import CircularProgress from "@mui/joy/CircularProgress";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box, Stack} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {LinearProgressWithLabel, loadServerDataIntoIDB} from "@/components/client/clientmacros";
import Typography from "@mui/joy/Typography";

function renderSwitch(endpoint: string) {
  switch (endpoint) {
    case '/dashboard':
      return (
        <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard View</h3>
      );
    case '/coremeasurementshub':
      return (
        <h3 className={title({color: "green"})} key={endpoint}>Core Measurements Hub</h3>
      );
    case '/fileuploadhub':
      return (
        <h3 className={title({color: "pink"})} key={endpoint}>File Upload Hub</h3>
      );
    case '/properties/attributes':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Attributes</h3>
      );
    case '/properties/census':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Census</h3>
      );
    case '/properties/personnel':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Personnel</h3>
      );
    case '/properties/quadrats':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Quadrats</h3>
      );
    case '/properties/species':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Species</h3>
      );
    case '/censusform':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Census Form</h3>
      );
    default:
      return (
        <>
        </>
      );
  }
}

export default function HubLayout({children,}: Readonly<{ children: React.ReactNode }>) {
  const {data: _session, status} = useSession();

  const router = useRouter();
  const [loading, setLoading] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [coreDataLoading, setCoreDataLoading] = useState(true);
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const censusListDispatch = useCensusListDispatch();

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        await fetchAndDispatchCoreData();
        setLoading(100);
      } catch (error) {
        console.error(error);
      }
    };
    fetchDataEffect().catch(console.error);
  }, []);

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        await fetchAndDispatchCoreData();
        setLoading(100);
      } catch (error) {
        console.error(error);
      }
    };
    console.log(`endpoint: session state: ${status}`);
    const handlePageRefresh = () => {
      console.log('Page is refreshed. Run your function here.');
      fetchDataEffect().catch(console.error);
    };
    // Check if the router is available and window is defined
    if (router && typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handlePageRefresh);

      return () => {
        window.removeEventListener('beforeunload', handlePageRefresh);
      };
    }
  }, [router, status]);

  let pathname = usePathname();

  const fetchAndDispatchCoreData = useCallback(async () => {
    const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
    setCoreDataLoading(true);
    setLoading(0);
    // IDB load stored separately: QUADRATS
    await loadServerDataIntoIDB('quadrats');
    setLoadingMsg('Retrieving Quadrats...');
    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData = await getData('quadratsLoad');
    setLoading(10);
    if (!quadratsLoadData || quadratsLoadData.length === 0) throw new Error('quadratsLoad data failed');
    setLoading(20);
    if (quadratsLoadDispatch) quadratsLoadDispatch({quadratsLoad: quadratsLoadData});
    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');
    setLoading(30);
    if (!quadratList || quadratList.length === 0) throw new Error('quadratsList data failed');
    await delay(500);
    setLoading(40);
    setLoadingMsg('Dispatching Quadrat List...');
    if (quadratListDispatch) quadratListDispatch({quadratList: quadratList});

    // IDB load stored separately: CENSUS
    await loadServerDataIntoIDB('census');
    await delay(500);
    setLoading(50);
    setLoadingMsg('Retrieving Census...');
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad || censusRDSLoad.length === 0) throw new Error('censusLoad data failed');
    setLoading(60);
    if (censusLoadDispatch) censusLoadDispatch({censusLoad: censusRDSLoad});
    const censusListData = await getData('censusList');
    if (!censusListData || censusListData.length === 0) throw new Error('censusList data failed');
    if (censusListDispatch) censusListDispatch({censusList: censusListData});

    // IDB load stored separately: PLOTS
    await loadServerDataIntoIDB('plots');
    await delay(500);
    setLoading(70);
    setLoadingMsg('Retrieving Plots...');
    // Check if plotsLoad data is available in localStorage
    const plotsLoadData = await getData('plotsLoad');
    if (!plotsLoadData || plotsLoadData.length === 0) throw new Error('plotsLoad data failed');
    setLoading(80);
    if (plotsLoadDispatch) plotsLoadDispatch({plotsLoad: plotsLoadData});
    // Check if plotList data is available in localStorage
    const plotListData = await getData('plotList');
    if (!plotListData || plotListData.length === 0) throw new Error('plotList data failed');
    await delay(500);
    setLoading(90);
    setLoadingMsg('Dispatching Plot List...');
    if (plotsListDispatch) plotsListDispatch({plotList: plotListData});
    setLoading(100);
    setCoreDataLoading(false);
  }, [censusListDispatch, censusLoadDispatch, plotsListDispatch, plotsLoadDispatch, quadratListDispatch, quadratsLoadDispatch]);
  return (
    <>
      {coreDataLoading ? (
        <LinearProgressWithLabel value={loading} currentlyrunningmsg={loadingMsg} />
      ) : (
        <>
          <Sidebar/>
          <Header/>
          <Box
            component="main"
            className="MainContent"
            sx={{
              marginTop: 'var(--Header-height)',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              gap: 1,
              flexGrow: 1,
              flexShrink: 1,
              overflow: 'hidden',
            }}
          >
            <Box sx={{
              display: 'flex',
              alignItems: 'left',
              paddingTop: '25px',
              paddingLeft: '5px',
              paddingBottom: '25px',
              flexDirection: 'column',
            }}>
              {renderSwitch(pathname)}
            </Box>
            <Divider orientation={"horizontal"} sx={{my: '5px'}}/>
            <Box
              sx={{
                display: 'flex',
                flexGrow: 1,
                flexShrink: 1,
                alignItems: 'flex-start',
                flexDirection: 'column',
                paddingLeft: 2
              }}>
              {children}
            </Box>
            <Divider orientation={"horizontal"}/>
            <Box mt={3}
                 sx={{
                   display: 'flex',
                   alignItems: 'center',
                   alignSelf: 'center',
                   flexDirection: 'row',
                   marginBottom: '15px'
                 }}>
              <Box>
                <h1 className={title({color: "violet"})}>{siteConfig.name}&nbsp;</h1>
              </Box>
              <Divider orientation={"vertical"} sx={{marginRight: 2}}/>
              <Box>
                <p className={subtitle({color: "cyan"})}>{siteConfig.description}</p>
              </Box>
            </Box>
          </Box>
        </>
      )}
    </>
  );
}