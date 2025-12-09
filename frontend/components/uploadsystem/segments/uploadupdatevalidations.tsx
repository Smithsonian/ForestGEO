'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/joy';
import { ReviewStates, UploadUpdateValidationsProps } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import ailogger from '@/ailogger';

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const { setReviewState, schema } = props;

  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const [ellipsis, setEllipsis] = useState('');
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  // Extract census ID to satisfy ESLint dependency rules
  const censusID = currentCensus?.dateRanges?.[0]?.censusID;

  const updateValidations = useCallback(async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(
      `/api/validations/updatepassedvalidations?schema=${schema}&plotID=${currentPlot?.id?.toString()}&censusID=${censusID?.toString()}`
    );
    const _result = await response.json();
    setIsUpdateValidationComplete(true);
  }, [schema, currentPlot?.id, censusID]);

  useEffect(() => {
    updateValidations().catch(ailogger.error);
  }, [updateValidations]);

  useEffect(() => {
    if (!isUpdateValidationComplete) {
      const ellipsisTimer = setInterval(() => {
        setEllipsis(prev => (prev.length < 4 ? prev + '.' : ''));
      }, 500);

      return () => clearInterval(ellipsisTimer);
    } else {
      setReviewState(ReviewStates.UPLOAD_AZURE);
    }
  }, [isUpdateValidationComplete, setReviewState]);

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
          <Typography level="title-lg">Finalizing Validations{ellipsis}</Typography>
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
          <Typography level="title-lg">Complete!</Typography>
          <Typography level="body-md">Continuing to Azure upload.</Typography>
        </Box>
      )}
    </Box>
  );
}
