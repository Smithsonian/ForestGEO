'use client';
import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ReviewStates, UploadUpdateValidationsProps } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import ailogger from '@/ailogger';

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const { setReviewState, schema } = props;

  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const [ellipsis, setEllipsis] = useState('');
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(
      `/api/validations/updatepassedvalidations?schema=${schema}&plotID=${currentPlot?.id?.toString()}&censusID=${currentCensus?.dateRanges[0].censusID.toString()}`
    );
    const result = await response.json();
    setIsUpdateValidationComplete(true);
  };

  useEffect(() => {
    updateValidations().catch(ailogger.error);
  }, []);

  useEffect(() => {
    if (!isUpdateValidationComplete) {
      const ellipsisTimer = setInterval(() => {
        setEllipsis(prev => (prev.length < 4 ? prev + '.' : ''));
      }, 500);

      return () => clearInterval(ellipsisTimer);
    } else setReviewState(ReviewStates.UPLOAD_AZURE);
  }, [isUpdateValidationComplete]);

  return (
    <Box sx={{ display: 'flex', flex: 1, width: '100%', p: 2 }}>
      {!isUpdateValidationComplete ? (
        <Box
          sx={{
            width: '100%',
            p: 2,
            flexDirection: 'column',
            display: 'flex',
            flex: 1
          }}
        >
          <Typography variant="h6">Finalizing Validations{ellipsis}</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            width: '100%',
            p: 2,
            flexDirection: 'column',
            display: 'flex',
            flex: 1
          }}
        >
          <Typography variant="h6">Complete!</Typography>
          <Typography variant={'body1'}>Continuing to Azure upload.</Typography>
        </Box>
      )}
    </Box>
  );
}
