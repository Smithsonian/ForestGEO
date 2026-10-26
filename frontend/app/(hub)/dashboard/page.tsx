'use client';

import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography
} from '@mui/joy';
import WarningIcon from '@mui/icons-material/Warning';
import CheckIcon from '@mui/icons-material/Check';
import PublicIcon from '@mui/icons-material/Public';
import GridOnIcon from '@mui/icons-material/GridOn';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  useOrgCensusListContext,
  useOrgCensusListDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch,
  useSiteListContext
} from '@/app/contexts/compat-hooks';
import { createAndUpdateCensusList, reconcileCurrentCensusSelection } from '@/lib/db/definitions/timekeeping';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UnifiedChangelogRDS } from '@/lib/db/definitions/core';
import { SitesRDS as _SitesRDS, PlotRDS as _PlotRDS } from '@/lib/db/definitions/zones';
import { OrgCensusRDS, OrgCensusToCensusResultMapper } from '@/lib/db/definitions/timekeeping';
import moment from 'moment';
import Avatar from '@mui/joy/Avatar';
import ailogger from '@/ailogger';

// Enhanced Visual Components
import EmptyState from '@/components/emptystate';
import SitesOverview from '@/components/dashboard/sitesoverview';
import PlotsOverview from '@/components/dashboard/plotsoverview';
import CensusesOverview from '@/components/dashboard/censusesoverview';
import CensusStatsView from '@/components/dashboard/censusstatsview';
import DataQualityCard from '@/components/dashboard/dataqualitycard';
import { summarizeChange } from '@/components/changes/recentchangesexplorer';
import { designTokens } from '@/config/design-tokens';
import AddIcon from '@mui/icons-material/Add';
import DatasetIcon from '@mui/icons-material/Dataset';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/config/store/appstore';
import { CENSUS_DELETE_GENERIC_FAILURE_MESSAGE, CENSUS_DELETE_STALE_LIST_STATUSES, readCensusDeleteRejectionMessage } from '@/config/censusdeletion';
import PlotCardModal from '@/components/client/modals/plotcardmodal';
import CensusDeletionModal from '@/components/client/modals/censusdeletionmodal';
import CensusCreationModal, { CensusCreationDetails } from '@/components/client/modals/censuscreationmodal';
import { Plot } from '@/lib/db/definitions/zones';
import { PlotWithCensusCount } from '@/components/dashboard/plotsoverview';
import { CensusWithStats } from '@/components/dashboard/censusesoverview';

interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

interface StemTypesType {
  CountOldStems: number | null;
  CountMultiStems: number;
  CountNewRecruits: number;
  isFirstCensus: boolean;
}

interface DashboardMetrics {
  progressTacho: ProgressTachoType;
  activeUsers: number;
  countStems: number;
  countTrees: number;
  stemTypes: StemTypesType;
}

interface ScopedDashboardState {
  key: string;
  requestID: number;
  status: 'success' | 'error';
  metrics?: DashboardMetrics;
  changelog: UnifiedChangelogRDS[];
  errorMessage?: string;
}

// CountOldStems starts null so the tile shows the "no comparison" placeholder
// instead of a confident 0 until real data arrives.
const EMPTY_METRICS: DashboardMetrics = {
  progressTacho: { TotalQuadrats: 0, PopulatedPercent: 0, PopulatedQuadrats: 0, UnpopulatedQuadrats: [] },
  activeUsers: 0,
  countStems: 0,
  countTrees: 0,
  stemTypes: { CountOldStems: null, CountMultiStems: 0, CountNewRecruits: 0, isFirstCensus: false }
};

const CHANGELOG_PAGE_SIZE = 5;

