'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { title } from '@/config/primitives';
import { useSession } from 'next-auth/react';
import { redirect, usePathname } from 'next/navigation';
import { Box, Drawer, IconButton, Menu, MenuItem, Stack, Typography, useTheme } from '@mui/joy';
import useMediaQuery from '@mui/material/useMediaQuery';
import Divider from '@mui/joy/Divider';
import { useAsyncOperation } from '@/app/hooks/useAsyncOperation';
import { useLoadState, combineLoadStates } from '@/app/hooks/useLoadState';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  usePlotContext,
  useSiteContext,
  useOrgCensusListDispatch,
  usePlotListDispatch,
  useQuadratListDispatch,
  useSiteListDispatch
} from '@/app/contexts/compat-hooks';
import { useHasHydrated } from '@/config/store/appstore';
import { DOCUMENTATION_URL, getEndpointHeaderName, siteConfig } from '@/config/macros/siteconfigs';
import GithubFeedbackModal from '@/components/client/modals/githubfeedbackmodal';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { useLockAnimation } from '../contexts/lockanimationcontext';
import { createAndUpdateCensusList, reconcileCurrentCensusSelection } from '@/lib/db/definitions/timekeeping';
import ReactDOM from 'react-dom';
import ailogger from '@/ailogger';
// Eager load for maximum speed (bundle size not a concern)
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import { MOBILE_SIDEBAR_TOGGLE_EVENT } from '@/config/utils';
import UploadJobStatusBadge from '@/components/client/uploadjobstatusbadge';

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
  // Hook declarations first
  const censusListDispatch = useOrgCensusListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const siteListDispatch = useSiteListDispatch();
  const plotListDispatch = usePlotListDispatch();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const hasHydrated = useHasHydrated();
  const censusDispatch = useOrgCensusDispatch();
  const { data: session } = useSession();
  const previousSiteRef = useRef<string | undefined>(undefined);
  const previousPlotRef = useRef<number | undefined>(undefined);
  const previousCensusRef = useRef<number | undefined>(undefined);

  // Load states for each data resource - provides idle/loading/loaded/error states
  const siteListLoad = useLoadState();
  const plotListLoad = useLoadState();
  const censusListLoad = useLoadState();
  const quadratListLoad = useLoadState();

  // Aggregate load state
  const { allLoaded: coreDataLoaded, anyError: hasLoadError } = combineLoadStates([siteListLoad, plotListLoad, censusListLoad, quadratListLoad]);

  const [isSidebarVisible, setSidebarVisible] = useState(!!session);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [helpMenuAnchor, setHelpMenuAnchor] = useState<HTMLElement | null>(null);
  const pathname = usePathname() ?? '';
  const { isPulsing } = useLockAnimation();

  useEffect(() => {
    const toggleMobileSidebar = () => setMobileSidebarOpen(open => !open);
    window.addEventListener(MOBILE_SIDEBAR_TOGGLE_EVENT, toggleMobileSidebar);
    return () => window.removeEventListener(MOBILE_SIDEBAR_TOGGLE_EVENT, toggleMobileSidebar);
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  // API path convention: /api/fetchall/{resource}/{plotID}/{censusNumber}?schema={schemaName}
  // - plotID=0 and censusNumber=0 means "no filter" (fetch all)
  // - schema="" (empty) fetches across all schemas
  const fetchSiteListFn = useCallback(async () => {
    if (!session || session.user.permissionsUnavailable) return;
    siteListLoad.setLoading();
    try {
      const sites = session?.user?.allsites ?? [];
      if (sites.length === 0) {
        const response = await fetch(`/api/fetchall/sites/0/0?schema=`);
        if (!response.ok) throw new Error(`Failed to fetch sites: ${response.status}`);
        const allsites = await response.json();
        if (siteListDispatch) siteListDispatch({ siteList: allsites });
      } else {
        if (siteListDispatch) siteListDispatch({ siteList: sites });
      }
      siteListLoad.setLoaded();
    } catch (error) {
      ailogger.error('Failed to fetch site list:', error instanceof Error ? error : undefined);
      siteListLoad.setError();
    }
  }, [session, siteListDispatch, siteListLoad]);

  const fetchPlotDataFn = useCallback(async () => {
    if (!currentSite?.schemaName) return;
    plotListLoad.setLoading();
    try {
      const response = await fetch(`/api/fetchall/plots/0/0?schema=${currentSite.schemaName}`);
      if (!response.ok) throw new Error(`Failed to fetch plots: ${response.status}`);
      const plotsData = await response.json();
      if (plotListDispatch) plotListDispatch({ plotList: plotsData });
      plotListLoad.setLoaded();
    } catch (error) {
      ailogger.error('Failed to fetch plot data:', error instanceof Error ? error : undefined);
      plotListLoad.setError();
    }
  }, [currentSite?.schemaName, plotListDispatch, plotListLoad]);

  const fetchCensusDataFn = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) return;
    censusListLoad.setLoading();
    try {
      const response = await fetch(`/api/fetchall/census/${currentPlot.plotID}/0?schema=${currentSite.schemaName}&plotID=${currentPlot.plotID}`);
      if (!response.ok) throw new Error(`Failed to fetch census: ${response.status}`);
      const censusRDSLoad = await response.json();
      const censusArray = Array.isArray(censusRDSLoad) ? censusRDSLoad : [];
      const censusList = await createAndUpdateCensusList(censusArray);
      if (censusListDispatch) censusListDispatch({ censusList });

      if (censusDispatch && currentCensus) {
        const reconciledCensus = reconcileCurrentCensusSelection(currentCensus, censusList);
        const persistedCensusID = currentCensus.dateRanges?.[0]?.censusID;
        const reconciledCensusID = reconciledCensus?.dateRanges?.[0]?.censusID;

        if (!reconciledCensus) {
          ailogger.warn(
            `Clearing stale census selection for schema ${currentSite.schemaName}, plot ${currentPlot.plotID}: persisted census ${persistedCensusID ?? 'unknown'} no longer exists`
          );
          await censusDispatch({ census: undefined });
        } else if (persistedCensusID !== reconciledCensusID) {
          ailogger.info(
            `Reconciled stale census selection for schema ${currentSite.schemaName}, plot ${currentPlot.plotID}: ${persistedCensusID} -> ${reconciledCensusID}`
          );
          await censusDispatch({ census: reconciledCensus });
        }
      }

      censusListLoad.setLoaded();
    } catch (error) {
      ailogger.error('Failed to fetch census data:', error instanceof Error ? error : undefined);
      censusListLoad.setError();
    }
  }, [
    currentSite?.schemaName,
    currentPlot?.plotID,
    currentCensus?.dateRanges?.[0]?.censusID,
    currentCensus?.plotCensusNumber,
    censusDispatch,
    censusListDispatch,
    censusListLoad
  ]);

  const fetchQuadratDataFn = useCallback(async () => {
    // Note: plotCensusNumber can be 0, so use nullish check instead of falsy check
    if (!currentSite?.schemaName || !currentPlot?.plotID || currentCensus?.plotCensusNumber == null) return;
    quadratListLoad.setLoading();
    try {
      const response = await fetch(`/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite.schemaName}`);
      if (!response.ok) throw new Error(`Failed to fetch quadrats: ${response.status}`);
      const quadratsData = await response.json();
      if (quadratListDispatch) quadratListDispatch({ quadratList: quadratsData });
      quadratListLoad.setLoaded();
    } catch (error) {
      ailogger.error('Failed to fetch quadrat data:', error instanceof Error ? error : undefined);
      quadratListLoad.setError();
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, quadratListDispatch, quadratListLoad]);

  // Create async operations with stable function references
  const { execute: executeFetchSiteList } = useAsyncOperation(fetchSiteListFn, {
    loadingMessage: 'Loading Sites...',
    category: 'api',
    suppressGlobalLoading: true,
    preventDuplicates: true
  });

  const { execute: executeLoadPlotData } = useAsyncOperation(fetchPlotDataFn, {
    loadingMessage: 'Loading plot data...',
    category: 'api',
    suppressGlobalLoading: true,
    preventDuplicates: true
  });

  const { execute: executeLoadCensusData } = useAsyncOperation(fetchCensusDataFn, {
    loadingMessage: 'Loading census data...',
    category: 'api',
    suppressGlobalLoading: true,
    preventDuplicates: true
  });

  const { execute: executeLoadQuadratData } = useAsyncOperation(fetchQuadratDataFn, {
    loadingMessage: 'Loading quadrat data...',
    category: 'api',
    suppressGlobalLoading: true,
    preventDuplicates: true
  });

  useEffect(() => {
    if (session?.user?.permissionsUnavailable) {
      redirect('/loginfailed?reason=permissions-unavailable');
    }
  }, [session?.user?.permissionsUnavailable]);

  // Fetch site list after hydration when session exists
  // IMPORTANT: Wait for Zustand hydration before fetching to avoid race conditions
  useEffect(() => {
    if (!hasHydrated) return;
    if (session && siteListLoad.isIdle) {
      executeFetchSiteList();
    }
    // Intentionally exclude executeFetchSiteList from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, siteListLoad.isIdle, hasHydrated]);

  // Fetch plot data when currentSite is defined and plotList has not been loaded
  useEffect(() => {
    if (!hasHydrated) return;
    if (currentSite && plotListLoad.isIdle) {
      executeLoadPlotData();
    }
    // Intentionally exclude executeLoadPlotData from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, plotListLoad.isIdle, hasHydrated]);

  // Fetch census data when currentSite, currentPlot are defined and censusList has not been loaded
  useEffect(() => {
    if (!hasHydrated) return;
    if (currentSite && currentPlot && censusListLoad.isIdle) {
      executeLoadCensusData();
    }
    // Intentionally exclude executeLoadCensusData from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, currentPlot, censusListLoad.isIdle, hasHydrated]);

  // Fetch quadrat data when currentSite, currentPlot, currentCensus are defined and quadratList has not been loaded
  useEffect(() => {
    if (!hasHydrated) return;
    if (currentSite && currentPlot && currentCensus && quadratListLoad.isIdle) {
      executeLoadQuadratData();
    }
    // Intentionally exclude executeLoadQuadratData from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, currentPlot, currentCensus, quadratListLoad.isIdle, hasHydrated]);

  // Clear lists and reload data when site, plot, or census changes
  useEffect(() => {
    const hasSiteChanged = previousSiteRef.current !== currentSite?.siteName;
    const hasPlotChanged = previousPlotRef.current !== currentPlot?.plotID;
    const hasCensusChanged = previousCensusRef.current !== (currentCensus?.dateRanges?.[0]?.censusID ?? undefined);

    const clearLists = async () => {
      const promises = [];

      if (hasSiteChanged) {
        // Clear plot, census, and quadrat lists when a new site is selected
        plotListLoad.reset();
        censusListLoad.reset();
        quadratListLoad.reset();
        if (plotListDispatch) promises.push(plotListDispatch({ plotList: undefined }));
        if (censusListDispatch) promises.push(censusListDispatch({ censusList: undefined }));
        if (quadratListDispatch) promises.push(quadratListDispatch({ quadratList: undefined }));
        previousSiteRef.current = currentSite?.siteName;
      }

      if (hasPlotChanged) {
        // Clear census and quadrat lists when a new plot is selected
        censusListLoad.reset();
        quadratListLoad.reset();
        if (censusListDispatch) promises.push(censusListDispatch({ censusList: undefined }));
        if (quadratListDispatch) promises.push(quadratListDispatch({ quadratList: undefined }));
        previousPlotRef.current = currentPlot?.plotID;
      }

      if (hasCensusChanged) {
        // Clear quadrat list when a new census is selected
        quadratListLoad.reset();
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
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });

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
      {hasHydrated &&
        (isDesktop ? (
          <Box
            component="nav"
            role="navigation"
            aria-label="Site navigation"
            className={`sidebar ${isSidebarVisible ? 'visible' : 'hidden'} ${isPulsing ? `animate-fade-blur-in` : ``}`}
            sx={{ position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 1000 }}
          >
            <Sidebar setCensusListLoaded={censusListLoad.reset} siteListLoaded={siteListLoad.isLoaded} coreDataLoaded={coreDataLoaded} />
          </Box>
        ) : (
          <Drawer
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            size="sm"
            slotProps={{ content: { sx: { width: 'min(92vw, 360px)', maxWidth: '100vw', overflowX: 'hidden' } } }}
          >
            <Sidebar setCensusListLoaded={censusListLoad.reset} siteListLoaded={siteListLoad.isLoaded} coreDataLoaded={coreDataLoaded} />
          </Drawer>
        ))}
      <Header onOpenSidebar={() => setMobileSidebarOpen(true)} isSidebarOpen={mobileSidebarOpen} />
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
          marginLeft: { xs: 0, md: isSidebarVisible ? 'calc(var(--Sidebar-width) + 5px)' : 0 },
          transition: 'margin-left 0.3s ease-in-out',
          '&:focus': {
            outline: 'none'
          }
        }}
      >
        {currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID && (
          <Box
            sx={{
              width: '100%',
              px: 1,
              pt: 1,
              position: 'sticky',
              top: 'var(--Header-height)',
              zIndex: 900
            }}
          >
            <UploadJobStatusBadge schema={currentSite.schemaName} plotID={currentPlot.plotID} censusID={currentCensus.dateRanges[0].censusID} />
          </Box>
        )}
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
          {session && !session.user.permissionsUnavailable && <>{children}</>}
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
              level="title-lg"
              component="div"
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
          </Stack>
          <IconButton
            aria-label="Help"
            aria-haspopup="menu"
            aria-expanded={Boolean(helpMenuAnchor)}
            onClick={event => setHelpMenuAnchor(event.currentTarget)}
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
          <Menu anchorEl={helpMenuAnchor} open={Boolean(helpMenuAnchor)} onClose={() => setHelpMenuAnchor(null)} placement="top-end">
            <MenuItem component="a" href={DOCUMENTATION_URL} target="_blank" rel="noreferrer" onClick={() => setHelpMenuAnchor(null)}>
              Documentation
            </MenuItem>
            <MenuItem
              onClick={() => {
                setHelpMenuAnchor(null);
                setIsFeedbackModalOpen(true);
              }}
            >
              Report an issue
            </MenuItem>
          </Menu>
        </Box>
      </Box>
      <GithubFeedbackModal open={isFeedbackModalOpen} onClose={() => setIsFeedbackModalOpen(false)} />
    </>
  );
}
