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
  useSiteListDispatch,
  useSubquadratListDispatch
} from "@/app/contexts/listselectionprovider";
import {getData} from "@/config/db";
import {siteConfig} from "@/config/macros/siteconfigs";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {useLoading} from "@/app/contexts/loadingprovider";
import {loadServerDataIntoIDB} from "@/config/updatecontextsfromidb";
import {
  useCensusDispatch,
  usePlotDispatch,
  useQuadratDispatch,
  useSiteContext
} from "@/app/contexts/userselectionprovider";

function renderSwitch(endpoint: string) {
  switch (endpoint) {
    case '/dashboard':
      return <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard - ForestGEO Application User Guide</h3>;
    case '/measurementshub/summary':
      return <h3 className={title({color: "green"})} key={endpoint}>Measurements Summary</h3>;
    case '/measurementshub/validationhistory':
      return <h3 className={title({color: "green"})} key={endpoint}>Validation History</h3>;
    case '/properties/attributes':
      return <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Attributes</h3>;
    case '/properties/census':
      return <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Census</h3>;
    case '/properties/personnel':
      return <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Personnel</h3>;
    case '/properties/quadrats':
      return <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Quadrats</h3>;
    case '/properties/species':
      return <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Species</h3>;
    case '/censusform':
      return <h3 className={title({color: "sky"})} key={endpoint}>Census Form</h3>;
    default:
      return <></>;
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
  const subquadratListDispatch = useSubquadratListDispatch();
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

  // Helper function to manage loading operations count
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
        if (censusListDispatch) {
          await censusListDispatch({censusList: newCensusList});
        }
      }
    };

    updateCensusList().catch(console.error);
  }, [censusLoadDispatch]);

  const fetchAndUpdateCoreData = useCallback(async () => {
    setLoading(true, "Loading Core Data...");
    if (session && currentSite) {
      let email = session?.user?.email ?? '';
      if (email === '') {
        throw new Error("Session user's name or email is undefined");
      }
      try {
        // Function to load and dispatch Census data
        const loadCensusData = async () => {
          await loadServerDataIntoIDB('census', currentSite.schemaName);
          const censusData = await getData('censusLoad');
          const censusList = await getData('censusList');

          if (!censusData || !censusList) return false;
          censusLoadDispatch && await censusLoadDispatch({censusLoad: censusData});
          censusListDispatch && await censusListDispatch({censusList: censusList});
          return true;
        };

        // Function to load and dispatch Plots data
        const loadPlotsQuadratsSubquadratsData = async () => {
          // load quadrats
          await loadServerDataIntoIDB('quadrats', currentSite.schemaName);

          const quadratsData = await getData('quadratsLoad');
          const quadratList = await getData('quadratList');

          if (!quadratsData || !quadratList) return false;
          quadratsLoadDispatch && await quadratsLoadDispatch({quadratsLoad: quadratsData});
          quadratListDispatch && await quadratListDispatch({quadratList: quadratList});

          // load subquadrats
          await loadServerDataIntoIDB('subquadrats', currentSite.schemaName);

          const subquadratList = await getData('subquadratList');
          if (!subquadratList) return false;
          subquadratListDispatch && subquadratListDispatch({subquadratList: subquadratList});
          // load plots
          await loadServerDataIntoIDB('plots', currentSite.schemaName);
          const plotsData = await getData('plotsLoad');
          const plotList = await getData('plotList');
          if (!plotsData || !plotList) return false;
          plotsLoadDispatch && await plotsLoadDispatch({plotsLoad: plotsData});
          plotsListDispatch && await plotsListDispatch({plotList: plotList});
          await delay(delayValue);
          return true;
        };

        // Parallelize data loading
        await Promise.all([loadPlotsQuadratsSubquadratsData(), loadCensusData()]);
      } catch (error: any) {
        console.error('Error loading server data:', error.message);
        throw new Error(error);
      }
    }
    setLoading(false);
  }, [currentSite, session]);

  const fetchSiteList = useCallback(async () => {
    // Removed direct use of Dispatch functions for core data, as it's handled within clientmacros now.
    setLoading(true, 'Loading Sites...');
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
        siteListDispatch ? await siteListDispatch({siteList: sites}) : undefined;
        await delay(delayValue);
      }
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session && !siteListLoaded) {
      fetchSiteList()
        .then(() => setSiteListLoaded(true))
        .catch(console.error);
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
      setLoading(true, "Clearing selections...");
      if (quadratDispatch) quadratDispatch({quadrat: null}).catch(console.error);
      if (censusDispatch) censusDispatch({census: null}).catch(console.error);
      if (plotDispatch) plotDispatch({plot: null}).catch(console.error);
      setLoading(false);

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