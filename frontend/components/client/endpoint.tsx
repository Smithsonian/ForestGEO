"use client";
import * as React from "react";
import {useEffect, useState} from "react";
import {useSession} from "next-auth/react";
import {usePathname, useRouter} from "next/navigation";
import {subtitle, title} from "@/config/primitives";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {Plot, Quadrat, siteConfig} from "@/config/macros";
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch} from "@/app/contexts/coredataprovider";
import {usePlotListDispatch, useQuadratListDispatch} from "@/app/contexts/listselectionprovider";
import {CensusRDS, PlotRDS, QuadratRDS} from "@/config/sqlmacros";
import {getData, setData} from "@/config/db";
import {useCensusDispatch, usePlotDispatch} from "@/app/contexts/userselectionprovider";
import HeaderSkeleton from "@/components/skeletons/headerskeleton";
import SidebarSkeleton from "@/components/skeletons/sidebarskeleton";
import MainContentSkeleton from "../skeletons/maincontentskeleton";

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

interface PlotData {
  key: string;
  num: number;
  id: number;
}

export default function Endpoint({children,}: Readonly<{ children: React.ReactNode }>) {
  const {data: session, status} = useSession();

  const router = useRouter();
  const [loading, setLoading] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [coreDataLoading, setCoreDataLoading] = useState(true);
  const censusLoadDispatch = useCensusLoadDispatch()!;
  const quadratsLoadDispatch = useQuadratsLoadDispatch()!;
  const plotsLoadDispatch = usePlotsLoadDispatch()!;
  const plotsListDispatch = usePlotListDispatch()!;
  const plotDispatch = usePlotDispatch()!;
  const censusDispatch = useCensusDispatch()!;
  const quadratListDispatch = useQuadratListDispatch()!;
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
      if (quadratsRDSLoad.length === 0) console.log('empty set returned from database, skipping IDB storage');
      else {
        await setData('quadratsLoad', quadratsRDSLoad); // Save to IndexedDB
        setLoading(20);
        if (quadratsLoadDispatch) {
          quadratsLoadDispatch({quadratsLoad: quadratsRDSLoad});
        }
      }
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
      setLoadingMsg('Dispatching Quadrat List...');
      setLoading(40)
      if (quadratListDispatch) {
        quadratListDispatch({quadratList: quadratList});
      }
    }
    setLoading(50);
    setLoadingMsg('Retrieving Census...');

    // Check if censusLoad data is available in IndexedDB
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad || censusRDSLoad.length === 0) {
      // Fetch data from the server if not in IndexedDB
      const response = await fetch('/api/fetchall/census', {method: 'GET'});
      censusRDSLoad = await response.json();
      if (censusRDSLoad.length === 0) console.log('empty set returned from database, skipping IDB storage');
      else {
        await setData('censusLoad', censusRDSLoad); // Save to IndexedDB
        setLoading(60);
        if (censusLoadDispatch) {
          censusLoadDispatch({censusLoad: censusRDSLoad});
        }
      }
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
      if (plotRDSLoad.length === 0) console.log('empty set returned from database, skipping IDB storage');
      else {
        await setData('plotsLoad', plotRDSLoad);
        setLoading(80);
        if (plotsLoadDispatch) {
          plotsLoadDispatch({plotsLoad: plotRDSLoad});
        }
      }
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

    const currentPlotData = await getData('plot');
    if (!currentPlotData) console.log('IDB-stored data for plot returned undefined');
    else if (plotDispatch) plotDispatch({plot: currentPlotData});

    const currentCensusData = await getData('census');
    if (!currentCensusData) console.log('IDB-stored data for census returned undefined');
    else if (censusDispatch) censusDispatch({census: currentCensusData});
    setCoreDataLoading(false);
  };
  const fetchDataEffect = async () => {
    try {
      await fetchAndDispatchCoreData();
      setLoading(100);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchDataEffect().catch(console.error);
  }, []);

  useEffect(() => {
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
  }, [router]);

  let pathname = usePathname();
  return (
    <>
      {coreDataLoading ? (
        <>
          <HeaderSkeleton/>
          <SidebarSkeleton/>
          <MainContentSkeleton/>
        </>
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