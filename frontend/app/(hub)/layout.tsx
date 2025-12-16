'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { title } from '@/config/primitives';
import { useSession } from 'next-auth/react';
import { redirect, usePathname } from 'next/navigation';
import { Box, IconButton, Stack, Typography, useTheme } from '@mui/joy';
import Divider from '@mui/joy/Divider';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useAsyncOperation } from '@/hooks/useAsyncOperation';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch,
  useOrgCensusListDispatch,
  usePlotListDispatch,
  useQuadratListDispatch,
  useSiteListDispatch
} from '@/app/contexts/compat-hooks';
import { useHasHydrated } from '@/config/store/appstore';
import { getEndpointHeaderName, siteConfig } from '@/config/macros/siteconfigs';
import GithubFeedbackModal from '@/components/client/modals/githubfeedbackmodal';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { useLockAnimation } from '../contexts/lockanimationcontext';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';
import { AcaciaVersionTypography } from '@/styles/versions/acaciaversion';
import ReactDOM from 'react-dom';
import ailogger from '@/ailogger';
// Eager load for maximum speed (bundle size not a concern)
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';

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
      <h1 style={{ lineHeight: '1.1em' }} className={title({ color: 'cyan' })} key={endpoint} id="page-title" tabIndex={-1} aria-live="polite">
        {getEndpointHeaderName(endpoint)}
      </h1>
    </Box>
  );
}

