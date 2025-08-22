'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { title } from '@/config/primitives';
import { useSession } from 'next-auth/react';
import { redirect, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Box, IconButton, LinearProgress, Snackbar, Stack, Typography, useTheme } from '@mui/joy';
import Divider from '@mui/joy/Divider';
import { useLoading } from '@/app/contexts/loadingprovider';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch
} from '@/app/contexts/userselectionprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch, useSiteListDispatch } from '@/app/contexts/listselectionprovider';
import { getEndpointHeaderName, siteConfig } from '@/config/macros/siteconfigs';
import GithubFeedbackModal from '@/components/client/modals/githubfeedbackmodal';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { useLockAnimation } from '../contexts/lockanimationcontext';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';
import { AcaciaVersionTypography } from '@/styles/versions/acaciaversion';
import { useMeasurementsUploadCompletion } from '@/app/contexts/uploadcompletionprovider';
import ReactDOM from 'react-dom';
import ailogger from '@/ailogger';

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
  /**
   * MEASUREMENTS UPLOAD COMPLETION CONTEXT INTEGRATION
   *
   * This section integrates with the measurements upload completion context to:
   * 1. Detect when measurements uploads complete successfully
   * 2. Track real-time backend processing progress via SSE
   * 3. Manage UI state for progress bars and completion notifications
   *
   * The context provides both upload completion signals and processing progress state
   */
  const {
    measurementsUploadCompleted, // Flag indicating upload completed successfully
    measurementsUploadData, // Upload data (plot, census, schema info)
    processingProgress, // Real-time processing progress from SSE
    processingCompleted, // Flag indicating backend processing finished
    resetMeasurementsUploadCompletion, // Function to reset all state
    updateProcessingProgress, // Function to update processing progress
    setProcessingCompleted // Function to mark processing as complete
  } = useMeasurementsUploadCompletion();

  const lastExecutedRef = useRef<number | null>(null);
  // Refs for debouncing
  const plotLastExecutedRef = useRef<number | null>(null);
  const censusLastExecutedRef = useRef<number | null>(null);
  const quadratLastExecutedRef = useRef<number | null>(null);

  // Debounce delay
  const debounceDelay = 300;

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
      const allsites = await (
        await fetch(`/api/fetchall/sites/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
      ).json();
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
        const response = await fetch(
          `/api/fetchall/plots/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName || ''}`
        );
        const plotsData = await response.json();
        if (!plotsData) throw new Error('Failed to load plots data');
        if (plotListDispatch) await plotListDispatch({ plotList: plotsData });
        setPlotListLoaded(true);
      }
    } catch (error: any) {
      ailogger.error('Error loading plot data:', error);
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
        const response = await fetch(
          `/api/fetchall/census/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite.schemaName}`
        );
        const censusRDSLoad = await response.json();
        if (!censusRDSLoad) throw new Error('Failed to load census data');
        const censusList = await createAndUpdateCensusList(censusRDSLoad);
        if (censusListDispatch) await censusListDispatch({ censusList });
        setCensusListLoaded(true);
      }
    } catch (error: any) {
      ailogger.error('Error loading census data:', error);
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
    } catch (error: any) {
      ailogger.error('Error loading quadrat data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentSite, currentPlot, currentCensus, quadratListLoaded, quadratListDispatch, setLoading]);

  // Fetch site list if session exists and site list has not been loaded
  useEffect(() => {
    // Ensure session is ready before attempting to fetch site list
    if (session && !siteListLoaded) {
      fetchSiteList().catch(ailogger.error);
    }
  }, [session, siteListLoaded, fetchSiteList]);

  // Fetch plot data when currentSite is defined and plotList has not been loaded
  useEffect(() => {
    if (currentSite && !plotListLoaded) {
      loadPlotData().catch(ailogger.error);
    }
  }, [currentSite, plotListLoaded, loadPlotData]);

  // Fetch census data when currentSite, currentPlot are defined and censusList has not been loaded
  useEffect(() => {
    if (currentSite && currentPlot && !censusListLoaded) {
      loadCensusData().catch(ailogger.error);
    }
  }, [currentSite, currentPlot, censusListLoaded, loadCensusData]);

  // Fetch quadrat data when currentSite, currentPlot, currentCensus are defined and quadratList has not been loaded
  useEffect(() => {
    if (currentSite && currentPlot && currentCensus && !quadratListLoaded) {
      loadQuadratData().catch(ailogger.error);
    }
  }, [currentSite, currentPlot, currentCensus, quadratListLoaded, loadQuadratData]);

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
  }, [manualReset]);

  // Clear lists and reload data when site, plot, or census changes
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
          .catch(ailogger.error);
      }, 300); // 300ms delay for UI reset
    };

    if (hasSiteChanged || hasPlotChanged || hasCensusChanged) {
      clearLists().catch(ailogger.error);
    }
  }, [currentSite, currentPlot, currentCensus, plotListDispatch, censusListDispatch, quadratListDispatch, loadPlotData, loadCensusData, loadQuadratData]);

  // Handle redirection if contexts are reset (i.e., no site, plot, or census) and user is not on the dashboard
  useEffect(() => {
    if (currentSite === undefined && currentPlot === undefined && currentCensus === undefined && pathname !== '/dashboard' && !pathname.includes('admin')) {
      redirect('/dashboard');
    }
  }, [pathname, currentSite, currentPlot, currentCensus]);

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

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      import('@axe-core/react').then(axe => {
        axe.default(React, ReactDOM, 1000).then(() => {});
      });
    }
  }, []);

  /**
   * MEASUREMENTS BACKEND PROCESSING HANDLER
   *
   * This useEffect is the core of the measurements processing system. It:
   * 1. Listens for measurements upload completion signals from the context
   * 2. Starts an SSE connection to the ingestionprocessor function app
   * 3. Handles real-time progress updates via SSE events
   * 4. Manages error states and cleanup
   *
   * SSE EVENT TYPES FROM INGESTIONPROCESSOR:
   * - 'start': Processing begins, provides total batch count
   * - 'completed': Each batch completes, provides FileID/BatchID
   * - 'finished': All processing complete
   * - 'error': Processing failed with error message
   *
   * FLOW:
   * Upload completes → Context triggered → SSE connection starts →
   * Progress updates via events → Processing completes → UI notifications
   */
  useEffect(() => {
    if (measurementsUploadCompleted && measurementsUploadData) {
      const startIngestionProcessing = async () => {
        try {
          // Initialize processing state when starting
          // Reset any previous state and mark processing as active
          updateProcessingProgress({
            isProcessing: true,
            totalBatches: 0,
            completedBatches: 0,
            error: undefined
          });
          setProcessingCompleted(false);

          // Construct the API URL for the ingestionprocessor function app
          // These parameters match what the Azure function expects
          const params = new URLSearchParams({
            schema: measurementsUploadData.schemaName || '', // Database schema name
            plotID: measurementsUploadData.plotID?.toString() || '', // Plot identifier
            plotCensusNumber: measurementsUploadData.plotCensusNumber?.toString() || '' // Census number
          });

          // Establish SSE connection to the ingestionprocessor
          // This provides real-time updates as batches are processed
          const eventSource = new EventSource(`/api/ingestionprocessor?${params}`);

          /**
           * SSE MESSAGE HANDLER
           * Processes real-time events from the ingestionprocessor function app
           * Each event updates the UI to show current processing status
           */
          eventSource.onmessage = event => {
            try {
              const data = JSON.parse(event.data);

              switch (data.type) {
                case 'start':
                  // Processing begins - update total batch count
                  updateProcessingProgress({
                    isProcessing: true,
                    totalBatches: data.total_batches,
                    completedBatches: 0
                  });
                  break;

                case 'completed':
                  // Individual batch completed - increment progress
                  updateProcessingProgress({
                    completedBatches: processingProgress.completedBatches + 1,
                    currentFileID: data.FileID,
                    currentBatchID: data.BatchID
                  });
                  break;

                case 'finished':
                  // All processing complete - mark as finished
                  updateProcessingProgress({
                    isProcessing: false
                  });
                  setProcessingCompleted(true);
                  eventSource.close();
                  // Note: Don't reset context here - let success snackbar handle it
                  break;

                case 'error':
                  // Processing failed - show error and cleanup
                  updateProcessingProgress({
                    isProcessing: false,
                    error: data.error
                  });
                  eventSource.close();
                  // Auto-reset after delay to clear error state
                  setTimeout(() => resetMeasurementsUploadCompletion(), 5000);
                  break;
              }
            } catch (parseError: any) {
              ailogger.error('Error parsing SSE data:', parseError);
            }
          };

          /**
           * SSE ERROR HANDLER
           * Handles connection failures and other SSE-related errors
           */
          eventSource.onerror = (error: any) => {
            ailogger.error('SSE connection error:', error);
            updateProcessingProgress({
              isProcessing: false,
              error: 'Connection error occurred'
            });
            eventSource.close();
            // Auto-reset after delay to clear error state
            setTimeout(() => resetMeasurementsUploadCompletion(), 5000);
          };
        } catch (error: any) {
          // Handle any errors in setting up the SSE connection
          ailogger.error('Failed to start ingestion processing:', error);
          updateProcessingProgress({
            isProcessing: false,
            error: 'Failed to start processing'
          });
          setTimeout(() => resetMeasurementsUploadCompletion(), 5000);
        }
      };

      startIngestionProcessing().catch(ailogger.error);
    }
  }, [measurementsUploadCompleted, measurementsUploadData, updateProcessingProgress, setProcessingCompleted, resetMeasurementsUploadCompletion]);

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
          {session && <>{children}</>}
        </Box>
        <Divider orientation="horizontal" />

        {/**
         * MEASUREMENTS PROCESSING PROGRESS BAR
         *
         * This component appears at the bottom of the layout when measurements
         * are being processed by the backend ingestionprocessor. It provides:
         *
         * 1. Real-time progress indication (X/Y batches completed)
         * 2. Current file being processed (if available)
         * 3. Visual progress bar with percentage completion
         *
         * DISPLAY CONDITIONS:
         * - Only shown when processingProgress.isProcessing === true
         * - Automatically hidden when processing completes or errors
         *
         * PROGRESS CALCULATION:
         * - Uses completedBatches / totalBatches * 100 for percentage
         * - Shows 0% if totalBatches is 0 (prevents division by zero)
         *
         * STYLING:
         * - Positioned at bottom of main content area
         * - Uses theme background colors for integration
         * - Bordered to separate from main content
         */}
        {processingProgress.isProcessing && (
          <Box
            sx={{
              width: '100%',
              px: 2,
              py: 1,
              backgroundColor: 'background.level1', // Subtle background to distinguish from main content
              borderTop: 1,
              borderColor: 'divider'
            }}
          >
            {/* Progress text with batch count and current file info */}
            <Typography level="body-sm" sx={{ mb: 1 }}>
              Processing measurements data... ({processingProgress.completedBatches}/{processingProgress.totalBatches})
              {processingProgress.currentFileID && ` - File: ${processingProgress.currentFileID}`}
            </Typography>

            {/* Visual progress bar */}
            <LinearProgress
              determinate
              value={processingProgress.totalBatches > 0 ? (processingProgress.completedBatches / processingProgress.totalBatches) * 100 : 0}
              sx={{ width: '100%' }}
            />
          </Box>
        )}

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

      {/**
       * MEASUREMENTS PROCESSING SUCCESS NOTIFICATION
       *
       * This snackbar appears when measurements processing completes successfully.
       * It provides user feedback that their uploaded data has been fully processed.
       *
       * DISPLAY CONDITIONS:
       * - Shows when processingCompleted === true
       * - Auto-hides after 6 seconds
       * - Can be manually dismissed by clicking
       *
       * BEHAVIOR:
       * - Positioned at bottom-center of screen
       * - Green success styling with checkmark emoji
       * - When closed (auto or manual), resets the entire context state
       * - This cleanup ensures the flow can start fresh for next upload
       */}
      <Snackbar
        open={processingCompleted}
        autoHideDuration={6000}
        onClose={() => {
          setProcessingCompleted(false);
          resetMeasurementsUploadCompletion(); // Full state reset when dismissed
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        variant="solid"
        color="success"
      >
        <Typography>✅ Measurements processing completed successfully!</Typography>
      </Snackbar>

      {/**
       * MEASUREMENTS PROCESSING ERROR NOTIFICATION
       *
       * This snackbar appears when measurements processing encounters errors.
       * It shows the specific error message from the backend processing.
       *
       * DISPLAY CONDITIONS:
       * - Shows when processingProgress.error is truthy
       * - Auto-hides after 8 seconds (longer than success to allow reading)
       * - Can be manually dismissed by clicking
       *
       * BEHAVIOR:
       * - Positioned at bottom-center of screen
       * - Red danger styling with X emoji
       * - Shows specific error message from backend
       * - When closed, resets the entire context state
       * - Note: Auto-reset also happens after 5 seconds via useEffect timeout
       */}
      <Snackbar
        open={!!processingProgress.error}
        autoHideDuration={8000}
        onClose={() => resetMeasurementsUploadCompletion()} // Full state reset when dismissed
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        variant="solid"
        color="danger"
      >
        <Typography>❌ Processing failed: {processingProgress.error}</Typography>
      </Snackbar>
    </>
  );
}
