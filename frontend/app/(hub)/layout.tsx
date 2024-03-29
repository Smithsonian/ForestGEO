"use client";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {subtitle, title} from "@/config/primitives";
import {useSession} from "next-auth/react";
import {usePathname} from "next/navigation";
import {
  useCensusLoadContext,
  useCensusLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch
} from "@/app/contexts/coredataprovider";
import {
  useCensusListContext,
  useCensusListDispatch,
  usePlotListDispatch,
  useQuadratListDispatch,
  useSiteListDispatch
} from "@/app/contexts/listselectionprovider";
import {getData} from "@/config/db";
import {siteConfig} from "@/config/macros";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box, CircularProgress} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {useLoading} from "@/app/contexts/loadingprovider";
import {clearAllHashes, loadServerDataIntoIDB} from "@/config/updatecontextsfromidb";
import {
  useCensusContext,
  useCensusDispatch, usePlotContext,
  usePlotDispatch,
  useQuadratDispatch,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import Typography from "@mui/joy/Typography";

function renderSwitch(endpoint: string) {
  switch (endpoint) {
    case '/dashboard':
      return (
        <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard - ForestGEO Application User Guide</h3>
      );
    case '/measurementssummary':
      return (
        <h3 className={title({color: "green"})} key={endpoint}>Core Measurements Hub</h3>
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
  const {isLoading, setLoading} = useLoading();
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const censusListDispatch = useCensusListDispatch();
  const siteListDispatch = useSiteListDispatch();
  // plot & census & quadrat selection dispatches to reset plot/census when census changes
  const censusDispatch = useCensusDispatch();
  const plotDispatch = usePlotDispatch();
  const quadratDispatch = useQuadratDispatch();
  // monitors:
  const censusLoadContext = useCensusLoadContext();
  const censusListContext = useCensusListContext();
  const delayValue = 500;
  // site/session definition
  const currentSite = useSiteContext();
  const {data: session} = useSession();
  const previousSiteRef = useRef<string | undefined>(undefined);

  const [siteListLoaded, setSiteListLoaded] = useState(false);
  const [coreDataLoaded, setCoreDataLoaded] = useState(false);
  const [loadingOperations, setLoadingOperations] = useState(0);

  // Helper function to manage loading operations count
  const updateLoadingOperations = (increment: boolean) => {
    setLoadingOperations(prev => prev + (increment ? 1 : -1));
  };

  const checkAndSetLoading = (loading: boolean, message: string = '') => {
    if (loading) {
      setLoading(true, message);
      updateLoadingOperations(true);
    } else {
      updateLoadingOperations(false);
      if (loadingOperations === 1) {
        setLoading(false);
      }
    }
  };

  const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
  let pathname = usePathname();

  useEffect(() => {
    const updateCensusList = async () => {
      // Fetch the updated list of censuses. Replace the below line with your actual data fetching logic.
      if (!censusLoadContext) return;

      let uniqueCensusMap = new Map();
      censusLoadContext.forEach(censusRDS => {
        const plotCensusNumber = censusRDS?.plotCensusNumber || 0;
        let existingCensus = uniqueCensusMap.get(plotCensusNumber);
        if (!existingCensus) {
          uniqueCensusMap.set(plotCensusNumber, {
            plotID: censusRDS?.plotID || 0,
            plotCensusNumber,
            startDate: censusRDS?.startDate || null, // need to handle null start date too
            endDate: censusRDS?.endDate || null,  // Handle null endDate
            description: censusRDS?.description || ''
          });
        } else {
          if (censusRDS?.startDate) {
            existingCensus.startDate = existingCensus.startDate
              ? new Date(Math.max(existingCensus.startDate.getTime(), new Date(censusRDS.startDate).getTime()))
              : new Date(censusRDS.startDate);  // Update startDate only if it's not null
          }
          existingCensus.startDate = new Date(Math.min(existingCensus.startDate.getTime(), new Date(censusRDS?.startDate || 0).getTime()));
          if (censusRDS?.endDate) {
            existingCensus.endDate = existingCensus.endDate
              ? new Date(Math.max(existingCensus.endDate.getTime(), new Date(censusRDS.endDate).getTime()))
              : new Date(censusRDS.endDate);  // Update endDate only if it's not null
          }
        }
      });

      // Check if the census list actually needs to be updated
      const newCensusList = Array.from(uniqueCensusMap.values());
      if (JSON.stringify(censusListContext) !== JSON.stringify(newCensusList)) {
        console.log('Updating Census List...'); // Debugging Log
        checkAndSetLoading(true, "Updating Census Selection...");
        if (censusListDispatch) {
          await censusListDispatch({censusList: newCensusList});
          await delay(500);
        }
        checkAndSetLoading(false);
      }
    };

    updateCensusList().catch(console.error);
  }, [censusLoadDispatch]);

  const fetchAndUpdateCoreData = useCallback(async () => {
    if (session && currentSite) {
      let email = session?.user?.email ?? '';
      if (email === '') {
        throw new Error("Session user's name or email is undefined");
      }
      try {
        // Function to load and dispatch Census data
        const loadCensusData = async () => {
          setLoading(true, 'Retrieving Census Information...');
          await delay(delayValue);
          await loadServerDataIntoIDB('census', currentSite.schemaName);

          setLoading(true, 'IDB Load Complete. Retrieving IDB-stored Census Information...');
          const censusData = await getData('censusLoad');
          await delay(delayValue);

          setLoading(true, 'Census Information Retrieved. Retrieving Refined Census Information...');
          const censusList = await getData('censusList');
          await delay(delayValue);

          if (!censusData || !censusList) return false;
          setLoading(true, 'Dispatching Census...');
          censusLoadDispatch && await censusLoadDispatch({censusLoad: censusData});
          await delay(delayValue);
          setLoading(true, 'Dispatching Refined Census...');
          censusListDispatch && await censusListDispatch({censusList: censusList});
          await delay(delayValue);
          setLoading(true, 'Census Dispatch Complete!');
          await delay(delayValue);
          return true;
        };

        // Function to load and dispatch Plots data
        const loadPlotsQuadratsData = async () => {
          // load quadrats
          setLoading(true, 'Retrieving Quadrats Information...');
          await loadServerDataIntoIDB('quadrats', currentSite.schemaName);
          await delay(delayValue);

          setLoading(true, 'IDB Load Complete. Retrieving IDB-stored Quadrats Information...');
          const quadratsData = await getData('quadratsLoad');
          await delay(delayValue);

          setLoading(true, 'Quadrats Information Retrieved. Retrieving Refined Quadrats Information...');
          const quadratsList = await getData('quadratList');
          await delay(delayValue);

          if (!quadratsData || !quadratsList) return false;
          setLoading(true, 'Dispatching Quadrats...');
          quadratsLoadDispatch && await quadratsLoadDispatch({quadratsLoad: quadratsData});
          await delay(delayValue);

          setLoading(true, 'Dispatching Refined Quadrats...');
          quadratListDispatch && await quadratListDispatch({quadratList: quadratsList});
          await delay(delayValue);

          setLoading(true, 'Quadrats Dispatch Complete!');
          await delay(delayValue);

          // load plots
          setLoading(true, 'Retrieving Plots Information...');
          await loadServerDataIntoIDB('plots', currentSite.schemaName);
          setLoading(true, 'IDB Load Complete. Retrieving IDB-stored Plots Information...');
          const plotsData = await getData('plotsLoad');
          setLoading(true, 'Plots Information Retrieved. Retrieving Refined Plots Information...');
          const plotList = await getData('plotList');
          if (!plotsData || !plotList) return false;
          setLoading(true, 'Dispatching Plots...');
          plotsLoadDispatch && await plotsLoadDispatch({plotsLoad: plotsData});
          await delay(delayValue);

          setLoading(true, 'Dispatching Refined Plots...');
          plotsListDispatch && await plotsListDispatch({plotList: plotList});
          await delay(delayValue);

          setLoading(true, 'Plots Dispatch Complete!');
          await delay(delayValue);
          return true;
        };

        // Parallelize data loading
        // const [plotsSuccess, censusSuccess] = await Promise.all([loadPlotsQuadratsData(), loadCensusData()]);
        let plotsSuccess = await loadPlotsQuadratsData();
        if (!plotsSuccess) throw new Error('loadPlotsData failure');
        await delay(delayValue);
        let censusSuccess = await loadCensusData();
        if (!censusSuccess) throw new Error('loadCensusData failure');
      } catch (error: any) {
        console.error('Error loading server data:', error.message);
        throw new Error(error);
      } finally {
        setLoading(false);
      }
    }
  }, [currentSite, session]);

  const fetchSiteList = useCallback(async () => {
    // Removed direct use of Dispatch functions for core data, as it's handled within clientmacros now.
    setLoading(true, 'Loading Core Data...');
    await delay(delayValue);
    if (session && !siteListLoaded) {
      let email = session?.user?.email ?? '';
      if (email === '') {
        throw new Error("Session user's name or email is undefined");
      }
      let sites = session?.user?.allsites ?? [];
      if (sites.length === 0) {
        throw new Error("Session sites undefined");
      } else {
        setLoading(true, 'Loading Sites...');
        siteListDispatch ? await siteListDispatch({siteList: sites}) : undefined;
        await delay(delayValue);
      }
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session && !siteListLoaded) {
      fetchSiteList().then(() => setSiteListLoaded(true)).catch(console.error);
    }
  }, [fetchSiteList, session, siteListLoaded]);

  // site change tracking
  useEffect(() => {
    const hasSiteChanged = previousSiteRef.current !== currentSite?.siteName;
    if (siteListLoaded && currentSite && hasSiteChanged) {
      // Site changed, reset coreDataLoaded to false
      setCoreDataLoaded(false);
      previousSiteRef.current = currentSite.siteName; // Update previous site reference
    }

    if (siteListLoaded && currentSite && !coreDataLoaded) {
      // clear currently selected plot & census
      if (quadratDispatch) quadratDispatch({quadrat: null}).catch(console.error);
      if (censusDispatch) censusDispatch({census: null}).catch(console.error);
      if (plotDispatch) plotDispatch({plot: null}).catch(console.error);

      // Site list loaded and current site selected, fetch core data
      fetchAndUpdateCoreData().then(() => setCoreDataLoaded(true)).catch(console.error);
    }
  }, [siteListLoaded, currentSite, coreDataLoaded, fetchAndUpdateCoreData]);

  return (
    <>
      <Sidebar siteListLoaded={siteListLoaded} coreDataLoaded={coreDataLoaded}/>
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
          {coreDataLoaded && (
            <>
              {children}
            </>
          )}
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
  );
}