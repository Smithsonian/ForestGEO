'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { title } from '@/config/primitives';
import { useSession } from 'next-auth/react';
import { redirect, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Box, IconButton, Stack, Typography } from '@mui/joy';
import Divider from '@mui/joy/Divider';
import { useLoading } from '@/app/contexts/loadingprovider';
import { getAllSchemas } from '@/components/processors/processorhelperfunctions';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch, useSiteListDispatch } from '@/app/contexts/listselectionprovider';
import { getEndpointHeaderName, siteConfig } from '@/config/macros/siteconfigs';
import GithubFeedbackModal from '@/components/client/githubfeedbackmodal';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { useLockAnimation } from '../contexts/lockanimationcontext';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';
import { AcaciaVersionTypography } from '@/styles/versions/acaciaversion';

const Sidebar = dynamic(() => import('@/components/sidebar'), { ssr: false });
const Header = dynamic(() => import('@/components/header'), { ssr: false });

function renderSwitch(endpoint: string) {
  const commonStyle = {
    display: 'flex',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    minHeight: '50px'
  };

  return (
    <Box sx={commonStyle}>
      <h1 style={{ lineHeight: '1.1em' }} className={title({ color: 'cyan' })} key={endpoint}>
        {getEndpointHeaderName(endpoint)}
      </h1>
    </Box>
  );
}