export default function HubLayout({ children }: { children: React.ReactNode }) {
  const { setLoading } = useLoading();

  // Hook declarations first
  const censusListDispatch = useOrgCensusListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const siteListDispatch = useSiteListDispatch();
  const plotListDispatch = usePlotListDispatch();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const hasHydrated = useHasHydrated();
  const siteDispatch = useSiteDispatch();
  const plotDispatch = usePlotDispatch();
  const censusDispatch = useOrgCensusDispatch();
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
  const pathname = usePathname() ?? '';
  const coreDataLoaded = siteListLoaded && plotListLoaded && censusListLoaded && quadratListLoaded;
  const { isPulsing } = useLockAnimation();

  // Create stable async functions with useCallback to prevent infinite loops
  // The async functions must be stable so useAsyncOperation's execute callback doesn't change every render
  const fetchSiteListFn = useCallback(async () => {
    const sites = session?.user?.allsites ?? [];
    if (sites.length === 0) {
      const response = await fetch(`/api/fetchall/sites/0/0?schema=`);
      const allsites = await response.json();
      if (siteListDispatch) await siteListDispatch({ siteList: allsites });
    } else {
      if (siteListDispatch) await siteListDispatch({ siteList: sites });
    }
    setSiteListLoaded(true);
  }, [session?.user?.allsites, siteListDispatch]);

  const fetchPlotDataFn = useCallback(async () => {
    if (!currentSite?.schemaName) return;
    const response = await fetch(`/api/fetchall/plots/0/0?schema=${currentSite.schemaName}`);
    const plotsData = await response.json();
    if (!plotsData) throw new Error('Failed to load plots data');
    if (plotListDispatch) await plotListDispatch({ plotList: plotsData });
    setPlotListLoaded(true);
  }, [currentSite?.schemaName, plotListDispatch]);

  const fetchCensusDataFn = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) return;
    const response = await fetch(`/api/fetchall/census/0/0?schema=${currentSite.schemaName}&plotID=${currentPlot.plotID}`);
    const censusRDSLoad = await response.json();
    if (!censusRDSLoad) throw new Error('Failed to load census data');
    const censusArray = Array.isArray(censusRDSLoad) ? censusRDSLoad : [];
    const censusList = await createAndUpdateCensusList(censusArray);
    if (censusListDispatch) await censusListDispatch({ censusList });
    setCensusListLoaded(true);
  }, [currentSite?.schemaName, currentPlot?.plotID, censusListDispatch]);

  const fetchQuadratDataFn = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.plotCensusNumber) return;
    const response = await fetch(`/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite.schemaName}`);
    const quadratsData = await response.json();
    if (!quadratsData) throw new Error('Failed to load quadrats data');
    if (quadratListDispatch) await quadratListDispatch({ quadratList: quadratsData });
    setQuadratListLoaded(true);
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, quadratListDispatch]);

  // Create async operations with stable function references
  const { execute: executeFetchSiteList } = useAsyncOperation(fetchSiteListFn, {
    loadingMessage: 'Loading Sites...',
    category: 'api',
    preventDuplicates: true
  });

  const { execute: executeLoadPlotData } = useAsyncOperation(fetchPlotDataFn, {
    loadingMessage: 'Loading plot data...',
    category: 'api',
    preventDuplicates: true
  });

  const { execute: executeLoadCensusData } = useAsyncOperation(fetchCensusDataFn, {
    loadingMessage: 'Loading census data...',
    category: 'api',
    preventDuplicates: true
  });

  const { execute: executeLoadQuadratData } = useAsyncOperation(fetchQuadratDataFn, {
    loadingMessage: 'Loading quadrat data...',
    category: 'api',
    preventDuplicates: true
  });

  // Fetch site list if session exists and site list has not been loaded
  useEffect(() => {
    if (session && !siteListLoaded && !currentSite) {
      executeFetchSiteList();
    }
    // Intentionally exclude executeFetchSiteList from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, siteListLoaded, currentSite]);

  // Fetch plot data when currentSite is defined and plotList has not been loaded
  useEffect(() => {
    if (currentSite && !plotListLoaded) {
      executeLoadPlotData();
    }
    // Intentionally exclude executeLoadPlotData from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, plotListLoaded]);

  // Fetch census data when currentSite, currentPlot are defined and censusList has not been loaded
  useEffect(() => {
    if (currentSite && currentPlot && !censusListLoaded) {
      executeLoadCensusData();
    }
    // Intentionally exclude executeLoadCensusData from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, currentPlot, censusListLoaded]);

  // Fetch quadrat data when currentSite, currentPlot, currentCensus are defined and quadratList has not been loaded
  useEffect(() => {
    if (currentSite && currentPlot && currentCensus && !quadratListLoaded) {
      executeLoadQuadratData();
    }
    // Intentionally exclude executeLoadQuadratData from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, currentPlot, currentCensus, quadratListLoaded]);

  // Handle manual reset logic
  useEffect(() => {
    async function clearContexts() {
      if (currentSite) {
        if (siteDispatch) await siteDispatch({ site: undefined });
      }
      if (currentPlot) {
        if (plotDispatch) await plotDispatch({ plot: undefined });
      }
      if (currentCensus) {
        if (censusDispatch) await censusDispatch({ census: undefined });
      }
    }

    if (manualReset) {
      setLoading(true, 'Manual refresh beginning...');

      clearContexts()
        .then(() => {
          setSiteListLoaded(false);
        })
        .then(() => {
          setPlotListLoaded(false);
        })
        .then(() => {
          setCensusListLoaded(false);
        })
        .then(() => {
          setQuadratListLoaded(false);
        })
        .finally(() => {
          setManualReset(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualReset, currentSite, currentPlot, currentCensus]);

  // Clear lists and reload data when site, plot, or census changes
  useEffect(() => {
    const hasSiteChanged = previousSiteRef.current !== currentSite?.siteName;
    const hasPlotChanged = previousPlotRef.current !== currentPlot?.plotID;
    const hasCensusChanged = previousCensusRef.current !== (currentCensus?.dateRanges?.[0]?.censusID ?? undefined);

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
        previousCensusRef.current = currentCensus?.dateRanges?.[0]?.censusID ?? undefined;
      }

      await Promise.all(promises);
    };

    if (hasSiteChanged || hasPlotChanged || hasCensusChanged) {
      clearLists().catch(ailogger.error);
    }
  }, [
    currentSite,
    currentPlot,
    currentCensus,
    plotListDispatch,
    censusListDispatch,
    quadratListDispatch
    // Note: execute functions intentionally excluded to prevent cascade effects
  ]);

  // Handle redirection if contexts are reset (i.e., no site, plot, or census) and user is not on the dashboard
  // IMPORTANT: Wait for Zustand store to hydrate from localStorage before checking context values
  // This prevents the redirect from firing before persisted state is restored
  useEffect(() => {
    if (!hasHydrated) {
      // Store hasn't hydrated yet, don't redirect
      return;
    }
    if (currentSite === undefined && currentPlot === undefined && currentCensus === undefined && pathname !== '/dashboard' && !pathname.includes('admin')) {
      redirect('/dashboard');
    }
  }, [pathname, currentSite, currentPlot, currentCensus, hasHydrated]);

  // Handle sidebar visibility based on session presence
  useEffect(() => {
    if (session) {
      const timer = setTimeout(() => {
        setSidebarVisible(true);
      }, 300); // Debounce sidebar visibility with a delay
      return () => clearTimeout(timer);
    }
  }, [session]);

  const theme = useTheme();

  // Detect if on admin page
  const isAdminPage = pathname?.includes('/admin') ?? false;

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      import('@axe-core/react').then(axe => {
        axe.default(React, ReactDOM, 1000).then(() => {});
      });
    }
  }, []);

  return (
    <>
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>
      <Box
        component="nav"
        role="navigation"
        aria-label="Site navigation"
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
        id="main-content"
        tabIndex={-1}
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
          transition: 'margin-left 0.3s ease-in-out',
          '&:focus': {
            outline: 'none'
          }
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'left',
            paddingTop: '20px',
            paddingLeft: '5px',
            paddingBottom: '15px',
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
            paddingLeft: isAdminPage ? 0 : 1,
            paddingRight: isAdminPage ? 0 : 1,
            paddingTop: isAdminPage ? 1 : 0,
            width: '100%',
            boxSizing: 'border-box'
          }}
        >
          {session && <>{children}</>}
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
              <AcaciaVersionTypography>{siteConfig.name}</AcaciaVersionTypography>
            </Typography>
          </Stack>
          <IconButton
            aria-label={'Click here to open the feedback modal and create a Github issue for developer review'}
            onClick={() => setIsFeedbackModalOpen(true)}
            className={isPulsing ? 'animate-pulse-no-opacity' : ''}
            sx={{
              position: 'fixed',
              bottom: 20,
              right: 20,
              zIndex: 2000,
              backgroundColor: 'transparent', // Remove background color
              boxShadow: 'none', // Remove shadow if present
              color: theme.vars.palette.primary.solidColor, // Text/icon color
              opacity: 0.5, // Initial opacity
              transition: 'opacity 0.3s ease',
              '&:hover': {
                opacity: 1,
                backgroundColor: 'transparent' // Ensure no hover background
              },
              '&:focus-visible': {
                outline: `2px solid ${theme.vars.palette.primary.solidColor}` // Add focus ring for accessibility if needed
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
