"use client";
import React, { useEffect, useCallback, useRef, useState } from "react";
import { subtitle, title } from "@/config/primitives";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  useCensusLoadContext,
  useCensusLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch
} from "@/app/contexts/coredataprovider";
import {
  useCensusListContext,
  useCensusListDispatch,
  useQuadratListDispatch,
  useSiteListDispatch,
  useSubquadratListDispatch
} from "@/app/contexts/listselectionprovider";
import { clearAllIDBData, getData } from "@/config/db";
import { siteConfig } from "@/config/macros/siteconfigs";
const Sidebar = dynamic(() => import('@/components/sidebar'), { ssr: false });
const Header = dynamic(() => import('@/components/header'), { ssr: false });
import { Box, Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from "@mui/joy";
import Divider from "@mui/joy/Divider";
import { useLoading } from "@/app/contexts/loadingprovider";
import { loadServerDataIntoIDB } from "@/config/updatecontextsfromidb";
import {
  useCensusDispatch,
  usePlotDispatch,
  useQuadratDispatch,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import { getAllSchemas } from "@/components/processors/processorhelperfunctions";
import { useJoyride } from "../contexts/joyrideprovider";
import dynamic from "next/dynamic";
import { Step } from "react-joyride";

function renderSwitch(endpoint: string) {
  switch (endpoint) {
    case '/dashboard':
      return <h3 className={title({ color: "cyan" })} key={endpoint}>Dashboard - ForestGEO Application User Guide</h3>;
    case '/measurementshub/summary':
      return <h3 className={title({ color: "green" })} key={endpoint}>Measurements Summary</h3>;
    case '/measurementshub/validationhistory':
      return <h3 className={title({ color: "green" })} key={endpoint}>Validation History</h3>;
    case '/fixeddatainput/attributes':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data Hub - Attributes</h3>;
    case '/fixeddatainput/census':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Census</h3>;
    case '/fixeddatainput/personnel':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Personnel</h3>;
    case '/fixeddatainput/quadrats':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Quadrats</h3>;
    case '/fixeddatainput/subquadrats':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Subquadrats</h3>;
    case '/fixeddatainput/quadratpersonnel':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - QuadratPersonnel</h3>;
    case '/fixeddatainput/alltaxonomies':
      return <h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Species</h3>;
    default:
      return <></>;
  }
}

export default function HubLayout({ children, }: Readonly<{ children: React.ReactNode }>) {
  const { setLoading } = useLoading();

  const censusLoadDispatch = useCensusLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
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
  const { data: session } = useSession();
  const previousSiteRef = useRef<string | undefined>(undefined);
  const { startTutorial, stopTutorial, runTutorial } = useJoyride();

  const [siteListLoaded, setSiteListLoaded] = useState(false);
  const [coreDataLoaded, setCoreDataLoaded] = useState(false);
  const [manualReset, setManualReset] = useState(false);

  // Helper function to manage loading operations count
  const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
  let pathname = usePathname();

  useEffect(() => {
    const updateCensusList = async () => {
      if (!censusLoadContext) return;

      let uniqueCensusMap = new Map();
      censusLoadContext.forEach(censusRDS => {
        const plotCensusNumber = censusRDS?.plotCensusNumber || 0;
        let existingCensus = uniqueCensusMap.get(plotCensusNumber);
        if (!existingCensus) {
          uniqueCensusMap.set(plotCensusNumber, {
            plotID: censusRDS?.plotID || 0,
            plotCensusNumber,
            startDate: censusRDS?.startDate ? new Date(censusRDS.startDate) : undefined,
            endDate: censusRDS?.endDate ? new Date(censusRDS.endDate) : undefined,
            description: censusRDS?.description || ''
          });
        } else {
          if (censusRDS?.startDate) {
            let newStartDate = new Date(censusRDS.startDate);
            existingCensus.startDate = existingCensus.startDate
              ? new Date(Math.min(existingCensus.startDate.getTime(), newStartDate.getTime()))
              : newStartDate;
          }
          if (censusRDS?.endDate) {
            let newEndDate = new Date(censusRDS.endDate);
            existingCensus.endDate = existingCensus.endDate
              ? new Date(Math.max(existingCensus.endDate.getTime(), newEndDate.getTime()))
              : newEndDate;
          }
        }
      });

      // Check if the census list actually needs to be updated
      const newCensusList = Array.from(uniqueCensusMap.values());
      if (JSON.stringify(censusListContext) !== JSON.stringify(newCensusList)) {
        if (censusListDispatch) {
          await censusListDispatch({ censusList: newCensusList });
        }
      }
    };

    updateCensusList().catch(console.error);
  }, [censusLoadContext, censusListContext, censusListDispatch]);

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
          await loadServerDataIntoIDB('census', currentSite?.schemaName || '');
          const censusData = await getData('censusLoad');
          const censusList = await getData('censusList');

          if (!censusData || !censusList) return false;
          censusLoadDispatch && await censusLoadDispatch({ censusLoad: censusData });
          censusListDispatch && await censusListDispatch({ censusList: censusList });
          return true;
        };

        // Function to load and dispatch Plots data
        const loadPlotsQuadratsSubquadratsData = async () => {
          // load plots
          await loadServerDataIntoIDB('plots', currentSite.schemaName || '');
          const plotsData = await getData('plotsLoad');
          console.log('Plots Data', plotsData);
          if (!plotsData) return false;
          plotsLoadDispatch && await plotsLoadDispatch({ plotsLoad: plotsData });
          await delay(delayValue);
          // load quadrats
          await loadServerDataIntoIDB('quadrats', currentSite.schemaName || '');

          const quadratsData = await getData('quadratsLoad');
          const quadratList = await getData('quadratList');

          if (!quadratsData || !quadratList) return false;
          quadratsLoadDispatch && await quadratsLoadDispatch({ quadratsLoad: quadratsData });
          quadratListDispatch && await quadratListDispatch({ quadratList: quadratList });

          // load subquadrats
          await loadServerDataIntoIDB('subquadrats', currentSite.schemaName || '');

          const subquadratList = await getData('subquadratList');
          if (!subquadratList) return false;
          subquadratListDispatch && subquadratListDispatch({ subquadratList: subquadratList });
        };

        // Parallelize data loading
        await Promise.all([loadPlotsQuadratsSubquadratsData(), loadCensusData()]);
      } catch (error: any) {
        console.error('Error loading server data:', error.message);
        throw new Error(error);
      }

      // want to try and pre-load validation states
    }
    setLoading(false);
  }, [currentSite, session, setLoading]);

  const fetchSiteList = useCallback(async () => {
    // Removed direct use of Dispatch functions for core data, as it's handled within clientmacros now.
    setLoading(true, 'Loading Sites...');
    await delay(delayValue);
    try {
      if (session && !siteListLoaded) {
        let email = session?.user?.email ?? '';
        if (email === '') {
          throw new Error("Session user's name or email is undefined");
        }
        let sites = session?.user?.allsites ?? [];
        if (sites.length === 0) {
          throw new Error("Session sites undefined");
        } else {
          siteListDispatch ? await siteListDispatch({ siteList: sites }) : undefined;
          await delay(delayValue);
        }
      }
    } catch (e: any) {
      const allsites = await getAllSchemas();
      siteListDispatch ? await siteListDispatch({ siteList: allsites }) : undefined;
    }

    setLoading(false);
  }, [session, setLoading]);

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
      if (quadratDispatch) quadratDispatch({ quadrat: undefined }).catch(console.error);
      if (censusDispatch) censusDispatch({ census: undefined }).catch(console.error);
      if (plotDispatch) plotDispatch({ plot: undefined }).catch(console.error);
      setLoading(false);

      // Site list loaded and current site selected, fetch core data
      fetchAndUpdateCoreData().then(() => {
        setCoreDataLoaded(true);
        startTutorial(); // Start the tutorial after core data is loaded
      }).catch(console.error);
    }
  }, [siteListLoaded, currentSite, coreDataLoaded, fetchAndUpdateCoreData, startTutorial]);

  useEffect(() => {
    if (manualReset) {
      setLoading(true, "Manual refresh beginning...");
      clearAllIDBData().catch(console.error);
      setCoreDataLoaded(false);
      setSiteListLoaded(false);
      if (quadratDispatch) quadratDispatch({ quadrat: undefined }).catch(console.error);
      if (censusDispatch) censusDispatch({ census: undefined }).catch(console.error);
      if (plotDispatch) plotDispatch({ plot: undefined }).catch(console.error);
      setManualReset(false);
      setLoading(false);
    }
  }, [manualReset]);

  return (
    <>
      <Modal open={false} onClose={stopTutorial}>
        <ModalDialog>
          <DialogTitle>Tutorial</DialogTitle>
          <DialogContent>
            <Typography>Would you like to start the tutorial?</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={stopTutorial}>Skip</Button>
            <Button onClick={startTutorial}>Start</Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
      <Sidebar siteListLoaded={siteListLoaded} coreDataLoaded={coreDataLoaded} setManualReset={setManualReset} />
      <Header />
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
        <Divider orientation={"horizontal"} sx={{ my: '5px' }} />
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
        <Divider orientation={"horizontal"} />
        <Box mt={3}
          sx={{
            display: 'flex',
            alignItems: 'center',
            alignSelf: 'center',
            flexDirection: 'row',
            marginBottom: '15px'
          }}>
          <Box>
            <h1 className={title({ color: "violet" })}>{siteConfig.name}&nbsp;</h1>
          </Box>
          <Divider orientation={"vertical"} sx={{ marginRight: 2 }} />
          <Box>
            <p className={subtitle({ color: "cyan" })}>{siteConfig.description}</p>
          </Box>
        </Box>
      </Box>
    </>
  );
}
