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
  Modal,
  ModalClose,
  ModalDialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Tooltip,
  Typography
} from '@mui/joy';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import WarningIcon from '@mui/icons-material/Warning';
import CheckIcon from '@mui/icons-material/Check';
import NatureIcon from '@mui/icons-material/Nature';
import ParkIcon from '@mui/icons-material/Park';
import PeopleIcon from '@mui/icons-material/People';
import CategoryIcon from '@mui/icons-material/Category';
import PublicIcon from '@mui/icons-material/Public';
import GridOnIcon from '@mui/icons-material/GridOn';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UnifiedChangelogRDS } from '@/config/sqlrdsdefinitions/core';
import { SitesRDS as _SitesRDS, PlotRDS as _PlotRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensusRDS } from '@/config/sqlrdsdefinitions/timekeeping';
import moment from 'moment';
import Avatar from '@mui/joy/Avatar';
import ailogger from '@/ailogger';
// Eager load for maximum speed (bundle size not a concern)
import ProgressTachometer from '@/components/metrics/progresstachometer';
import ProgressPieChart from '@/components/metrics/progresspiechart';

// Enhanced Visual Components
import MetricCard from '@/components/dashboard/metriccard';
import ProgressCard from '@/components/dashboard/progresscard';
import EmptyState from '@/components/emptystate';
import SitesOverview from '@/components/dashboard/sitesoverview';
import PlotsOverview from '@/components/dashboard/plotsoverview';
import CensusesOverview from '@/components/dashboard/censusesoverview';
import { designTokens } from '@/config/design-tokens';
import AddIcon from '@mui/icons-material/Add';
import DatasetIcon from '@mui/icons-material/Dataset';
import AssessmentIcon from '@mui/icons-material/Assessment';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/config/store/appstore';
import PlotCardModal from '@/components/client/modals/plotcardmodal';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { PlotWithCensusCount } from '@/components/dashboard/plotsoverview';
import { CensusWithStats } from '@/components/dashboard/censusesoverview';

interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

interface StemTypesType {
  CountOldStems: number;
  CountMultiStems: number;
  CountNewRecruits: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { triggerPulse, isPulsing } = useLockAnimation();
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { validity } = useDataValidityContext();
  const userName = session?.user?.name;
  const userEmail = session?.user?.email;
  const userRole = session?.user?.userStatus;
  const allowedSites = session?.user?.sites;

  // Get plot and census lists from store
  const plotList = useAppStore(state => state.plotList);
  const censusList = useAppStore(state => state.censusList);

