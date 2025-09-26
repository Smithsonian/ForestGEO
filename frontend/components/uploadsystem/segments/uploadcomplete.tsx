'use client';

import { UploadCompleteProps } from '@/config/macros/uploadsystemmacros';
import Typography from '@mui/joy/Typography';
import { Box, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Modal, ModalDialog, Stack } from '@mui/joy';
import React, { useEffect, useRef, useState } from 'react';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch } from '@/app/contexts/listselectionprovider';
import { useOrgCensusContext, useOrgCensusDispatch, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';
import { FormType } from '@/config/macros/formdetails';
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

  const loadCensusData = async () => {
    if (!currentPlot || !censusDispatch) return;

    setProgressText(prev => ({ ...prev, census: 'Loading raw census data...' }));
    const response = await fetch(
      `/api/fetchall/census/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName || ''}`
    );
    const censusRDSLoad = await response.json();

    setProgressText(prev => ({ ...prev, census: 'Converting raw census data...' }));
    const censusList = await createAndUpdateCensusList(censusRDSLoad);
    if (censusListDispatch) {
      await censusListDispatch({ censusList });
    }

    const existingCensus = censusList.find(census => census.dateRanges[0].censusID === currentCensus?.dateRanges[0].censusID);
    if (existingCensus) await censusDispatch({ census: existingCensus });
    setProgress(prev => ({ ...prev, census: 100 }));
    setProgressText(prev => ({ ...prev, census: 'Census data loaded.' }));
  };

  const loadPlotsData = async () => {
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
  };

  const loadQuadratsData = async () => {
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
  };

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    const runAsyncTasks = async () => {
      try {
        if (uploadForm === FormType.measurements) {
          // Clean up temporary measurements table
          await fetch(`/api/query`, {
            body: JSON.stringify({
              query: `delete from ${currentSite?.schemaName}.temporarymeasurements where PlotID = ? and CensusID = ?;`,
              params: [currentPlot?.plotID, currentCensus?.dateRanges[0].censusID],
              format: true
            }),
            method: 'POST'
          });
          // Run failed measurements review procedure
          await fetch(`/api/query`, { method: 'POST', body: JSON.stringify(`CALL ${currentSite?.schemaName ?? ''}.reviewfailed();`) });
        }
        triggerRefresh();
        await Promise.all([loadCensusData(), loadPlotsData(), loadQuadratsData()]);
        setAllLoadsCompleted(true);
      } catch (error: any) {
        ailogger.error(error);
      }
    };
    runAsyncTasks().catch(ailogger.error);
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      {!allLoadsCompleted ? (
        <>
          <Typography variant={'solid'} level={'h1'} color={'success'}>
            Upload Complete!
          </Typography>
          <LinearProgress determinate value={progress.census} sx={{ width: '80%', margin: '1rem 0' }} />
          <Typography>{progressText.census}</Typography>
          <LinearProgress determinate value={progress.plots} sx={{ width: '80%', margin: '1rem 0' }} />
          <Typography>{progressText.plots}</Typography>
          <LinearProgress determinate value={progress.quadrats} sx={{ width: '80%', margin: '1rem 0' }} />
          <Typography>{progressText.quadrats}</Typography>
        </>
      ) : (
        <>
          <Typography fontWeight={'bold'} variant={'solid'} level={'h1'} color={'success'}>
            Upload completed successfully!
          </Typography>
          <Box sx={{ marginTop: 2, textAlign: 'center' }}>
            <Typography level="h3" color="success">
              Your data has been processed and uploaded.
            </Typography>
            <Typography level="body-md" sx={{ marginTop: 1 }}>
              Any error rows have been automatically moved to the failedmeasurements table for review.
            </Typography>
          </Box>
          <Box sx={{ marginTop: 4 }}>
            <Button variant="soft" color="primary" onClick={() => setOpenUploadConfirmModal(true)}>
              Confirm Changes
            </Button>
          </Box>
        </>
      )}
      <Modal open={openUploadConfirmModal} onClose={() => setOpenUploadConfirmModal(false)}>
        <ModalDialog role={'alertdialog'}>
          <DialogTitle>Upload Complete!</DialogTitle>
          <DialogContent>
            <Stack direction={'column'} spacing={2}>
              <Typography level={'h4'} color={'success'}>
                Upload completed successfully!
              </Typography>
              <Typography level={'body-md'}>
                Your data has been processed and uploaded. Any rows with errors have been automatically moved to the failedmeasurements table for review.
              </Typography>
              {uploadForm === 'measurements' && (
                <Typography level={'body-md'}>
                  You can review any error rows in the <code>failedmeasurements</code> table through the data validation interface.
                </Typography>
              )}
            </Stack>
            <Typography level={'body-md'} sx={{ marginTop: 2, fontWeight: 'bold' }}>
              Please confirm to finalize these changes.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              variant={'solid'}
              onClick={async () => {
                setOpenUploadConfirmModal(false);
                handleCloseUploadModal();
              }}
            >
              I understand
            </Button>
            <Button variant={'soft'} onClick={() => setOpenUploadConfirmModal(false)}>
              Go Back
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}
