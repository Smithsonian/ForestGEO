'use client';
import React, { useCallback, useEffect, useState } from 'react';
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
import { useAppStore, useHasHydrated } from '@/config/store/appstore';
import { DOCUMENTATION_URL, getEndpointHeaderName, siteConfig } from '@/config/macros/siteconfigs';
import { LOGIN_FAILURE_REASONS } from '@/config/loginfailurereasons';
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

  // The site list depends only on the session (not on a selection scope), so deduplication of
  // identical calls is still appropriate here. Plot/census/quadrat lists are loaded by the
  // scope-keyed effects below, which never deduplicate across different scopes.
  const { execute: executeFetchSiteList } = useAsyncOperation(fetchSiteListFn, {
    loadingMessage: 'Loading Sites...',
    category: 'api',
    suppressGlobalLoading: true,
    preventDuplicates: true
  });

  useEffect(() => {
    if (session?.user?.permissionsUnavailable) {
      redirect(`/loginfailed?reason=${session.user.permissionsFailureReason ?? LOGIN_FAILURE_REASONS.PERMISSIONS_UNAVAILABLE}`);
    }
  }, [session?.user?.permissionsUnavailable, session?.user?.permissionsFailureReason]);

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

  // Scope-aware list loading (#517 R1). Each list is loaded by an effect keyed on the EXACT
  // scope it depends on, so a scope change always starts a new request (nothing is deduplicated
  // across different scopes). The effect cleanup aborts the superseded request and flips
  // `cancelled`, so a late completion can never touch the lists, the selection or the load
  // status of the newer scope. Dependent lists are cleared atomically in the store's
  // setSite/setPlot/setCensus cascade, not here.
  const siteSchema = currentSite?.schemaName;
  const currentPlotID = currentPlot?.plotID;
  const currentPlotCensusNumber = currentCensus?.plotCensusNumber;
  const { setLoading: setPlotLoading, setLoaded: setPlotLoaded, setError: setPlotError, reset: resetPlotLoad } = plotListLoad;
  const { setLoading: setCensusLoading, setLoaded: setCensusLoaded, setError: setCensusError, reset: resetCensusLoad } = censusListLoad;
  const { setLoading: setQuadratLoading, setLoaded: setQuadratLoaded, setError: setQuadratError, reset: resetQuadratLoad } = quadratListLoad;
  const [censusReloadNonce, setCensusReloadNonce] = useState(0);
  const reloadCensusList = useCallback(() => setCensusReloadNonce(n => n + 1), []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!siteSchema) {
      resetPlotLoad();
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setPlotLoading();
    (async () => {
      try {
        const response = await fetch(`/api/fetchall/plots/0/0?schema=${siteSchema}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to fetch plots: ${response.status}`);
        const plotsData = await response.json();
        if (cancelled) return;
        if (plotListDispatch) await plotListDispatch({ plotList: plotsData });
        if (!cancelled) setPlotLoaded();
      } catch (error) {
        if (cancelled) return;
        ailogger.error('Failed to fetch plot data:', error instanceof Error ? error : undefined);
        setPlotError();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hasHydrated, siteSchema, plotListDispatch, setPlotLoading, setPlotLoaded, setPlotError, resetPlotLoad]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!siteSchema || !currentPlotID) {
      resetCensusLoad();
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setCensusLoading();
    (async () => {
      try {
        const response = await fetch(`/api/fetchall/census/${currentPlotID}/0?schema=${siteSchema}&plotID=${currentPlotID}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to fetch census: ${response.status}`);
        const censusRDSLoad = await response.json();
        const censusArray = Array.isArray(censusRDSLoad) ? censusRDSLoad : [];
        const censusList = await createAndUpdateCensusList(censusArray);
        if (cancelled) return;
        if (censusListDispatch) await censusListDispatch({ censusList });
        if (cancelled) return;

        // Read the selection at completion time, not from the render that started the request.
        const selected = useAppStore.getState().currentCensus;
        if (censusDispatch && selected) {
          const reconciledCensus = reconcileCurrentCensusSelection(selected, censusList);
          const persistedCensusID = selected.dateRanges?.[0]?.censusID;
          const reconciledCensusID = reconciledCensus?.dateRanges?.[0]?.censusID;

          if (!reconciledCensus) {
            ailogger.warn(
              `Clearing stale census selection for schema ${siteSchema}, plot ${currentPlotID}: persisted census ${persistedCensusID ?? 'unknown'} no longer exists`
            );
            await censusDispatch({ census: undefined });
          } else if (persistedCensusID !== reconciledCensusID) {
            ailogger.info(`Reconciled stale census selection for schema ${siteSchema}, plot ${currentPlotID}: ${persistedCensusID} -> ${reconciledCensusID}`);
            await censusDispatch({ census: reconciledCensus });
          } else if (JSON.stringify(selected) !== JSON.stringify(reconciledCensus)) {
            // Same census ID, but the list carries newer metadata (e.g. the explicit window and
            // measurement-span fields) than the persisted selection: refresh it from the list.
            await censusDispatch({ census: reconciledCensus });
          }
        }
        if (!cancelled) setCensusLoaded();
      } catch (error) {
        if (cancelled) return;
        ailogger.error('Failed to fetch census data:', error instanceof Error ? error : undefined);
        setCensusError();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    hasHydrated,
    siteSchema,
    currentPlotID,
    censusReloadNonce,
    censusDispatch,
    censusListDispatch,
    setCensusLoading,
    setCensusLoaded,
    setCensusError,
    resetCensusLoad
  ]);

  useEffect(() => {
    if (!hasHydrated) return;
    // plotCensusNumber can be 0, so use a nullish check instead of a falsy check
    if (!siteSchema || !currentPlotID || currentPlotCensusNumber == null) {
      resetQuadratLoad();
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setQuadratLoading();
    (async () => {
      try {
        const response = await fetch(`/api/fetchall/quadrats/${currentPlotID}/${currentPlotCensusNumber}?schema=${siteSchema}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to fetch quadrats: ${response.status}`);
        const quadratsData = await response.json();
        if (cancelled) return;
        if (quadratListDispatch) await quadratListDispatch({ quadratList: quadratsData });
        if (!cancelled) setQuadratLoaded();
      } catch (error) {
        if (cancelled) return;
        ailogger.error('Failed to fetch quadrat data:', error instanceof Error ? error : undefined);
        setQuadratError();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    hasHydrated,
    siteSchema,
    currentPlotID,
    currentPlotCensusNumber,
    quadratListDispatch,
    setQuadratLoading,
    setQuadratLoaded,
    setQuadratError,
    resetQuadratLoad
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
            <Sidebar setCensusListLoaded={reloadCensusList} siteListLoaded={siteListLoad.isLoaded} coreDataLoaded={coreDataLoaded} />
          </Box>
        ) : (
          <Drawer
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            size="sm"
            slotProps={{ content: { sx: { width: 'min(92vw, 360px)', maxWidth: '100vw', overflowX: 'hidden' } } }}
          >
            <Sidebar setCensusListLoaded={reloadCensusList} siteListLoaded={siteListLoad.isLoaded} coreDataLoaded={coreDataLoaded} />
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
