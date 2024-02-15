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
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";

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
  let currentCensus = useCensusContext();
  let currentPlot = usePlotContext();
  const censusLoadDispatch = useCensusLoadDispatch()!;
  const quadratsLoadDispatch = useQuadratsLoadDispatch()!;
  const plotsLoadDispatch = usePlotsLoadDispatch()!;
  const plotsListDispatch = usePlotListDispatch()!;
  const plotDispatch = usePlotDispatch();
  const censusDispatch = useCensusDispatch();
  const quadratListDispatch = useQuadratListDispatch()!;
  const censusListDispatch = useCensusListDispatch();

  useEffect(() => {
    const checkPlotCensus = async () => {
      const storedCensus = await getData('census');
      if (storedCensus) {
        console.log(`stored census: ${storedCensus}`);
      } else {
        console.log('stored census null');
      }
      const storedPlot = await getData('plot');
      if (storedPlot) {
        console.log(`stored plot: ${storedPlot}`);
      } else {
        console.log('stored plot null');
      }
    };
    console.log(`census: ${currentCensus === null}`);
    console.log(`plot: ${currentPlot === null}`);
    console.log(`!census: ${!currentCensus}`);
    console.log(`!plot: ${!currentPlot}`);
    if (!currentCensus || !currentPlot) {
      checkPlotCensus().catch(console.error);
    }
  }, [censusDispatch, currentCensus, currentPlot, plotDispatch]);

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
    setCoreDataLoading(true);
    setLoadingMsg('Retrieving Quadrats...');

    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData = await getData('quadratsLoad');
    let quadratsRDSLoad: QuadratsRDS[];
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
    const censusListData = await getData('censusList');
    let censusList: Census[];
    if (censusListData && censusListData.length > 0) {
      censusList = censusListData;
    } else {
      const uniqueCensusMap = new Map<number, Census>();
      censusRDSLoad.forEach((censusRDS) => {
        const plotCensusNumber = censusRDS.plotCensusNumber ? censusRDS.plotCensusNumber : 0;
        if (!uniqueCensusMap.has(plotCensusNumber)) {
          // First occurrence of this plotCensusNumber
          uniqueCensusMap.set(plotCensusNumber, {
            plotID: censusRDS.plotID ? censusRDS.plotID : 0,
            plotCensusNumber,
            startDate: new Date(censusRDS.startDate!),
            endDate: new Date(censusRDS.endDate!),
            description: censusRDS.description ? censusRDS.description : ''
          });
        } else {
          // Update existing entry with earliest startDate and latest endDate
          const existingCensus = uniqueCensusMap.get(plotCensusNumber);
          if (existingCensus) {
            existingCensus.startDate = new Date(Math.min(existingCensus.startDate.getTime(), new Date(censusRDS.startDate!).getTime()));
            existingCensus.endDate = new Date(Math.max(existingCensus.endDate.getTime(), new Date(censusRDS.endDate!).getTime()));
          }
        }
      });
      censusList = Array.from(uniqueCensusMap.values());
    }
    await setData('censusList', censusList);
    if (censusListDispatch) censusListDispatch({censusList: censusList});
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
  }, [censusListDispatch, censusLoadDispatch, plotsListDispatch, plotsLoadDispatch, quadratListDispatch, quadratsLoadDispatch]);
  return (
    <>
      {coreDataLoading ? (
        <CircularProgress determinate value={loading} variant={"soft"} title={loadingMsg}/>
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