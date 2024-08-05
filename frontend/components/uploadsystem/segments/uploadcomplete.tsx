'use client';

import { UploadCompleteProps } from '@/config/macros/uploadsystemmacros';
import Typography from '@mui/joy/Typography';
import { Box } from '@mui/joy';
import { redirect } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import CircularProgress from '@mui/joy/CircularProgress';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useOrgCensusListDispatch, usePlotListDispatch, useQuadratListDispatch } from '@/app/contexts/listselectionprovider';
import { createAndUpdateCensusList } from '@/config/sqlrdsdefinitions/orgcensusrds';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';

export default function UploadComplete(props: Readonly<UploadCompleteProps>) {
  const { uploadForm, handleCloseUploadModal } = props;
  const [countdown, setCountdown] = useState(5);

  const { triggerRefresh } = useDataValidityContext();
  const { setLoading } = useLoading();

  const currentPlot = usePlotContext();
  const currentSite = useSiteContext();
  const currentCensus = useOrgCensusContext();

  const censusListDispatch = useOrgCensusListDispatch();
  const plotListDispatch = usePlotListDispatch();
  const quadratListDispatch = useQuadratListDispatch();

  const loadCensusData = async () => {
    if (!currentPlot) return;

    setLoading(true, 'Loading raw census data');
    const response = await fetch(`/api/fetchall/census/${currentPlot.plotID}?schema=${currentSite?.schemaName || ''}`);
    const censusRDSLoad = await response.json();
    setLoading(false);

    setLoading(true, 'Converting raw census data...');
    const censusList = await createAndUpdateCensusList(censusRDSLoad);
    if (censusListDispatch) {
      censusListDispatch({ censusList });
    }
    setLoading(false);
  };

  const loadPlotsData = async () => {
    if (!currentSite) return;

    setLoading(true, 'Loading plot list information...');
    const plotsResponse = await fetch(`/api/fetchall/plots?schema=${currentSite?.schemaName || ''}`);
    const plotsData = await plotsResponse.json();
    if (!plotsData) return;
    setLoading(false);

    setLoading(true, 'Dispatching plot list information...');
    if (plotListDispatch) {
      await plotListDispatch({ plotList: plotsData });
    } else return;
    setLoading(false);
  };

  const loadQuadratsData = async () => {
    if (!currentPlot || !currentCensus) return;

    setLoading(true, 'Loading quadrat list information...');
    const quadratsResponse = await fetch(
      `/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite?.schemaName || ''}`
    );
    const quadratsData = await quadratsResponse.json();
    if (!quadratsData) return;
    setLoading(false);

    setLoading(true, 'Dispatching quadrat list information...');
    if (quadratListDispatch) {
      await quadratListDispatch({ quadratList: quadratsData });
    } else return;
    setLoading(false);
  };

  // Effect for handling countdown and state transition
  useEffect(() => {
    let timer: number; // Declare timer as a number

    if (countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
      // Use 'window.setTimeout' and type assertion to treat the return as a number
    } else if (countdown === 0) {
      triggerRefresh();
      loadCensusData().catch(console.error).then(loadPlotsData).catch(console.error).then(loadQuadratsData).catch(console.error).then(handleCloseUploadModal);
    }
    return () => clearTimeout(timer); // Clear timeout using the timer variable
  }, [countdown, handleCloseUploadModal]);

  const redirectLink = () => {
    switch (uploadForm) {
      case 'attributes':
        return redirect('/fixeddatainput/attributes');
      case 'personnel':
        return redirect('/fixeddatainput/personnel');
      case 'species':
        return redirect('/fixeddatainput/species');
      case 'quadrats':
        return redirect('/fixeddatainput/quadrats');
      case 'measurements':
        return redirect('/measurementshub/summary');
      case 'arcgis_files':
        return redirect('/dashboard');
      default:
        return redirect('/dashboard');
    }
  };
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
      {countdown > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <CircularProgress />
          <Typography>{countdown} seconds remaining</Typography>
        </Box>
      )}
      {countdown === 0 && redirectLink()}
    </Box>
  );
}
