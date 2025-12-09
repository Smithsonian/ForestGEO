'use client';

import { UploadCompleteProps } from '@/config/macros/uploadsystemmacros';
import Typography from '@mui/joy/Typography';
import { Box, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Modal, ModalDialog, Stack } from '@mui/joy';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch } from '@/app/contexts/listselectionprovider';
import { useOrgCensusContext, useOrgCensusDispatch, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';
import { FormType } from '@/config/macros/formdetails';
import { useAppStore } from '@/config/store/appstore';
import ailogger from '@/ailogger';

export default function UploadComplete(props: Readonly<UploadCompleteProps>) {
  const { handleCloseUploadModal, uploadForm } = props;
  const [progress, setProgress] = useState({ census: 0, plots: 0, quadrats: 0 });
  const [progressText, setProgressText] = useState({ census: '', plots: '', quadrats: '' });
  const [allLoadsCompleted, setAllLoadsCompleted] = useState(false);
  const [openUploadConfirmModal, setOpenUploadConfirmModal] = useState(false);

  const hasRunRef = useRef(false);

  const { triggerRefresh } = useDataValidityContext();

  const currentPlot = usePlotContext();
  const currentSite = useSiteContext();
  const currentCensus = useOrgCensusContext();

  const censusListDispatch = useOrgCensusListDispatch();
  const censusDispatch = useOrgCensusDispatch();
  const plotListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();

  // Zustand store setters to keep store in sync with context
  const setCensusListStore = useAppStore(state => state.setCensusList);
  const setCensusStore = useAppStore(state => state.setCensus);

  const loadCensusData = useCallback(async () => {
    if (!currentPlot || !censusDispatch) return;

    setProgressText(prev => ({ ...prev, census: 'Loading raw census data...' }));
    const response = await fetch(
      `/api/fetchall/census/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName || ''}`
    );
    const censusRDSLoad = await response.json();

    setProgressText(prev => ({ ...prev, census: 'Converting raw census data...' }));
    const censusList = await createAndUpdateCensusList(censusRDSLoad);

    // Update both context provider AND Zustand store to keep them in sync
    if (censusListDispatch) {
      await censusListDispatch({ censusList });
    }
    setCensusListStore(censusList); // Also update Zustand store

    const existingCensus = censusList.find(census => census.dateRanges?.[0]?.censusID === currentCensus?.dateRanges?.[0]?.censusID);
    if (existingCensus) {
      await censusDispatch({ census: existingCensus });
      setCensusStore(existingCensus); // Also update Zustand store
    }
    setProgress(prev => ({ ...prev, census: 100 }));
    setProgressText(prev => ({ ...prev, census: 'Census data loaded.' }));
  }, [
    currentPlot,
    censusDispatch,
    currentCensus?.plotCensusNumber,
    currentCensus?.dateRanges,
    currentSite?.schemaName,
    censusListDispatch,
    setCensusListStore,
    setCensusStore
  ]);

  const loadPlotsData = useCallback(async () => {
    if (!currentSite) return;

    setProgressText(prev => ({ ...prev, plots: 'Loading plot list information...' }));
    const plotsResponse = await fetch(`/api/fetchall/plots?schema=${currentSite?.schemaName || ''}`);
    const plotsData = await plotsResponse.json();
    if (!plotsData) return;

    setProgressText(prev => ({ ...prev, plots: 'Dispatching plot list information...' }));
    if (plotListDispatch) {
      await plotListDispatch({ plotList: plotsData });
    }
    setProgress(prev => ({ ...prev, plots: 100 }));
    setProgressText(prev => ({ ...prev, plots: 'Plot list information loaded.' }));
  }, [currentSite, plotListDispatch]);

  const loadQuadratsData = useCallback(async () => {
    if (!currentPlot || !currentCensus) return;

    setProgressText(prev => ({ ...prev, quadrats: 'Loading quadrat list information...' }));
    const quadratsResponse = await fetch(
      `/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite?.schemaName || ''}`
    );
    const quadratsData = await quadratsResponse.json();
    if (!quadratsData) return;

    setProgressText(prev => ({ ...prev, quadrats: 'Dispatching quadrat list information...' }));
    if (quadratListDispatch) {
      await quadratListDispatch({ quadratList: quadratsData });
    }
    setProgress(prev => ({ ...prev, quadrats: 100 }));
    setProgressText(prev => ({ ...prev, quadrats: 'Quadrat list information loaded.' }));
  }, [currentPlot, currentCensus, currentSite?.schemaName, quadratListDispatch]);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    const runAsyncTasks = async () => {
      try {
        if (uploadForm === FormType.measurements && currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID) {
          // Clean up temporary measurements table
          await fetch(`/api/query`, {
            body: JSON.stringify({
              query: `delete from ${currentSite.schemaName}.temporarymeasurements where PlotID = ? and CensusID = ?;`,
              params: [currentPlot.plotID, currentCensus.dateRanges?.[0]?.censusID],
              format: true
            }),
            method: 'POST'
          });
          // Run failed measurements review procedure
          await fetch(`/api/query`, { method: 'POST', body: JSON.stringify(`CALL ${currentSite.schemaName}.reviewfailed();`) });
        }
        triggerRefresh();
        await Promise.all([loadCensusData(), loadPlotsData(), loadQuadratsData()]);
        setAllLoadsCompleted(true);
      } catch (error: any) {
        ailogger.error(error);
      }
    };
    runAsyncTasks().catch(ailogger.error);
  }, [currentCensus?.dateRanges, currentPlot?.plotID, currentSite?.schemaName, loadCensusData, loadPlotsData, loadQuadratsData, triggerRefresh, uploadForm]);

  // Calculate overall progress as average of the three data loads
  const overallProgress = (progress.census + progress.plots + progress.quadrats) / 3;

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        px: 3
      }}
    >
      {!allLoadsCompleted ? (
        <Stack spacing={4} sx={{ width: '100%', alignItems: 'center', mt: 4 }} role="status" aria-live="polite">
          {/* Header */}
          <Box sx={{ textAlign: 'center' }}>
            <Typography level="h3" color="success" sx={{ mb: 1 }}>
              Upload Complete!
            </Typography>
            <Typography level="body-lg" sx={{ mb: 1 }}>
              Refreshing application data...
            </Typography>
            <Typography level="body-lg" color="primary" sx={{ fontWeight: 600 }}>
              {overallProgress.toFixed(0)}% Complete
            </Typography>
          </Box>

          {/* Main Progress Bar - Full Width */}
          <Box sx={{ width: '100%' }}>
            <LinearProgress
              determinate
              size="lg"
              variant="soft"
              color="success"
              value={overallProgress}
              sx={{
                width: '100%',
                height: 12,
                borderRadius: 'md'
              }}
              aria-label="Data refresh progress"
              aria-valuenow={overallProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </Box>

          {/* Current task being run */}
          <Typography level="body-sm" color="neutral" sx={{ textAlign: 'center' }}>
            {progress.census < 100
              ? progressText.census || 'Loading census data...'
              : progress.plots < 100
                ? progressText.plots || 'Loading plot data...'
                : progressText.quadrats || 'Loading quadrat data...'}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center', mt: 4, width: '100%' }}>
          <Typography level="h2" color="success">
            Upload Complete!
          </Typography>
          <Typography level="body-lg">Your data has been processed and uploaded successfully.</Typography>
          {uploadForm === FormType.measurements && (
            <Typography level="body-md" color="neutral">
              Any rows with errors have been moved to the failed measurements table for review.
            </Typography>
          )}
          <Button variant="solid" color="success" size="lg" onClick={() => setOpenUploadConfirmModal(true)} sx={{ mt: 2 }}>
            Close
          </Button>
        </Stack>
      )}
      <Modal open={openUploadConfirmModal} onClose={() => setOpenUploadConfirmModal(false)}>
        <ModalDialog role="alertdialog">
          <DialogTitle>Ready to Continue?</DialogTitle>
          <DialogContent>
            <Typography level="body-md">Your upload has completed. Click &quot;Done&quot; to close this dialog and return to the application.</Typography>
            {uploadForm === FormType.measurements && (
              <Typography level="body-sm" color="neutral" sx={{ mt: 2 }}>
                You can review any failed measurements through the validation interface.
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              variant="solid"
              color="success"
              onClick={() => {
                setOpenUploadConfirmModal(false);
                handleCloseUploadModal();
              }}
            >
              Done
            </Button>
            <Button variant="plain" color="neutral" onClick={() => setOpenUploadConfirmModal(false)}>
              Cancel
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}