export default function DashboardPage() {
  const router = useRouter();
  const { triggerPulse } = useLockAnimation();
  const { setLoading } = useLoading();
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const siteListContext = useSiteListContext();
  const censusListContext = useOrgCensusListContext();
  const censusListDispatch = useOrgCensusListDispatch();
  const censusDispatch = useOrgCensusDispatch();
  const siteDispatch = useSiteDispatch();
  const plotDispatch = usePlotDispatch();
  const { validity } = useDataValidityContext();
  const userName = session?.user?.name;
  const userEmail = session?.user?.email;
  const userRole = session?.user?.userStatus;
  // Global-role users carry no explicit per-user site grants; like the sidebar, they
  // derive their accessible sites from the full catalog site list context instead.
  const isGlobalUser = userRole === 'global';
  const allowedSites = isGlobalUser ? siteListContext : session?.user?.sites;

  // Get plot and census lists from store
  const plotList = useAppStore(state => state.plotList);
  const censusList = useAppStore(state => state.censusList);

  const [error, setError] = useState<string | null>(null);

  // Dashboard data is stored WITH the scope (site schema / plot / census) it was fetched
  // for. Only data whose key matches the current scope is ever rendered, so switching
  // site/plot/census immediately shows a loading state instead of the previous scope's
  // counts, and a late response for a superseded scope can never be displayed.
  const [scopedData, setScopedData] = useState<ScopedDashboardState | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [activeRequest, setActiveRequest] = useState<{ key: string; id: number } | null>(null);
  const requestSequenceRef = useRef(0);

  const schemaName = currentSite?.schemaName;
  const plotID = currentPlot?.plotID;
  const censusID = currentCensus?.dateRanges?.[0]?.censusID;
  const plotCensusNumber = currentCensus?.plotCensusNumber;
  const scopeKey = schemaName && plotID && censusID ? `${schemaName}|${plotID}|${censusID}|${plotCensusNumber ?? ''}` : '';
  // Data is only current when it answers the LATEST request started for the current scope.
  // Keying by request id (not just scope) means returning to scope A (A -> B -> A, or a retry)
  // shows loading for the new A request instead of A's previous result.
  const currentScopedData =
    scopedData && scopedData.key === scopeKey && activeRequest && activeRequest.key === scopeKey && scopedData.requestID === activeRequest.id
      ? scopedData
      : null;
  const dashboardStatus: 'idle' | 'loading' | 'success' | 'error' = !scopeKey ? 'idle' : (currentScopedData?.status ?? 'loading');
  const isLoading = dashboardStatus === 'loading';
  const { progressTacho, activeUsers, countStems, countTrees, stemTypes } = currentScopedData?.metrics ?? EMPTY_METRICS;
  const changelogHistory = currentScopedData?.changelog ?? [];

  // Plot edit modal state
  const [plotToEdit, setPlotToEdit] = useState<Plot | null>(null);
  const [openPlotModal, setOpenPlotModal] = useState(false);
  const [manualReset, setManualReset] = useState(false);

  // Census delete confirmation modal state
  const [censusToDelete, setCensusToDelete] = useState<CensusWithStats | OrgCensusRDS | null>(null);
  const [openDeleteCensusModal, setOpenDeleteCensusModal] = useState(false);
  const [isDeletingCensus, setIsDeletingCensus] = useState(false);

  // Census creation state
  const isCreatingCensusRef = useRef(false);
  const [openCreateCensusModal, setOpenCreateCensusModal] = useState(false);
  const [isCreatingCensus, setIsCreatingCensus] = useState(false);
  const nextCensusNumber = Math.max(0, ...(censusListContext ?? []).map(census => census?.plotCensusNumber ?? 0)) + 1;

  // Timer ref for census creation debounce - cleaned up on unmount
  const censusCreationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup the census-creation debounce timer on unmount
  useEffect(() => {
    return () => {
      if (censusCreationTimerRef.current) {
        clearTimeout(censusCreationTimerRef.current);
      }
    };
  }, []);

  /**
   * Loads the aggregated metrics and recent changelog for the CURRENT scope.
   *
   * Every scope change (site/plot/census) starts a new request unconditionally: an
   * in-flight request for another scope is aborted, never allowed to block the new one.
   * `cancelled` is set by the effect cleanup (scope change or unmount), so a response,
   * error, or completion belonging to a superseded request is ignored even when the
   * fetch implementation does not honour the abort signal.
   */
  useEffect(() => {
    if (!scopeKey || !schemaName || !plotID || !censusID) return;

    const controller = new AbortController();
    let cancelled = false;
    const key = scopeKey;
    const requestID = ++requestSequenceRef.current;
    setActiveRequest({ key, id: requestID });

    const loadMetrics = async (): Promise<DashboardMetrics> => {
      const response = await fetch(`/api/dashboardmetrics/all/${schemaName}/${plotID}/${censusID}`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to load dashboard data: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return {
        progressTacho: {
          TotalQuadrats: data.progressTachometer.TotalQuadrats,
          PopulatedQuadrats: data.progressTachometer.PopulatedQuadrats,
          PopulatedPercent: data.progressTachometer.PopulatedPercent,
          UnpopulatedQuadrats: data.progressTachometer.UnpopulatedQuadrats ? data.progressTachometer.UnpopulatedQuadrats.split(';') : []
        },
        activeUsers: data.activeUsers.CountActiveUsers,
        countTrees: data.countTrees.CountTrees,
        countStems: data.countStems.CountStems,
        stemTypes: {
          CountOldStems: data.stemTypes.CountOldStems,
          CountMultiStems: data.stemTypes.CountMultiStems,
          CountNewRecruits: data.stemTypes.CountNewRecruits,
          isFirstCensus: data.stemTypes.isFirstCensus
        }
      };
    };

    // Changelog is supplementary: a failure degrades to "no recent activity" and must
    // not turn an otherwise successful metrics load into an error.
    const loadChangelog = async (): Promise<UnifiedChangelogRDS[]> => {
      try {
        const response = await fetch(`/api/changelog/overview/unifiedchangelog/${plotID}/${plotCensusNumber}?schema=${schemaName}`, {
          method: 'GET',
          signal: controller.signal
        });
        const results = await response.json();
        return Array.isArray(results) ? results : [];
      } catch (e: any) {
        if (e?.name !== 'AbortError') ailogger.warn('changeloghistory - failed to load changelog');
        return [];
      }
    };

    Promise.allSettled([loadMetrics(), loadChangelog()]).then(([metricsResult, changelogResult]) => {
      if (cancelled) return;
      const padded = [...(changelogResult.status === 'fulfilled' ? changelogResult.value : [])];
      while (padded.length < CHANGELOG_PAGE_SIZE) padded.push({});

      if (metricsResult.status === 'fulfilled') {
        setScopedData({ key, requestID, status: 'success', metrics: metricsResult.value, changelog: padded });
        ailogger.info('Dashboard metrics loaded successfully via aggregated API');
      } else {
        const reason = metricsResult.reason;
        if (reason?.name === 'AbortError') return;
        // A failed request is NOT empty data: surface it as an error with retry.
        const message = reason instanceof Error ? reason.message : 'Failed to load dashboard data. Please try again.';
        setScopedData({ key, requestID, status: 'error', changelog: padded, errorMessage: message });
        ailogger.error('Aggregated dashboard metrics error:', reason);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // plotCensusNumber is part of scopeKey; reloadNonce re-runs the same scope (retry).
  }, [scopeKey, reloadNonce, schemaName, plotID, censusID, plotCensusNumber]);

  // Memoized event handlers to prevent unnecessary re-renders
  const handleFeedbackKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerPulse();
      }
    },
    [triggerPulse]
  );

  // Plot edit handlers
  const handlePlotEdit = useCallback((plot: PlotWithCensusCount) => {
    setPlotToEdit(plot as Plot);
    setOpenPlotModal(true);
  }, []);

  // Handler to properly close plot modal and clear state
  const handleClosePlotModal = useCallback((isOpen: boolean) => {
    setOpenPlotModal(isOpen);
    if (!isOpen) {
      // Clear plotToEdit when modal closes to prevent stale data
      setPlotToEdit(null);
    }
  }, []);

  const handleAddPlot = useCallback(() => {
    setPlotToEdit(null);
    setOpenPlotModal(true);
  }, []);

  // Census list refresh function
  const refreshCensusList = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) {
      console.warn('Cannot refresh census list: missing site or plot context');
      return;
    }

    try {
      console.log('Refreshing census list...');
      const response = await fetch(
        `/api/fetchall/census/${currentPlot.plotID}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite.schemaName}&plotID=${currentPlot.plotID}`
      );
      const censusRDSLoad = await response.json();
      if (!censusRDSLoad) throw new Error('Failed to load census data');
      const censusArray = Array.isArray(censusRDSLoad) ? censusRDSLoad : [];
      const updatedCensusList = await createAndUpdateCensusList(censusArray);
      if (censusListDispatch) await censusListDispatch({ censusList: updatedCensusList });

      if (censusDispatch && currentCensus) {
        const reconciledCensus = reconcileCurrentCensusSelection(currentCensus, updatedCensusList);
        await censusDispatch({ census: reconciledCensus });
      }

      console.log('Census list refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh census list:', error);
      ailogger.error('Failed to refresh census list', error instanceof Error ? error : undefined);
      throw error;
    }
  }, [
    currentSite?.schemaName,
    currentPlot?.plotID,
    currentCensus?.dateRanges?.[0]?.censusID,
    currentCensus?.plotCensusNumber,
    censusDispatch,
    censusListDispatch
  ]);

  // Census handlers
  const handleCensusDelete = useCallback((census: CensusWithStats | OrgCensusRDS) => {
    setCensusToDelete(census);
    setOpenDeleteCensusModal(true);
  }, []);

  const handleConfirmDeleteCensus = useCallback(
    async (deleteType: 'msmts' | 'full') => {
      if (!censusToDelete || !currentSite?.schemaName) return;

      const censusID = censusToDelete.dateRanges?.[0]?.censusID;
      if (!censusID) {
        ailogger.error('Missing required context: censusID not found in census to delete');
        setError('Census ID not found. Please try again.');
        setOpenDeleteCensusModal(false);
        return;
      }

      // Clear any previous errors
      setError(null);
      setIsDeletingCensus(true);
      setOpenDeleteCensusModal(false);

      const loadingMessage = deleteType === 'msmts' ? 'Deleting census measurements...' : 'Deleting census measurements and fixed data...';
      // destructive mutation — global overlay blocks UI for the duration of the API call
      setLoading(true, loadingMessage);
      const startTime = Date.now();

      try {
        console.log(loadingMessage, { schema: currentSite.schemaName, censusID, type: deleteType });

        const response = await fetch('/api/clearcensus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: currentSite.schemaName, censusID, type: deleteType })
        });
        if (!response.ok) {
          const rejectionMessage = await readCensusDeleteRejectionMessage(response);
          if (rejectionMessage) {
            ailogger.warn(`Census delete refused by the server (HTTP ${response.status}): ${rejectionMessage}`);
            setError(rejectionMessage);
            if (CENSUS_DELETE_STALE_LIST_STATUSES.includes(response.status)) {
              try {
                await refreshCensusList();
              } catch (refreshError) {
                ailogger.warn(`Census list refresh after a refused delete failed: ${refreshError instanceof Error ? refreshError.message : refreshError}`);
              }
            }
            return;
          }
          throw new Error(`Failed to clear census: ${response.status}`);
        }

        // Refresh the census list to reflect the deletion. The deletion has
        // already committed at this point, so a refresh failure must not be
        // reported as a failed delete — retrying the delete would 404 and the
        // wrong error would send the researcher chasing the wrong operation.
        setCensusToDelete(null);
        try {
          await refreshCensusList();
          console.log('Census deletion completed, list refreshed');
        } catch (refreshError: any) {
          ailogger.error('Census deleted but census list refresh failed', refreshError);
          setError('Census deleted, but refreshing the census list failed. Reload the page to see the updated list.');
        }

        // Ensure loading shows for at least 750ms for visual feedback
        const elapsed = Date.now() - startTime;
        if (elapsed < 750) {
          await new Promise(resolve => setTimeout(resolve, 750 - elapsed));
        }
      } catch (error: any) {
        console.error('Failed to delete census:', error);
        ailogger.error('Failed to delete census', error);
        setError(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE);
      } finally {
        setLoading(false);
        setIsDeletingCensus(false);
      }
    },
    [censusToDelete, currentSite?.schemaName, refreshCensusList, setLoading]
  );

  const handleAddCensus = useCallback(() => {
    if (isCreatingCensusRef.current) {
      return;
    }

    // Check if current census has measurements
    if (currentCensus && (!currentCensus.dateRanges || currentCensus.dateRanges.length === 0 || !currentCensus.dateRanges?.[0]?.startDate)) {
      const errorMsg = 'Cannot create a new census: Current census has no measurements.';
      console.warn(errorMsg);
      setError(errorMsg);
      return;
    }

    // Check if any existing census has no measurements
    const censusWithoutMeasurements = censusListContext?.find(
      census => !census?.dateRanges || census.dateRanges.length === 0 || !census.dateRanges?.[0]?.startDate
    );

    if (censusWithoutMeasurements) {
      const errorMsg = `Cannot create a new census: Census ${censusWithoutMeasurements.plotCensusNumber} has no measurements.`;
      console.warn(errorMsg);
      setError(errorMsg);
      return;
    }

    setError(null);
    setOpenCreateCensusModal(true);
  }, [currentCensus, censusListContext]);

  const handleConfirmCreateCensus = useCallback(
    async (details: CensusCreationDetails) => {
      if (isCreatingCensusRef.current || !currentSite?.schemaName || !currentPlot?.plotID) return;

      isCreatingCensusRef.current = true;
      setIsCreatingCensus(true);
      setError(null);
      setLoading(true, 'Creating new census...', undefined, 'processing');
      const startTime = Date.now();

      try {
        const mapper = new OrgCensusToCensusResultMapper();
        const newCensusID = await mapper.startNewCensus(currentSite.schemaName, currentPlot.plotID, nextCensusNumber, details);
        if (!newCensusID) {
          const errorMsg = 'Failed to create new census - census creation returned invalid ID. Please ensure site and plot are properly selected.';
          console.error(errorMsg);
          setError(errorMsg);
          return;
        }
        console.log('New census created with ID:', newCensusID);

        // Rollover data from current census to new census (only if we have a valid source census)
        const sourceCensusID = currentCensus?.dateRanges?.[0]?.censusID;
        if (sourceCensusID !== undefined && sourceCensusID !== null) {
          await Promise.all(
            ['attributes', 'personnel', 'quadrats', 'species'].map(async key => {
              const rolloverResponse = await fetch(`/api/rollover/${key}/${currentSite!.schemaName}/${currentPlot!.plotID}/${sourceCensusID}/${newCensusID}`);
              if (!rolloverResponse.ok) {
                throw new Error(`Failed to rollover ${key}: ${rolloverResponse.status}`);
              }
            })
          );
        } else {
          ailogger.info('Skipping rollover - no valid source census ID available (this is expected for the first census)');
        }

        // Refresh the census list to show the new census
        await refreshCensusList();
        setOpenCreateCensusModal(false);

        // Ensure loading shows for at least 750ms for visual feedback
        const elapsed = Date.now() - startTime;
        if (elapsed < 750) {
          await new Promise(resolve => setTimeout(resolve, 750 - elapsed));
        }
      } catch (error) {
        console.error('Error creating census:', error);
        ailogger.error('Error creating census:', error instanceof Error ? error : undefined);
        setError('Failed to create census. Please try again.');
      } finally {
        setLoading(false);
        setIsCreatingCensus(false);
        // Debounce: prevent rapid successive clicks
        censusCreationTimerRef.current = setTimeout(() => {
          isCreatingCensusRef.current = false;
        }, 1000);
      }
    },
    [currentCensus, currentSite, currentPlot, nextCensusNumber, refreshCensusList, setLoading]
  );

  // Handle manual reset after successful plot edit
  useEffect(() => {
    if (manualReset) {
      // Clear modal state
      setPlotToEdit(null);
      setOpenPlotModal(false);
      // Reset the flag and reload the page to fetch updated data
      setManualReset(false);
      window.location.reload();
    }
  }, [manualReset]);

  const hasData = dashboardStatus === 'success' && (progressTacho.PopulatedQuadrats > 0 || countStems > 0);

  return (
    <Box
      role="region"
      aria-label="Dashboard page container"
      sx={{
        display: 'flex',
        flexGrow: 1,
        width: '100%',
        flexDirection: 'column',
        p: { xs: 2, sm: 3, md: 4 },
        gap: 3
      }}
    >
      {error && (
        <Alert color="danger" variant="soft" sx={{ animation: 'slideDown 0.3s ease' }}>
          {error}
        </Alert>
      )}

      <Box>
        <Typography level="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Welcome back, {userName}! 👋
        </Typography>
        <Typography level="body-md" color="neutral">
          Here's what's happening with your census data
        </Typography>
      </Box>

      {/* Dynamic Dashboard Views based on selection state */}
      {!currentSite ? (
        /* State 1: No site selected - Show Sites Overview */
        <Box>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
            <Avatar
              alt="Site selection icon"
              sx={{
                bgcolor: 'primary.softBg',
                color: 'primary.solidBg',
                width: 48,
                height: 48
              }}
            >
              <PublicIcon />
            </Avatar>
            <Box>
              <Typography level="h3" sx={{ fontWeight: 600 }}>
                Available Sites
              </Typography>
              <Typography level="body-md" color="neutral">
                Use the sidebar to select a site from the options below
              </Typography>
            </Box>
          </Stack>
          <SitesOverview
            sites={
              allowedSites?.map(site => ({
                siteID: site.siteID,
                siteName: site.siteName,
                schemaName: site.schemaName,
                subquadratDimX: site.subquadratDimX,
                subquadratDimY: site.subquadratDimY,
                doubleDataEntry: site.doubleDataEntry
              })) || []
            }
            isLoading={false}
            onSelectSite={selected => {
              if (siteDispatch) {
                const fullSite = allowedSites?.find(s => s.siteID === selected.siteID);
                siteDispatch({ site: fullSite });
              }
            }}
          />
        </Box>
      ) : !currentPlot ? (
        /* State 2: Site selected, no plot - Show Plots Overview */
        <Box>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
            <Avatar
              alt="Plot selection icon"
              sx={{
                bgcolor: 'success.softBg',
                color: 'success.solidBg',
                width: 48,
                height: 48
              }}
            >
              <GridOnIcon />
            </Avatar>
            <Box>
              <Typography level="h3" sx={{ fontWeight: 600 }}>
                Available Plots
              </Typography>
              <Typography level="body-md" color="neutral">
                Use the sidebar to select a plot from {currentSite.siteName}
              </Typography>
            </Box>
          </Stack>
          <PlotsOverview
            plots={Array.isArray(plotList) ? plotList : []}
            siteName={currentSite.siteName}
            isLoading={false}
            onPlotEdit={handlePlotEdit}
            onAddPlot={handleAddPlot}
            onSelectPlot={selected => {
              if (plotDispatch) {
                const fullPlot = (Array.isArray(plotList) ? plotList : []).find(p => p.plotID === selected.plotID);
                plotDispatch({ plot: fullPlot });
              }
            }}
          />
        </Box>
      ) : !currentCensus ? (
        /* State 3: Site and Plot selected, no census - Show Censuses Overview */
        <Box>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
            <Avatar
              alt="Census selection icon"
              sx={{
                bgcolor: 'warning.softBg',
                color: 'warning.solidBg',
                width: 48,
                height: 48
              }}
            >
              <CalendarMonthIcon />
            </Avatar>
            <Box>
              <Typography level="h3" sx={{ fontWeight: 600 }}>
                Available Censuses
              </Typography>
              <Typography level="body-md" color="neutral">
                Select a census from {currentPlot.plotName} to view its data
              </Typography>
            </Box>
          </Stack>
          <CensusesOverview
            censuses={(Array.isArray(censusList) ? censusList : []).filter((c): c is OrgCensusRDS => c !== undefined)}
            plotName={currentPlot.plotName}
            siteName={currentSite.siteName}
            isLoading={false}
            userRole={userRole}
            onCensusDelete={handleCensusDelete}
            onAddCensus={handleAddCensus}
            onSelectCensus={census => {
              if (censusDispatch) {
                const orgCensus = censusListContext?.find(c => c?.plotCensusNumber === census.plotCensusNumber);
                censusDispatch({ census: orgCensus });
              }
            }}
          />
        </Box>
      ) : dashboardStatus === 'error' ? (
        /* Failed request: NOT empty data. Offer a retry for the same scope. */
        <Alert
          color="danger"
          variant="soft"
          role="alert"
          endDecorator={
            <Button size="sm" variant="solid" color="danger" onClick={() => setReloadNonce(n => n + 1)}>
              Retry
            </Button>
          }
        >
          <Box>
            <Typography level="title-sm">Could not load census data</Typography>
            <Typography level="body-sm">{currentScopedData?.errorMessage ?? 'Failed to load dashboard data. Please try again.'}</Typography>
          </Box>
        </Alert>
      ) : dashboardStatus === 'success' && !hasData ? (
        /* Empty State: a successful, current-scope response with no data */
        <EmptyState
          icon={<DatasetIcon />}
          title="No Census Data Yet"
          description="You haven't uploaded any measurements for this census yet. Start by uploading your field data or creating measurement entries."
          primaryAction={{
            label: 'Upload Data',
            onClick: () => {
              // Route to the first missing prerequisite, or to view data if all prerequisites are met
              if (!validity.species) {
                router.push('/fixeddatainput/alltaxonomies');
              } else if (!validity.quadrats) {
                router.push('/fixeddatainput/quadrats');
              } else if (!validity.attributes) {
                router.push('/fixeddatainput/attributes');
              } else {
                // All prerequisites met, go to measurement upload
                router.push('/measurementshub/summary');
              }
            },
            startDecorator: <AddIcon />,
            variant: 'solid',
            color: 'primary'
          }}
          iconColor="warning"
        />
      ) : (
        <>
          {/* New Enhanced Census Statistics View */}
          <CensusStatsView
            countTrees={countTrees}
            countStems={countStems}
            stemTypes={stemTypes}
            progressTacho={progressTacho}
            activeUsers={activeUsers}
            isLoading={isLoading}
          />

          {/* Data Quality Section - Post-Census Validation Statistics */}
          <Box>
            <Typography level="title-lg" sx={{ fontWeight: 600, mb: 2 }}>
              Data Quality
            </Typography>
            <DataQualityCard
              schema={currentSite?.schemaName}
              plotID={currentPlot?.plotID}
              censusID={currentCensus?.dateRanges?.[0]?.censusID}
              isLoading={isLoading}
              onRefresh={async () => {
                // Trigger measurements summary refresh with post-validation execution
                if (currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID) {
                  const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite.schemaName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      plotID: currentPlot.plotID,
                      censusID: currentCensus.dateRanges?.[0]?.censusID,
                      runPostValidation: true
                    })
                  });
                  if (!response.ok) {
                    throw new Error(`Failed to refresh validations (HTTP ${response.status})`);
                  }
                }
              }}
            />
          </Box>

          {/* User Info and Recent Activity Section */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                lg: '1fr 2fr'
              },
              gap: 3
            }}
          >
            {/* User-Specific Info Card */}
            <Card
              variant="outlined"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: designTokens.shadows.md,
                  borderColor: 'primary.outlinedBorder'
                }
              }}
              aria-labelledby="user-info-heading"
            >
              <CardContent sx={{ gap: 2 }}>
                <Typography id="user-info-heading" level="h4" sx={{ fontWeight: 600, mb: 1 }}>
                  Your Profile
                </Typography>

                <Box
                  sx={{
                    p: 2,
                    borderRadius: 'sm',
                    bgcolor: 'background.level1',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: 'background.level2'
                    }
                  }}
                >
                  <Stack spacing={2}>
                    <Box>
                      <Typography level="body-xs" color="neutral">
                        Assigned Role
                      </Typography>
                      <Typography level="title-md" fontWeight="bold">
                        {userRole}
                      </Typography>
                    </Box>
                    <Divider />
                    <Box>
                      <Typography level="body-xs" color="neutral">
                        Registered Email
                      </Typography>
                      <Typography level="body-md" fontWeight="bold">
                        {userEmail}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>

                <Divider />

                <Box>
                  <Typography level="body-sm" color="neutral" sx={{ mb: 1 }}>
                    Site Access
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {allowedSites?.map(site => (
                      <Chip
                        key={site.schemaName}
                        variant="soft"
                        color="success"
                        size="sm"
                        startDecorator={<CheckIcon />}
                        sx={{
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            transform: 'translateY(-2px)'
                          }
                        }}
                      >
                        {site.siteName}
                      </Chip>
                    ))}
                  </Box>
                </Box>

                <Chip
                  component="div"
                  role="button"
                  tabIndex={0}
                  aria-label="Report incorrect profile information"
                  variant="outlined"
                  color="warning"
                  size="sm"
                  startDecorator={<WarningIcon />}
                  onClick={triggerPulse}
                  onKeyDown={handleFeedbackKeyDown}
                  sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { bgcolor: 'warning.softBg' } }}
                >
                  Report incorrect info
                </Chip>
              </CardContent>
            </Card>

            {/* Recent Changes Card */}
            <Card
              variant="outlined"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: designTokens.shadows.md,
                  borderColor: 'primary.outlinedBorder'
                }
              }}
              aria-labelledby="recent-changes-heading"
            >
              <CardContent sx={{ gap: 2 }}>
                <Box>
                  <Typography id="recent-changes-heading" level="h4" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Recent Activity
                  </Typography>
                  <Typography level="body-sm" color="neutral">
                    Latest changes to census data
                  </Typography>
                </Box>

                {isLoading ? (
                  <Typography level="body-sm" color="neutral" role="status">
                    Loading recent activity...
                  </Typography>
                ) : changelogHistory.filter(log => log.changeID).length > 0 ? (
                  <Stack spacing={2}>
                    {changelogHistory
                      .filter(log => log.changeID)
                      .slice(0, 5)
                      .map((log, index) => (
                        <AccordionGroup key={index}>
                          <Accordion>
                            <AccordionSummary aria-label={`Change ${log.changeID}: ${log.operation || 'Update'} on ${log.tableName || 'Data'}`}>
                              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                                <Avatar
                                  size="sm"
                                  alt={`Change ${log.changeID}`}
                                  sx={{
                                    bgcolor: 'primary.softBg',
                                    color: 'primary.solidBg'
                                  }}
                                >
                                  {log.changeID}
                                </Avatar>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                                    {summarizeChange({
                                      operation: (log.operation || 'UPDATE') as 'INSERT' | 'UPDATE' | 'DELETE',
                                      tableName: log.tableName || 'data',
                                      oldRowState: log.oldRowState ?? null,
                                      newRowState: log.newRowState ?? null,
                                      recordID: String(log.recordID ?? '')
                                    })}
                                  </Typography>
                                  <Typography level="body-xs" color="neutral">
                                    {moment(log.changeTimestamp).fromNow()}
                                  </Typography>
                                </Box>
                                <Chip size="sm" variant="soft" color="primary">
                                  {log.tableName || 'Data'}
                                </Chip>
                              </Stack>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                                <Box sx={{ flex: 1, p: 2, borderRadius: 'sm', bgcolor: 'background.level1' }}>
                                  <Typography level="body-xs" fontWeight="bold" color="neutral" sx={{ mb: 1 }}>
                                    Previous State
                                  </Typography>
                                  {log.oldRowState && Object.keys(log.oldRowState).length > 0 ? (
                                    <Stack spacing={0.5}>
                                      {Object.entries(log.oldRowState)
                                        .slice(0, 3)
                                        .map(([key, value]) => (
                                          <Typography key={key} level="body-xs">
                                            <strong>{key}:</strong> {typeof value === 'object' && value !== null ? JSON.stringify(value) : (value ?? 'NULL')}
                                          </Typography>
                                        ))}
                                    </Stack>
                                  ) : (
                                    <Typography level="body-xs" color="neutral">
                                      No previous data
                                    </Typography>
                                  )}
                                </Box>
                                <Box sx={{ flex: 1, p: 2, borderRadius: 'sm', bgcolor: 'background.level1' }}>
                                  <Typography level="body-xs" fontWeight="bold" color="neutral" sx={{ mb: 1 }}>
                                    New State
                                  </Typography>
                                  {log.newRowState && Object.keys(log.newRowState).length > 0 ? (
                                    <Stack spacing={0.5}>
                                      {Object.entries(log.newRowState)
                                        .slice(0, 3)
                                        .map(([key, value]) => (
                                          <Typography key={key} level="body-xs">
                                            <strong>{key}:</strong> {typeof value === 'object' && value !== null ? JSON.stringify(value) : (value ?? 'NULL')}
                                          </Typography>
                                        ))}
                                    </Stack>
                                  ) : (
                                    <Typography level="body-xs" color="neutral">
                                      No new data
                                    </Typography>
                                  )}
                                </Box>
                              </Stack>
                            </AccordionDetails>
                          </Accordion>
                        </AccordionGroup>
                      ))}
                  </Stack>
                ) : (
                  <EmptyState
                    icon={<AssessmentIcon />}
                    title="No Recent Activity"
                    description="There haven't been any changes to your census data recently. Activity will appear here when data is added, updated, or validated."
                    iconColor="neutral"
                    sx={{ py: 4 }}
                  />
                )}
              </CardContent>
            </Card>
          </Box>
        </>
      )}

      {/* Plot create/edit modal */}
      <PlotCardModal
        plot={plotToEdit ?? undefined}
        openPlotCardModal={openPlotModal}
        setOpenPlotCardModal={handleClosePlotModal}
        setManualReset={setManualReset}
      />

      <CensusCreationModal
        open={openCreateCensusModal}
        censusNumber={nextCensusNumber}
        plotName={currentPlot?.plotName}
        isCreating={isCreatingCensus}
        onClose={() => setOpenCreateCensusModal(false)}
        onCreate={handleConfirmCreateCensus}
      />

      {/* Census Delete Confirmation Modal */}
      <CensusDeletionModal
        open={openDeleteCensusModal}
        onClose={() => {
          setOpenDeleteCensusModal(false);
          setCensusToDelete(null);
        }}
        onDelete={handleConfirmDeleteCensus}
        census={censusToDelete}
        isDeleting={isDeletingCensus}
      />
    </Box>
  );
}