  const [changelogHistory, setChangelogHistory] = useState<UnifiedChangelogRDS[]>(Array(5));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressTacho, setProgressTacho] = useState<ProgressTachoType>({
    TotalQuadrats: 0,
    PopulatedPercent: 0,
    PopulatedQuadrats: 0,
    UnpopulatedQuadrats: []
  });
  const [activeUsers, setActiveUsers] = useState(0);
  const [countStems, setCountStems] = useState(0);
  const [countTrees, setCountTrees] = useState(0);
  const [stemTypes, setStemTypes] = useState<StemTypesType>({
    CountOldStems: 0,
    CountMultiStems: 0,
    CountNewRecruits: 0
  });
  const [toggleSwitch, setToggleSwitch] = useState(true);

  // Plot edit modal state
  const [plotToEdit, setPlotToEdit] = useState<Plot | null>(null);
  const [openPlotModal, setOpenPlotModal] = useState(false);
  const [manualReset, setManualReset] = useState(false);

  // Census delete confirmation modal state
  const [censusToDelete, setCensusToDelete] = useState<CensusWithStats | OrgCensusRDS | null>(null);
  const [openDeleteCensusModal, setOpenDeleteCensusModal] = useState(false);
  const [isDeletingCensus, setIsDeletingCensus] = useState(false);

  // Track loading state and last loaded key to prevent duplicate requests
  const loadingRef = useRef<boolean>(false);
  const lastLoadedKeyRef = useRef<string>('');

  /**
   * Aggregated Dashboard Metrics Loader
   *
   * Replaces 5 separate API calls with 1 aggregated call for optimal performance.
   * Performance improvement: 3-4x faster (from ~1200ms to ~300ms)
   */
  const loadAllDashboardMetrics = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0].censusID) return;

    try {
      const response = await fetch(`/api/dashboardmetrics/all/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`);

      if (!response.ok) {
        throw new Error(`Failed to load dashboard data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Update all state from single aggregated response
      setProgressTacho({
        TotalQuadrats: data.progressTachometer.TotalQuadrats,
        PopulatedQuadrats: data.progressTachometer.PopulatedQuadrats,
        PopulatedPercent: data.progressTachometer.PopulatedPercent,
        UnpopulatedQuadrats: data.progressTachometer.UnpopulatedQuadrats ? data.progressTachometer.UnpopulatedQuadrats.split(';') : []
      });

      setActiveUsers(data.activeUsers.CountActiveUsers);
      setCountTrees(data.countTrees.CountTrees);
      setCountStems(data.countStems.CountStems);
      setStemTypes({
        CountOldStems: data.stemTypes.CountOldStems,
        CountMultiStems: data.stemTypes.CountMultiStems,
        CountNewRecruits: data.stemTypes.CountNewRecruits
      });

      ailogger.info('Dashboard metrics loaded successfully via aggregated API');
    } catch (e: any) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load dashboard data. Please try again.';
      setError(errorMessage);
      ailogger.error('Aggregated dashboard metrics error:', e);
    }
  }, [currentSite, currentPlot, currentCensus]);

  const loadChangelogHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!currentSite || !currentPlot || !currentCensus) {
        setChangelogHistory(Array(5).fill({}));
        return;
      }
      const response = await fetch(
        `/api/changelog/overview/unifiedchangelog/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}?schema=${currentSite?.schemaName}`,
        { method: 'GET' }
      );
      try {
        const results: UnifiedChangelogRDS[] = await response.json();

        // Pad the array if it has less than 5 items
        const paddedResults = [...results];
        while (paddedResults.length < 5) {
          paddedResults.push({}); // Push empty objects to pad the array
        }

        setChangelogHistory(paddedResults);
      } catch {
        ailogger.warn('changeloghistory - no json response');
      }
    } catch (error: any) {
      ailogger.error('Failed to load changelog history', error);
      setChangelogHistory(Array(5).fill({})); // Fallback to an empty padded array in case of an error
    } finally {
      setIsLoading(false);
    }
  }, [currentSite, currentPlot, currentCensus]);

  // Memoized event handlers to prevent unnecessary re-renders
  const handleChartToggle = useCallback(() => {
    setToggleSwitch(prev => !prev);
  }, []);

  const handleChartToggleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setToggleSwitch(prev => !prev);
    }
  }, []);

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

  const handleAddPlot = useCallback(() => {
    // Navigate to the plots data input page for adding new plots
    router.push('/fixeddatainput/plots');
  }, [router]);

  // Census handlers
  const handleCensusDelete = useCallback((census: CensusWithStats | OrgCensusRDS) => {
    setCensusToDelete(census);
    setOpenDeleteCensusModal(true);
  }, []);

  const handleConfirmDeleteCensus = useCallback(async () => {
    if (!censusToDelete || !currentSite?.schemaName) return;

    setIsDeletingCensus(true);
    try {
      // Get the census ID from the date ranges
      const censusID = censusToDelete.dateRanges?.[0]?.censusID;
      if (!censusID) {
        throw new Error('Census ID not found');
      }

      const response = await fetch(`/api/fixeddata/census/${censusID}?schema=${currentSite.schemaName}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete census');
      }

      // Close modal and trigger refresh
      setOpenDeleteCensusModal(false);
      setCensusToDelete(null);
      setManualReset(true);
    } catch (error: any) {
      ailogger.error('Failed to delete census', error);
      setError('Failed to delete census. Please try again.');
    } finally {
      setIsDeletingCensus(false);
    }
  }, [censusToDelete, currentSite?.schemaName]);

  const handleAddCensus = useCallback(() => {
    // Navigate to the census creation workflow or trigger census creation
    // For now, navigate to the census selector area in the sidebar
    router.push('/fixeddatainput/census');
  }, [router]);

  // Reset all dashboard data when contexts are cleared
  useEffect(() => {
    if (!currentSite || !currentPlot || !currentCensus) {
      setProgressTacho({
        TotalQuadrats: 0,
        PopulatedPercent: 0,
        PopulatedQuadrats: 0,
        UnpopulatedQuadrats: []
      });
      setActiveUsers(0);
      setCountStems(0);
      setCountTrees(0);
      setStemTypes({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
      setChangelogHistory(Array(5));
      lastLoadedKeyRef.current = ''; // Reset tracking key when contexts are cleared
    }
  }, [currentSite, currentPlot, currentCensus]);

  useEffect(() => {
    if (currentSite && currentPlot && currentCensus) {
      // Create unique key to prevent duplicate loads
      const loadKey = `${currentSite.schemaName}-${currentPlot.plotID}-${currentCensus.dateRanges[0].censusID}`;

      // Skip if already loading or if same key as last load
      if (loadingRef.current || lastLoadedKeyRef.current === loadKey) {
        return;
      }

      loadingRef.current = true;
      lastLoadedKeyRef.current = loadKey;

      // Load all dashboard metrics with single aggregated API call (3-4x faster)
      Promise.all([loadAllDashboardMetrics(), loadChangelogHistory()])
        .catch(ailogger.error)
        .finally(() => {
          loadingRef.current = false;
        });
    }
  }, [currentSite, currentPlot, currentCensus, loadAllDashboardMetrics, loadChangelogHistory]);

  const hasData = progressTacho.PopulatedQuadrats > 0 || countStems > 0;

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
                Use the sidebar to select a census from {currentPlot.plotName}
              </Typography>
            </Box>
          </Stack>
          <CensusesOverview
            censuses={(Array.isArray(censusList) ? censusList : []).filter((c): c is OrgCensusRDS => c !== undefined)}
            plotName={currentPlot.plotName}
            siteName={currentSite.siteName}
            isLoading={false}
            onCensusDelete={handleCensusDelete}
            onAddCensus={handleAddCensus}
          />
        </Box>
      ) : !hasData && !isLoading ? (
        /* Empty State: Context selected but no data */
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
              } else if (!validity.personnel) {
                router.push('/fixeddatainput/personnel');
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
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, 1fr)',
                md: 'repeat(2, 1fr)',
                lg: 'repeat(4, 1fr)'
              },
              gap: 3
            }}
          >
            <MetricCard
              title="Total Trees"
              value={countTrees}
              icon={<ParkIcon sx={{ fontSize: 32 }} />}
              gradient="primary"
              isLoading={isLoading}
              trend={{
                value: hasData ? 'Current census' : 'No data',
                direction: 'neutral'
              }}
            />

            <MetricCard
              title="Total Stems"
              value={countStems}
              icon={<NatureIcon sx={{ fontSize: 32 }} />}
              gradient="success"
              isLoading={isLoading}
              trend={{
                value: hasData ? `${(countStems / Math.max(countTrees, 1)).toFixed(1)} per tree` : 'No data',
                direction: 'neutral'
              }}
            />

            <MetricCard
              title="Active Personnel"
              value={activeUsers}
              icon={<PeopleIcon sx={{ fontSize: 32 }} />}
              gradient="info"
              isLoading={isLoading}
              trend={{
                value: activeUsers > 0 ? 'Currently active' : 'No activity',
                direction: activeUsers > 0 ? 'up' : 'neutral'
              }}
            />

            <MetricCard
              title="New Recruits"
              value={stemTypes.CountNewRecruits}
              icon={<CategoryIcon sx={{ fontSize: 32 }} />}
              gradient="warning"
              isLoading={isLoading}
              trend={{
                value: hasData ? 'This census' : 'No data',
                direction: 'neutral'
              }}
            />
          </Box>

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
            <ProgressCard
              totalQuadrats={progressTacho.TotalQuadrats}
              populatedQuadrats={progressTacho.PopulatedQuadrats}
              populatedPercent={progressTacho.PopulatedPercent}
              unpopulatedQuadrats={progressTacho.UnpopulatedQuadrats}
              isLoading={isLoading}
            />

            {/* Census Statistics - Interactive Charts */}
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
              aria-labelledby="census-statistics-heading"
            >
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Typography id="census-statistics-heading" level="h4" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Census Visualization
                  </Typography>
                  <Typography level="body-sm" color="neutral">
                    {toggleSwitch ? 'Tachometer View' : 'Pie Chart View'} - Click to toggle
                  </Typography>
                </Box>

                {/* Only show chart if there are measurements */}
                {hasData ? (
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-pressed={toggleSwitch}
                    aria-label={toggleSwitch ? 'Switch to pie chart view' : 'Switch to tachometer view'}
                    sx={{
                      height: '400px',
                      width: '100%',
                      cursor: 'pointer',
                      transition: 'transform 0.2s ease',
                      '&:hover': {
                        transform: 'scale(1.02)'
                      }
                    }}
                    onClick={handleChartToggle}
                    onKeyDown={handleChartToggleKeyDown}
                  >
                    {toggleSwitch ? (
                      <ProgressTachometer {...progressTacho} aria-label="Quadrat population tachometer chart" />
                    ) : (
                      <ProgressPieChart {...progressTacho} stemTypes={stemTypes} aria-label="Stem types pie chart" />
                    )}
                  </Box>
                ) : (
                  <Box sx={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography level="body-lg" color="neutral" textAlign="center">
                      No measurements recorded for this census yet.
                    </Typography>
                  </Box>
                )}

                <Divider orientation="horizontal" />

                {/* Detailed Statistics Grid */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 2,
                    mt: 1
                  }}
                >
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
                    <Typography level="body-xs" color="neutral" sx={{ mb: 0.5 }}>
                      Stem Type Breakdown
                    </Typography>
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography level="body-sm">Old Stems:</Typography>
                        <Chip size="sm" variant="soft" color="neutral">
                          {stemTypes.CountOldStems.toLocaleString()}
                        </Chip>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography level="body-sm">Multi Stems:</Typography>
                        <Chip size="sm" variant="soft" color="primary">
                          {stemTypes.CountMultiStems.toLocaleString()}
                        </Chip>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography level="body-sm">New Recruits:</Typography>
                        <Chip size="sm" variant="soft" color="success">
                          {stemTypes.CountNewRecruits.toLocaleString()}
                        </Chip>
                      </Stack>
                    </Stack>
                  </Box>

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
                    <Typography level="body-xs" color="neutral" sx={{ mb: 0.5 }}>
                      Quadrat Coverage
                    </Typography>
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography level="body-sm">With Data:</Typography>
                        <Chip size="sm" variant="soft" color="success">
                          {progressTacho.PopulatedQuadrats.toLocaleString()}
                        </Chip>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography level="body-sm">Without Data:</Typography>
                        <Chip size="sm" variant="soft" color="warning">
                          {progressTacho.UnpopulatedQuadrats.length.toLocaleString()}
                        </Chip>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography level="body-sm">Total Quadrats:</Typography>
                        <Chip size="sm" variant="soft" color="neutral">
                          {progressTacho.TotalQuadrats.toLocaleString()}
                        </Chip>
                      </Stack>
                    </Stack>
                  </Box>
                </Box>

                <Divider orientation="horizontal" />

                <Tooltip title={isPulsing ? undefined : 'This form creates and submits a Github issue!'}>
                  <Chip
                    component="div"
                    role="button"
                    tabIndex={0}
                    aria-label="Open feedback form"
                    variant="soft"
                    color="primary"
                    size="lg"
                    startDecorator={<HelpOutlineOutlinedIcon fontSize="medium" />}
                    onClick={triggerPulse}
                    onKeyDown={handleFeedbackKeyDown}
                    sx={{
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: designTokens.shadows.sm
                      }
                    }}
                  >
                    <Typography level="body-md">Have feedback? Click here!</Typography>
                  </Chip>
                </Tooltip>
              </CardContent>
            </Card>
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

                {changelogHistory.filter(log => log.changeID).length > 0 ? (
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
                                    {log.operation || 'Update'} on {log.tableName || 'Data'}
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

      {/* Plot Edit Modal */}
      {plotToEdit && (
        <PlotCardModal plot={plotToEdit} openPlotCardModal={openPlotModal} setOpenPlotCardModal={setOpenPlotModal} setManualReset={setManualReset} />
      )}

      {/* Census Delete Confirmation Modal */}
      <Modal open={openDeleteCensusModal} onClose={() => setOpenDeleteCensusModal(false)}>
        <ModalDialog variant="outlined" role="alertdialog">
          <ModalClose />
          <DialogTitle>
            <DeleteForeverIcon sx={{ color: 'danger.500', mr: 1 }} />
            Delete Census {censusToDelete?.plotCensusNumber}?
          </DialogTitle>
          <DialogContent>
            <Typography level="body-md">
              Are you sure you want to delete Census {censusToDelete?.plotCensusNumber}? This action cannot be undone and will remove all associated measurement
              data.
            </Typography>
            <Alert color="danger" variant="soft" sx={{ mt: 2 }}>
              <Typography level="body-sm">
                <strong>Warning:</strong> This will permanently delete all trees, stems, and measurements associated with this census.
              </Typography>
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button variant="solid" color="danger" onClick={handleConfirmDeleteCensus} loading={isDeletingCensus}>
              Delete Census
            </Button>
            <Button variant="plain" color="neutral" onClick={() => setOpenDeleteCensusModal(false)}>
              Cancel
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}