export default function HubLayout({ children }: { children: React.ReactNode }) {
  const { setLoading } = useLoading();

  const censusListDispatch = useOrgCensusListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const siteListDispatch = useSiteListDispatch();
  const plotListDispatch = usePlotListDispatch();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { data: session } = useSession();
  const previousSiteRef = useRef<string | undefined>(undefined);
  const previousPlotRef = useRef<number | undefined>(undefined);
  const previousCensusRef = useRef<number | undefined>(undefined);

  const [siteListLoaded, setSiteListLoaded] = useState(false);
  const [plotListLoaded, setPlotListLoaded] = useState(false);
  const [censusListLoaded, setCensusListLoaded] = useState(false);
  const [quadratListLoaded, setQuadratListLoaded] = useState(false);
  const [manualReset, setManualReset] = useState(false);
  const [isSidebarVisible, setSidebarVisible] = useState(!!session);

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const pathname = usePathname();
  const coreDataLoaded = siteListLoaded && plotListLoaded && censusListLoaded && quadratListLoaded;
  const { isPulsing } = useLockAnimation();

  const lastExecutedRef = useRef<number | null>(null);
  // Refs for debouncing
  const plotLastExecutedRef = useRef<number | null>(null);
  const censusLastExecutedRef = useRef<number | null>(null);
  const quadratLastExecutedRef = useRef<number | null>(null);

  // Debounce delay
  const debounceDelay = 100;

  const fetchSiteList = useCallback(async () => {
    const now = Date.now();
    if (lastExecutedRef.current && now - lastExecutedRef.current < debounceDelay + 200) {
      return;
    }

    // Update last executed timestamp
    lastExecutedRef.current = now;

    try {
      setLoading(true, 'Loading Sites...');
      if (session && !siteListLoaded && !currentSite) {
        const sites = session?.user?.allsites ?? [];
        if (sites.length === 0) {
          throw new Error('Session sites undefined');
        } else {
          if (siteListDispatch) await siteListDispatch({ siteList: sites });
        }
      }
    } catch (e: any) {
      const allsites = await getAllSchemas();
      if (siteListDispatch) await siteListDispatch({ siteList: allsites });
    } finally {
      setLoading(false);
    }
  }, [session, siteListLoaded, siteListDispatch, setLoading]);

  const loadPlotData = useCallback(async () => {
    const now = Date.now();
    if (plotLastExecutedRef.current && now - plotLastExecutedRef.current < debounceDelay) {
      return;
    }
    plotLastExecutedRef.current = now;

    try {
      setLoading(true, 'Loading plot data...');
      if (currentSite && !plotListLoaded) {
        const response = await fetch(`/api/fetchall/plots?schema=${currentSite?.schemaName || ''}`);
        const plotsData = await response.json();
        if (!plotsData) throw new Error('Failed to load plots data');
        if (plotListDispatch) await plotListDispatch({ plotList: plotsData });
        setPlotListLoaded(true);
      }
    } catch (error) {
      console.error('Error loading plot data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentSite, plotListLoaded, plotListDispatch, setLoading]);

  // Function to load census data with debounce
  const loadCensusData = useCallback(async () => {
    const now = Date.now();
    if (censusLastExecutedRef.current && now - censusLastExecutedRef.current < debounceDelay) {
      return;
    }
    censusLastExecutedRef.current = now;

    try {
      setLoading(true, 'Loading census data...');
      if (currentSite && currentPlot && !censusListLoaded) {
        const response = await fetch(`/api/fetchall/census/${currentPlot.plotID}?schema=${currentSite.schemaName}`);
        const censusRDSLoad = await response.json();
        if (!censusRDSLoad) throw new Error('Failed to load census data');
        const censusList = await createAndUpdateCensusList(censusRDSLoad);
        if (censusListDispatch) await censusListDispatch({ censusList });
        setCensusListLoaded(true);
      }
    } catch (error) {
      console.error('Error loading census data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentSite, currentPlot, censusListLoaded, censusListDispatch, setLoading]);

  // Function to load quadrat data with debounce
  const loadQuadratData = useCallback(async () => {
    const now = Date.now();
    if (quadratLastExecutedRef.current && now - quadratLastExecutedRef.current < debounceDelay) {
      return;
    }
    quadratLastExecutedRef.current = now;

    try {
      setLoading(true, 'Loading quadrat data...');
      if (currentSite && currentPlot && currentCensus && !quadratListLoaded) {
        const response = await fetch(`/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite.schemaName}`);
        const quadratsData = await response.json();
        if (!quadratsData) throw new Error('Failed to load quadrats data');
        if (quadratListDispatch) await quadratListDispatch({ quadratList: quadratsData });
        setQuadratListLoaded(true);
      }
    } catch (error) {
      console.error('Error loading quadrat data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentSite, currentPlot, currentCensus, quadratListLoaded, quadratListDispatch, setLoading]);

  useEffect(() => {
    if (currentSite && siteListLoaded) {
      loadPlotData().catch(console.error);
    }
    if (currentSite && siteListLoaded && currentPlot && plotListLoaded) {
      loadCensusData().catch(console.error);
    }
    if (currentSite && siteListLoaded && currentPlot && plotListLoaded && currentCensus && censusListLoaded) {
      loadQuadratData().catch(console.error);
    }
  }, [currentSite, currentPlot, currentCensus, loadPlotData, loadCensusData, loadQuadratData]);

  // Fetch site list when siteListLoaded is false
  useEffect(() => {
    if (!siteListLoaded) {
      fetchSiteList().catch(console.error);
    }
  }, [siteListLoaded, fetchSiteList]);

  // Fetch plot data when plotListLoaded is false and currentSite is defined
  useEffect(() => {
    if (currentSite && !plotListLoaded) {
      loadPlotData().catch(console.error);
    }
  }, [plotListLoaded, currentSite, loadPlotData]);

  // Fetch census data when censusListLoaded is false and currentSite and currentPlot are defined
  useEffect(() => {
    if (currentSite && currentPlot && !censusListLoaded) {
      loadCensusData().catch(console.error);
    }
  }, [censusListLoaded, currentSite, currentPlot, loadCensusData]);

  // Fetch quadrat data when quadratListLoaded is false and currentSite, currentPlot, and currentCensus are defined
  useEffect(() => {
    if (currentSite && currentPlot && currentCensus && !quadratListLoaded) {
      loadQuadratData().catch(console.error);
    }
  }, [quadratListLoaded, currentSite, currentPlot, currentCensus, loadQuadratData]);

  // Manual reset logic
  useEffect(() => {
    if (manualReset) {
      setLoading(true, 'Manual refresh beginning...');

      // Set all loaded states to false to trigger the re-fetching
      setSiteListLoaded(false);
      setPlotListLoaded(false);
      setCensusListLoaded(false);
      setQuadratListLoaded(false);

      setManualReset(false);
    }
  }, [manualReset]);

  // Fetch site list if session exists and site list has not been loaded
  useEffect(() => {
    if (session && !siteListLoaded) {
      fetchSiteList().catch(console.error);
    }
  }, [fetchSiteList, session, siteListLoaded]);

  useEffect(() => {
    const hasSiteChanged = previousSiteRef.current !== currentSite?.siteName;
    const hasPlotChanged = previousPlotRef.current !== currentPlot?.plotID;
    const hasCensusChanged = previousCensusRef.current !== currentCensus?.dateRanges[0]?.censusID;

    const clearLists = async () => {
      const promises = [];

      if (hasSiteChanged) {
        // Clear plot, census, and quadrat lists when a new site is selected
        setPlotListLoaded(false);
        setCensusListLoaded(false);
        setQuadratListLoaded(false);
        if (plotListDispatch) promises.push(plotListDispatch({ plotList: undefined }));
        if (censusListDispatch) promises.push(censusListDispatch({ censusList: undefined }));
        if (quadratListDispatch) promises.push(quadratListDispatch({ quadratList: undefined }));
        previousSiteRef.current = currentSite?.siteName;
      }

      if (hasPlotChanged) {
        // Clear census and quadrat lists when a new plot is selected
        setCensusListLoaded(false);
        setQuadratListLoaded(false);
        if (censusListDispatch) promises.push(censusListDispatch({ censusList: undefined }));
        if (quadratListDispatch) promises.push(quadratListDispatch({ quadratList: undefined }));
        previousPlotRef.current = currentPlot?.plotID;
      }

      if (hasCensusChanged) {
        // Clear quadrat list when a new census is selected
        setQuadratListLoaded(false);
        if (quadratListDispatch) promises.push(quadratListDispatch({ quadratList: undefined }));
        previousCensusRef.current = currentCensus?.dateRanges[0]?.censusID;
      }

      await Promise.all(promises);

      // Add a short delay to ensure UI reflects clearing lists before loading new data
      setTimeout(() => {
        loadPlotData()
          .then(() => loadCensusData())
          .then(() => loadQuadratData())
          .catch(console.error);
      }, 300); // 300ms delay for UI reset
    };

    if (hasSiteChanged || hasPlotChanged || hasCensusChanged) {
      clearLists().catch(console.error);
    }
  }, [currentSite, currentPlot, currentCensus, plotListDispatch, censusListDispatch, quadratListDispatch, loadPlotData, loadCensusData, loadQuadratData]);

  useEffect(() => {
    // if contexts are reset due to website refresh, system needs to redirect user back to dashboard
    if (currentSite === undefined && currentPlot === undefined && currentCensus === undefined && pathname !== '/dashboard') {
      redirect('/dashboard');
    }
  }, [pathname, currentSite, currentPlot, currentCensus]);

  useEffect(() => {
    if (session) {
      const timer = setTimeout(() => {
        setSidebarVisible(true);
      }, 300); // Debounce the sidebar visibility with a delay
      return () => clearTimeout(timer);
    }
  }, [session]);

  return (
    <>
      <Box
        className={`sidebar ${isSidebarVisible ? 'visible' : 'hidden'} ${isPulsing ? `animate-fade-blur-in` : ``}`}
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          zIndex: 1000
        }}
      >
        <Sidebar setCensusListLoaded={setCensusListLoaded} siteListLoaded={siteListLoaded} coreDataLoaded={coreDataLoaded} setManualReset={setManualReset} />
      </Box>
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
          minHeight: 'calc(100vh - var(--Header-height) - 30px)',
          marginLeft: isSidebarVisible ? 'calc(var(--Sidebar-width) + 5px)' : '0',
          transition: 'margin-left 0.3s ease-in-out'
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'left',
            paddingTop: '25px',
            paddingLeft: '5px',
            paddingBottom: '20px',
            flexDirection: 'column'
          }}
          className={isPulsing ? 'animate-fade-blur-in' : ''}
        >
          {renderSwitch(pathname)}
        </Box>
        <Divider orientation="horizontal" sx={{ my: '5px' }} />
        <Box
          className={isPulsing ? 'animate-fade-blur-in' : ''}
          sx={{
            display: 'flex',
            flexGrow: 1,
            flexShrink: 1,
            alignItems: 'flex-start',
            flexDirection: 'column',
            paddingLeft: 2
          }}
        >
          {session?.user.name && session.user.email && session.user.userStatus && <>{children}</>}
        </Box>
        <Divider orientation="horizontal" />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mt: 2,
            position: 'relative'
          }}
        >
          <Stack
            spacing={1}
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%'
            }}
            divider={<Divider orientation="vertical" />}
            className={isPulsing ? 'animate-fade-blur-in' : ''}
          >
            <Typography
              level="h1"
              sx={{
                color: 'plum',
                display: 'inline-block',
                verticalAlign: 'middle',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {/*{siteConfig.name}*/}
              <AcaciaVersionTypography>{siteConfig.name}</AcaciaVersionTypography>
            </Typography>
            {/*<Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center' }}>*/}
            {/*  <Tooltip title="Version" variant="solid" placement="top" arrow sx={{ pointerEvents: 'none' }}>*/}
            {/*    <Box sx={{ display: 'inline-block', verticalAlign: 'middle' }}>*/}
            {/*      <AcaciaVersionTypography>{siteConfig.version}</AcaciaVersionTypography>*/}
            {/*    </Box>*/}
            {/*  </Tooltip>*/}
            {/*</Stack>*/}
          </Stack>
          <IconButton
            onClick={() => setIsFeedbackModalOpen(true)}
            className={isPulsing ? 'animate-pulse-no-opacity' : ''}
            sx={{
              position: 'fixed',
              bottom: 20,
              right: 20,
              zIndex: 2000,
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': {
                bgcolor: 'primary.dark'
              }
            }}
          >
            <HelpOutlineOutlinedIcon fontSize="large" />
          </IconButton>
        </Box>
      </Box>
      <GithubFeedbackModal open={isFeedbackModalOpen} onClose={() => setIsFeedbackModalOpen(false)} />
    </>
  );
}
