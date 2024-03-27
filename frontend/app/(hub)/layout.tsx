"use client";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {subtitle, title} from "@/config/primitives";
import {useSession} from "next-auth/react";
import {usePathname} from "next/navigation";
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch} from "@/app/contexts/coredataprovider";
import {
  useCensusListDispatch,
  usePlotListDispatch,
  useQuadratListDispatch,
  useSiteListDispatch
} from "@/app/contexts/listselectionprovider";
import {getData} from "@/config/db";
import {siteConfig} from "@/config/macros";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {useLoading} from "@/app/contexts/loadingprovider";
import {loadServerDataIntoIDB} from "@/config/updatecontextsfromidb";
import {useCensusDispatch, usePlotDispatch, useSiteContext} from "@/app/contexts/userselectionprovider";

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
  const {setLoading} = useLoading();
  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const censusListDispatch = useCensusListDispatch();
  const siteListDispatch = useSiteListDispatch();
  // plot & census selection dispatches to reset plot/census when census changes
  const censusDispatch = useCensusDispatch();
  const plotDispatch = usePlotDispatch();
  // site/session definition
  const currentSite = useSiteContext();
  const {data: session} = useSession();
  const previousSiteRef = useRef<string | undefined>(undefined);
  const previousCensusRef = useRef<string | undefined>(undefined);
  const previousPlotRef = useRef<string | undefined>(undefined);

  const [siteListLoaded, setSiteListLoaded] = useState(false);
  const [coreDataLoaded, setCoreDataLoaded] = useState(false);

  let pathname = usePathname();

  const fetchAndUpdateCoreData = useCallback(async () => {
    if (session && currentSite) {
      let email = session?.user?.email ?? '';
      if (email === '') {
        throw new Error("Session user's name or email is undefined");
      }
      try {
        setLoading(true, 'Loading Core Data...');

        // Function to load and dispatch Quadrats data
        const loadQuadratsData = async () => {
          await loadServerDataIntoIDB('quadrats', email, currentSite.schemaName);
          const quadratsData = await getData('quadratsLoad');
          const quadratsList = await getData('quadratList');
          quadratsLoadDispatch && await quadratsLoadDispatch({quadratsLoad: quadratsData});
          quadratListDispatch && await quadratListDispatch({quadratList: quadratsList});
        };

        // Function to load and dispatch Census data
        const loadCensusData = async () => {
          await loadServerDataIntoIDB('census', email, currentSite.schemaName);
          const censusData = await getData('censusLoad');
          const censusList = await getData('censusList');
          censusLoadDispatch && await censusLoadDispatch({censusLoad: censusData});
          censusListDispatch && await censusListDispatch({censusList: censusList});
        };

        // Function to load and dispatch Plots data
        const loadPlotsData = async () => {
          await loadServerDataIntoIDB('plots', email, currentSite.schemaName);
          const plotsData = await getData('plotsLoad');
          const plotList = await getData('plotList');
          plotsLoadDispatch && await plotsLoadDispatch({plotsLoad: plotsData});
          plotsListDispatch && await plotsListDispatch({plotList: plotList});
        };

        // Parallelize data loading
        setLoading(true, 'Loading Quadrats...');
        await loadQuadratsData();
        setLoading(true, 'Loading Census...');
        await loadCensusData();
        setLoading(true, 'Loading Plots...');
        await loadPlotsData();
      } catch (error: any) {
        console.error('Error loading server data:', error.message);
      } finally {
        setLoading(false);
      }
    }
  }, [currentSite, session]);

  const fetchSiteList = useCallback(async () => {
    // Removed direct use of Dispatch functions for core data, as it's handled within clientmacros now.
    const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
    setLoading(true, 'Loading Core Data...');

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
      }
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session && !siteListLoaded) {
      fetchSiteList().then(() => setSiteListLoaded(true)).catch(console.error);
    }
  }, [fetchSiteList, session, siteListLoaded]);

  useEffect(() => {
    // Track if the current site has changed
    const hasSiteChanged = previousSiteRef.current !== currentSite?.siteName;
    if (siteListLoaded && currentSite && hasSiteChanged) {
      // Site changed, reset coreDataLoaded to false
      setCoreDataLoaded(false);
      previousSiteRef.current = currentSite.siteName; // Update previous site reference
    }

    if (siteListLoaded && currentSite && !coreDataLoaded) {
      // Site list loaded and current site selected, fetch core data
      fetchAndUpdateCoreData().then(() => setCoreDataLoaded(true)).catch(console.error);
      // clear currently selected plot & census
      if (censusDispatch) censusDispatch({census: null});
      if (plotDispatch) plotDispatch({plot: null});
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
  );
}