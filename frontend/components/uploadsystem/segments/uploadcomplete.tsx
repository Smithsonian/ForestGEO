'use client';

import { UploadCompleteProps } from '@/config/macros/uploadsystemmacros';
import Typography from '@mui/joy/Typography';
import { Box, LinearProgress } from '@mui/joy';
import React, { useEffect, useState } from 'react';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch } from '@/app/contexts/listselectionprovider';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/timekeeping';

export default function UploadComplete(props: Readonly<UploadCompleteProps>) {
  const { uploadForm, handleCloseUploadModal } = props;
  const [progress, setProgress] = useState({ census: 0, plots: 0, quadrats: 0 });
  const [progressText, setProgressText] = useState({ census: '', plots: '', quadrats: '' });

  const { triggerRefresh } = useDataValidityContext();

  const currentPlot = usePlotContext();
  const currentSite = useSiteContext();
  const currentCensus = useOrgCensusContext();

  const censusListDispatch = useOrgCensusListDispatch();
  const plotListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();

  const loadCensusData = async () => {
    if (!currentPlot) return;

    setProgressText(prev => ({ ...prev, census: 'Loading raw census data...' }));
    const response = await fetch(`/api/fetchall/census/${currentPlot.plotID}?schema=${currentSite?.schemaName || ''}`);
    const censusRDSLoad = await response.json();

    setProgressText(prev => ({ ...prev, census: 'Converting raw census data...' }));
    const censusList = await createAndUpdateCensusList(censusRDSLoad);
    if (censusListDispatch) {
      await censusListDispatch({ censusList });
    }
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

  // Effect to run async tasks before countdown
  useEffect(() => {
    const runAsyncTasks = async () => {
      try {
        triggerRefresh();
        await Promise.all([loadCensusData(), loadPlotsData(), loadQuadratsData()]);
      } catch (error) {
        console.error(error);
      } finally {
        handleCloseUploadModal();
      }
    };
    runAsyncTasks().catch(console.error);
  }, [triggerRefresh]);

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <Typography variant={'solid'} level={'h1'} color={'success'}>
        Upload Complete!
      </Typography>
      <LinearProgress determinate value={progress.census} sx={{ width: '80%', margin: '1rem 0' }} />
      <Typography>{progressText.census}</Typography>
      <LinearProgress determinate value={progress.plots} sx={{ width: '80%', margin: '1rem 0' }} />
      <Typography>{progressText.plots}</Typography>
      <LinearProgress determinate value={progress.quadrats} sx={{ width: '80%', margin: '1rem 0' }} />
      <Typography>{progressText.quadrats}</Typography>
    </Box>
  );
}
