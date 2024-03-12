"use client";
import React, {useCallback, useEffect, useState} from "react";
import {subtitle, title} from "@/config/primitives";
import {useSession} from "next-auth/react";
import {usePathname} from "next/navigation";
import {useCensusLoadDispatch, usePlotsLoadDispatch, useQuadratsLoadDispatch} from "@/app/contexts/coredataprovider";
import {useCensusListDispatch, usePlotListDispatch, useQuadratListDispatch} from "@/app/contexts/listselectionprovider";
import {getData} from "@/config/db";
import {siteConfig} from "@/config/macros";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {loadServerDataIntoIDB} from "@/components/client/clientmacros";
import {useLoading} from "@/app/contexts/loadingprovider";

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
  const {data: session} = useSession();

  const [coreDataLoaded, setCoreDataLoaded] = useState(false);

  let pathname = usePathname();

  const fetchAndDispatchCoreData = useCallback(async () => {
    // Removed direct use of Dispatch functions for core data, as it's handled within clientmacros now.
    const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
    setLoading(true, 'Loading Core Data...');

    let lastname = session?.user?.name;
    let email = session?.user?.email;
    if (!lastname || !email) {
      console.error("Session user's name or email is undefined");
      return;
    }

    // Split lastname to get the actual last name
    lastname = lastname.split(' ')[1];

    // Load data from server into IndexedDB
    try {
      setLoading(true, 'Loading Quadrats...');
      await loadServerDataIntoIDB('quadrats', lastname, email);
      const quadratsData = await getData('quadratsLoad');
      const quadratsList = await getData('quadratList');
      quadratsLoadDispatch ? await quadratsLoadDispatch({quadratsLoad: quadratsData}) : undefined;
      quadratListDispatch ? await quadratListDispatch({quadratList: quadratsList}) : undefined;
      await delay(500);
      setLoading(true, 'Loading Census...');
      await loadServerDataIntoIDB('census', lastname, email);
      const censusData = await getData('censusLoad');
      const censusList = await getData('censusList');
      censusLoadDispatch ? await censusLoadDispatch({censusLoad: censusData}) : undefined;
      censusListDispatch ? await censusListDispatch({censusList: censusList}) : undefined;

      await delay(500);
      setLoading(true, 'Loading Plots...');
      await loadServerDataIntoIDB('plots', lastname, email);
      const plotsData = await getData('plotsLoad');
      const plotList = await getData('plotList');
      plotsLoadDispatch ? await plotsLoadDispatch({plotsLoad: plotsData}) : undefined;
      plotsListDispatch ? await plotsListDispatch({plotList: plotList}) : undefined;
    } catch (error) {
      console.error('Error loading server data:', error);
    }

    await delay(500); // Artificial delay for user experience
    setLoading(false);
  }, [session]);

  useEffect(() => {
    // Fetch and dispatch core data
    // Once done, set coreDataLoaded to true
    fetchAndDispatchCoreData()
      .then(() => setCoreDataLoaded(true))
      .catch(console.error);
  }, [fetchAndDispatchCoreData]);

  return (
    <>
      <Sidebar coreDataLoaded={coreDataLoaded}/>
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