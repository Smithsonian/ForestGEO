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

  const loadCensusData = useCallback(async () => {
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
  }, [currentPlot, censusDispatch, currentCensus?.plotCensusNumber, currentCensus?.dateRanges, currentSite?.schemaName, censusListDispatch]);

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
  }, [currentCensus?.dateRanges, currentPlot?.plotID, currentSite?.schemaName, loadCensusData, loadPlotsData, loadQuadratsData, triggerRefresh, uploadForm]);

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        '@keyframes fadeIn': {
          from: {
            opacity: 0,
            transform: 'translateY(20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)'
          }
        },
        '@keyframes pulse': {
          '0%, 100%': {
            opacity: 1,
            transform: 'scale(1)'
          },
          '50%': {
            opacity: 0.9,
            transform: 'scale(1.02)'
          }
        }
      }}
    >
      {!allLoadsCompleted ? (
        <Box
          role="status"
          aria-live="polite"
          sx={{
            width: '100%',
            maxWidth: '800px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            p: 4,
            animation: 'fadeIn 0.5s ease-out'
          }}
        >
          <Box
            sx={{
              p: 3,
              borderRadius: 'lg',
              bgcolor: 'success.softBg',
              boxShadow: theme => `0 8px 24px ${theme.palette.success.softBg}`,
              mb: 4,
              animation: 'pulse 2s ease-in-out infinite'
            }}
          >
            <Typography
              level={'h1'}
              sx={{
                textAlign: 'center',
                fontWeight: 700,
                background: theme => `linear-gradient(135deg, ${theme.palette.success[600]} 0%, ${theme.palette.success[800]} 100%)`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              Upload Complete!
            </Typography>
          </Box>
          <Box
            sx={{
              width: '100%',
              p: 3,
              borderRadius: 'md',
              bgcolor: 'primary.softBg',
              borderLeft: theme => `4px solid ${theme.palette.primary[400]}`,
              mb: 2
            }}
          >
            <Typography level="body-sm" id="census-progress-label" sx={{ mb: 1, fontWeight: 600 }}>
              Census Data
            </Typography>
            <LinearProgress
              determinate
              value={progress.census}
              sx={{
                width: '100%',
                mb: 1,
                height: '8px',
                borderRadius: 'sm',
                '& .MuiLinearProgress-bar': {
                  background: theme => `linear-gradient(90deg, ${theme.palette.primary[500]} 0%, ${theme.palette.primary[700]} 100%)`
                }
              }}
              aria-label="Census data loading progress"
              aria-labelledby="census-progress-label"
              aria-valuenow={progress.census}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={progressText.census}
            />
            <Typography level="body-xs" aria-live="polite" sx={{ fontStyle: 'italic', color: 'primary.plainColor' }}>
              {progressText.census}
            </Typography>
          </Box>
          <Box
            sx={{
              width: '100%',
              p: 3,
              borderRadius: 'md',
              bgcolor: 'primary.softBg',
              borderLeft: theme => `4px solid ${theme.palette.primary[400]}`,
              mb: 2
            }}
          >
            <Typography level="body-sm" id="plots-progress-label" sx={{ mb: 1, fontWeight: 600 }}>
              Plots Data
            </Typography>
            <LinearProgress
              determinate
              value={progress.plots}
              sx={{
                width: '100%',
                mb: 1,
                height: '8px',
                borderRadius: 'sm',
                '& .MuiLinearProgress-bar': {
                  background: theme => `linear-gradient(90deg, ${theme.palette.primary[500]} 0%, ${theme.palette.primary[700]} 100%)`
                }
              }}
              aria-label="Plots data loading progress"
              aria-labelledby="plots-progress-label"
              aria-valuenow={progress.plots}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={progressText.plots}
            />
            <Typography level="body-xs" aria-live="polite" sx={{ fontStyle: 'italic', color: 'primary.plainColor' }}>
              {progressText.plots}
            </Typography>
          </Box>
          <Box
            sx={{
              width: '100%',
              p: 3,
              borderRadius: 'md',
              bgcolor: 'primary.softBg',
              borderLeft: theme => `4px solid ${theme.palette.primary[400]}`
            }}
          >
            <Typography level="body-sm" id="quadrats-progress-label" sx={{ mb: 1, fontWeight: 600 }}>
              Quadrats Data
            </Typography>
            <LinearProgress
              determinate
              value={progress.quadrats}
              sx={{
                width: '100%',
                mb: 1,
                height: '8px',
                borderRadius: 'sm',
                '& .MuiLinearProgress-bar': {
                  background: theme => `linear-gradient(90deg, ${theme.palette.primary[500]} 0%, ${theme.palette.primary[700]} 100%)`
                }
              }}
              aria-label="Quadrats data loading progress"
              aria-labelledby="quadrats-progress-label"
              aria-valuenow={progress.quadrats}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={progressText.quadrats}
            />
            <Typography level="body-xs" aria-live="polite" sx={{ fontStyle: 'italic', color: 'primary.plainColor' }}>
              {progressText.quadrats}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            maxWidth: '600px',
            p: 4,
            animation: 'fadeIn 0.6s ease-out'
          }}
        >
          <Box
            sx={{
              p: 3,
              borderRadius: 'lg',
              bgcolor: 'success.softBg',
              boxShadow: theme => `0 12px 32px ${theme.palette.success.softBg}`,
              mb: 3,
              textAlign: 'center'
            }}
          >
            <Typography
              level={'h1'}
              sx={{
                fontWeight: 700,
                background: theme => `linear-gradient(135deg, ${theme.palette.success[600]} 0%, ${theme.palette.success[800]} 100%)`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                mb: 2
              }}
            >
              Upload completed successfully!
            </Typography>
            <Typography level="h3" sx={{ color: 'success.solidBg', mb: 1 }}>
              Your data has been processed and uploaded.
            </Typography>
            <Typography level="body-md">Any error rows have been automatically moved to the failedmeasurements table for review.</Typography>
          </Box>
          <Button
            variant="solid"
            color="primary"
            size="lg"
            onClick={() => setOpenUploadConfirmModal(true)}
            sx={{
              background: theme => `linear-gradient(135deg, ${theme.palette.primary[500]} 0%, ${theme.palette.primary[700]} 100%)`,
              transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
              position: 'relative',
              overflow: 'hidden',
              minWidth: '200px',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: '-100%',
                width: '100%',
                height: '100%',
                background: theme => `linear-gradient(90deg, transparent, ${theme.palette.primary[300]}, transparent)`,
                transition: 'left 0.5s ease'
              },
              '&:hover': {
                transform: 'translateY(-4px) scale(1.05)',
                boxShadow: theme => `0 12px 32px ${theme.palette.primary[300]}`,
                '&::before': {
                  left: '100%'
                }
              },
              '&:active': {
                transform: 'translateY(-2px) scale(0.98)'
              }
            }}
          >
            Confirm Changes
          </Button>
        </Box>
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
