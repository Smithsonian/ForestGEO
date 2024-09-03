'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { title } from '@/config/primitives';
import { useSession } from 'next-auth/react';
import { redirect, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/joy';
import Divider from '@mui/joy/Divider';
import { useLoading } from '@/app/contexts/loadingprovider';
import { getAllSchemas } from '@/components/processors/processorhelperfunctions';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch, useSiteListDispatch } from '@/app/contexts/listselectionprovider';
import { getEndpointHeaderName, siteConfig } from '@/config/macros/siteconfigs';
import { AcaciaVersionTypography } from '@/styles/versions/acaciaversion';
import GithubFeedbackModal from '@/components/client/githubfeedbackmodal';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { useLockAnimation } from '../contexts/lockanimationcontext';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';

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

  const fetchSiteList = useCallback(async () => {
    try {
      setLoading(true, 'Loading Sites...');
      if (session && !siteListLoaded) {
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

  const loadData = useCallback(async () => {
    try {
      setLoading(true, 'Loading data...');

      const promises = [];

      // Load plot data
      if (currentSite && !plotListLoaded) {
        const loadPlots = fetch(`/api/fetchall/plots?schema=${currentSite?.schemaName || ''}`)
          .then(response => response.json())
          .then(plotsData => {
            if (!plotsData) throw new Error('Failed to load plots data');
            if (plotListDispatch) return plotListDispatch({ plotList: plotsData });
          });
        promises.push(loadPlots);
        setPlotListLoaded(true);
      }

      // Load census data
      if (currentSite && currentPlot && !censusListLoaded) {
        const loadCensus = fetch(`/api/fetchall/census/${currentPlot.plotID}?schema=${currentSite.schemaName}`)
          .then(response => response.json())
          .then(async censusRDSLoad => {
            if (!censusRDSLoad) throw new Error('Failed to load census data');
            const censusList = await createAndUpdateCensusList(censusRDSLoad);
            if (censusListDispatch) return censusListDispatch({ censusList });
          });
        promises.push(loadCensus);
        setCensusListLoaded(true);
      }

      // Load quadrat data
      if (currentSite && currentPlot && currentCensus && !quadratListLoaded) {
        const loadQuadrats = fetch(`/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite.schemaName}`)
          .then(response => response.json())
          .then(quadratsData => {
            if (!quadratsData) throw new Error('Failed to load quadrats data');
            if (quadratListDispatch) return quadratListDispatch({ quadratList: quadratsData });
          });
        promises.push(loadQuadrats);
        setQuadratListLoaded(true);
      }

      // Wait for all promises to resolve
      await Promise.all(promises);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [
    currentSite,
    currentPlot,
    currentCensus,
    plotListLoaded,
    censusListLoaded,
    quadratListLoaded,
    plotListDispatch,
    censusListDispatch,
    quadratListDispatch,
    setLoading
  ]);

  useEffect(() => {
    if (currentSite || currentPlot || currentCensus) {
      loadData().catch(console.error);
    }
  }, [currentSite, currentPlot, currentCensus, loadData]);

  useEffect(() => {
    if (manualReset) {
      setLoading(true, 'Manual refresh beginning...');
      setSiteListLoaded(false);
      setPlotListLoaded(false);
      setCensusListLoaded(false);
      setQuadratListLoaded(false);
      setManualReset(false);
      loadData().catch(console.error);
    }
  }, [manualReset, loadData]);

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

      // After clearing, load the new data
      loadData().catch(console.error);
    };

    if (hasSiteChanged || hasPlotChanged || hasCensusChanged) {
      clearLists().catch(console.error);
    }
  }, [currentSite, currentPlot, currentCensus, plotListDispatch, censusListDispatch, quadratListDispatch, loadData]);

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
              {siteConfig.name}
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center' }}>
              <Tooltip title="Version" variant="solid" placement="top" arrow>
                <Box sx={{ display: 'inline-block', verticalAlign: 'middle' }}>
                  <AcaciaVersionTypography>{siteConfig.version}</AcaciaVersionTypography>
                </Box>
              </Tooltip>
            </Stack>
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
